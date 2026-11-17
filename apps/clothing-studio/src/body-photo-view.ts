/**
 * Measure the body from photos: a front photo (and optionally a side photo) and the person's height give estimated
 * girths and depths, shown with how each was found and where it was measured on the photo. Using them only fills the
 * body measurement fields as drafts, to correct and then apply like typed measurements.
 */
import { estimateBody, measureFront, measureSide, type BodyEstimate, type Mask, type MaskLine } from './body-photo.ts';
import { BODY_CHEST, BODY_CHEST_DEPTH, BODY_HEIGHT, BODY_HIP, BODY_HIP_DEPTH, BODY_UPPER_ARM_GIRTH, BODY_WAIST } from './garment-drape.ts';
import { loadPoseDetector } from './pose-detector.ts';

export const bodyPhotoMarkup = `<details id="body-photos"><summary>Measure the body from photos (optional)</summary>
  <p class="fine-print">Stand straight in close-fitting clothes against a plain background, with your arms held a little away from your sides and your feet slightly apart, and take a photo from the front with your whole body in it, head to feet. A second photo from the side, arms down, makes the girths more accurate. The photos are read on this device and are not saved or uploaded; the first estimate downloads Google's pose model (about 6 MB).</p>
  <div class="measure-grid"><label class="field">Your height (cm)<input id="body-photo-height" type="number" min="${BODY_HEIGHT[0]}" max="${BODY_HEIGHT[1]}" step="0.5"></label>
  <label class="field">Front photo<input id="body-photo-front" type="file" accept="image/jpeg,image/png,image/webp"></label>
  <label class="field">Side photo (optional)<input id="body-photo-side" type="file" accept="image/jpeg,image/png,image/webp"></label></div>
  <button id="body-photo-estimate" class="quiet" type="button">Estimate measurements</button>
  <p id="body-photo-status" class="fine-print" role="status" aria-live="polite"></p>
  <div id="body-photo-views" class="body-photo-views" hidden><canvas id="body-photo-front-view" role="img" aria-label="Front photo with the outline found and the measured chest, waist and hip lines"></canvas><canvas id="body-photo-side-view" role="img" aria-label="Side photo with the outline found and the measured depth lines" hidden></canvas></div>
  <div id="body-photo-result" hidden>
    <table class="body-photo-table"><caption>Estimates (cm)</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Estimate</th><th scope="col">How it was found</th></tr></thead><tbody id="body-photo-rows"></tbody></table>
    <button id="body-photo-use" type="button">Put these in the body measurements</button>
    <p class="fine-print">These are estimates, not tape measurements. Tested on 68 people in a public set of outlines with tape measurements (BodyM test A), they were within 5 cm for 60% of chests, 74% of waists and 78% of hips with a side photo (about 47%, 44% and 72% from the front alone), and within 3 cm for 78% of upper arms. Loose clothing, hair, posture and the camera's angle change them; measure with a tape where fit matters.</p>
  </div>
</details>`;

/** The body fields the estimates fill, by their input ids. */
export type BodyField = 'garment-drape-chest' | 'garment-drape-waist' | 'garment-drape-hip' | 'garment-drape-depth' | 'garment-drape-hip-depth' | 'garment-drape-height' | 'garment-drape-arm-girth';

const ROWS: { key: keyof Omit<BodyEstimate, 'basis'> | 'height'; name: string; field: BodyField; range: readonly [number, number] }[] = [
  { key: 'chest', name: 'Chest (or bust)', field: 'garment-drape-chest', range: BODY_CHEST },
  { key: 'waist', name: 'Waist', field: 'garment-drape-waist', range: BODY_WAIST },
  { key: 'hip', name: 'Hip', field: 'garment-drape-hip', range: BODY_HIP },
  { key: 'upperArmGirth', name: 'Upper arm', field: 'garment-drape-arm-girth', range: BODY_UPPER_ARM_GIRTH },
  { key: 'chestDepth', name: 'Chest depth', field: 'garment-drape-depth', range: BODY_CHEST_DEPTH },
  { key: 'hipDepth', name: 'Waist to hip', field: 'garment-drape-hip-depth', range: BODY_HIP_DEPTH },
  { key: 'height', name: 'Height', field: 'garment-drape-height', range: BODY_HEIGHT },
];

/** Largest side, px, a photo is read at. */
const READ_SIZE = 1024;

async function picture(file: File): Promise<HTMLCanvasElement> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 25 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP photo of at most 25 MB.');
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, READ_SIZE / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally { bitmap.close(); }
}

/** The photo with the outline tinted and the measured lines drawn across it. */
function show(view: HTMLCanvasElement, photo: HTMLCanvasElement, mask: Mask, lines: MaskLine[]): void {
  view.width = mask.width; view.height = mask.height;
  const context = view.getContext('2d')!;
  context.drawImage(photo, 0, 0, mask.width, mask.height);
  const tint = context.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) { tint.data[i * 4] = (tint.data[i * 4]! + 64) / 2; tint.data[i * 4 + 1] = (tint.data[i * 4 + 1]! + 160) / 2; tint.data[i * 4 + 2] = (tint.data[i * 4 + 2]! + 255) / 2; }
  context.putImageData(tint, 0, 0);
  context.strokeStyle = '#e4572e'; context.lineWidth = Math.max(2, mask.width / 200);
  for (const line of lines) { context.beginPath(); context.moveTo(line.x0, line.y); context.lineTo(line.x1 + 1, line.y); context.stroke(); }
}

export function mountBodyPhotos(root: ParentNode, options: { fill(values: Partial<Record<BodyField, number>>): string[] }): void {
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const status = $('body-photo-status'), button = $<HTMLButtonElement>('body-photo-estimate');
  let estimate: (BodyEstimate & { height: number }) | null = null;
  const height = () => {
    const value = Number($<HTMLInputElement>('body-photo-height').value);
    if (!$<HTMLInputElement>('body-photo-height').value.trim() || !Number.isFinite(value) || value < BODY_HEIGHT[0] || value > BODY_HEIGHT[1]) throw new Error(`Enter your height, from ${BODY_HEIGHT[0]} to ${BODY_HEIGHT[1]} cm.`);
    return value;
  };
  root.querySelector('#body-photos')!.addEventListener('toggle', () => {
    // Start from the body's own height when one is entered.
    const typed = root.querySelector<HTMLInputElement>('#garment-drape-height')?.value ?? '';
    if (typed && !$<HTMLInputElement>('body-photo-height').value) $<HTMLInputElement>('body-photo-height').value = typed;
  });
  // Each estimate is numbered: one overtaken by new photos or a new height while it ran is dropped.
  let runs = 0;
  const reset = () => { runs++; estimate = null; $('body-photo-result').hidden = true; $('body-photo-views').hidden = true; };
  for (const id of ['body-photo-height', 'body-photo-front', 'body-photo-side']) $(id).addEventListener('input', reset);
  button.addEventListener('click', async () => {
    reset();
    const run = runs, current = () => run === runs;
    try {
      const tall = height(), front = $<HTMLInputElement>('body-photo-front').files?.[0], side = $<HTMLInputElement>('body-photo-side').files?.[0];
      if (!front) throw new Error('Choose a front photo.');
      button.disabled = true;
      status.textContent = 'Reading the photos…';
      const detector = await loadPoseDetector();
      const frontPhoto = await picture(front);
      if (!current()) return;
      // Each outline is shown as soon as it is found, so a refused photo still shows what was seen.
      const frontMask = detector.outline(frontPhoto);
      show($<HTMLCanvasElement>('body-photo-front-view'), frontPhoto, frontMask, []);
      $('body-photo-side-view').hidden = true; $('body-photo-views').hidden = false;
      const frontMeasure = measureFront(frontMask, tall);
      show($<HTMLCanvasElement>('body-photo-front-view'), frontPhoto, frontMask, Object.values(frontMeasure.lines));
      let sideMeasure = null;
      if (side) {
        const photo = await picture(side);
        if (!current()) return;
        const mask = detector.outline(photo);
        show($<HTMLCanvasElement>('body-photo-side-view'), photo, mask, []);
        $('body-photo-side-view').hidden = false;
        sideMeasure = measureSide(mask, tall, frontMeasure.levels);
        show($<HTMLCanvasElement>('body-photo-side-view'), photo, mask, Object.values(sideMeasure.lines));
      }
      estimate = { ...estimateBody(frontMeasure, sideMeasure, tall), height: tall };
      const body = $('body-photo-rows');
      body.replaceChildren();
      for (const row of ROWS) {
        const value = row.key === 'height' ? tall : estimate[row.key];
        const tr = document.createElement('tr'), name = document.createElement('th'), cell = document.createElement('td'), basis = document.createElement('td');
        name.scope = 'row'; name.textContent = row.name;
        cell.textContent = value === null ? '—' : String(value);
        basis.textContent = row.key === 'height' ? 'As entered' : estimate.basis[row.key];
        if (value !== null && (value < row.range[0] || value > row.range[1])) basis.textContent += ` (outside ${row.range[0]}–${row.range[1]} cm, so it will not be used)`;
        tr.append(name, cell, basis); body.append(tr);
      }
      $('body-photo-result').hidden = false;
      status.textContent = `Estimated from the ${side ? 'front and side photos' : 'front photo'}. Check the lines on the photo${side ? 's' : ''}: they show where each was measured.`;
    } catch (error) {
      if (current()) status.textContent = error instanceof Error ? error.message : 'The photos could not be read.';
    } finally { button.disabled = false; if (!current() && status.textContent === 'Reading the photos…') status.textContent = ''; }
  });
  $('body-photo-use').addEventListener('click', () => {
    if (!estimate) return;
    const values: Partial<Record<BodyField, number>> = {};
    for (const row of ROWS) {
      const value = row.key === 'height' ? estimate.height : estimate[row.key];
      if (value !== null && value >= row.range[0] && value <= row.range[1]) values[row.field] = value;
    }
    const notes = options.fill(values);
    status.textContent = ['The estimates are in the body measurements as drafts: correct any you know, then apply the body settings.', ...notes].join(' ');
  });
}
