// The product editor: start from a template, style each part in real-time 3D, place artwork, see the
// linked pattern pieces, and export renders or a 3D model. Every change is one undoable project edit.
import { paintTile } from './fabric-texture.ts';
import {
  LAYOUTS, LAYOUT_NAMES, LIMITS, MATERIALS, MOTIFS, MOTIF_NAMES, PART_IDS, PART_NAMES, TEMPLATES,
  material, patternPieces, template, validateProduct, type Artwork, type PartId, type Print, type Product,
} from './product.ts';
import type { Project } from './model.ts';

const PALETTE = ['#f4f2ec', '#1c1c1e', '#1f2a4f', '#3f5468', '#9fae91', '#d89476', '#b23a2e', '#e9c46a', '#efe8d8', '#7b6d8d'];
const DRAG_TYPE = 'application/x-clothing-swatch';
type Swatch = { kind: 'material'; id: string } | { kind: 'color'; value: string } | { kind: 'print'; motif: Print['motif'] };

export const productMarkup = `<section class="panel product-panel" id="product-editor" aria-labelledby="product-heading">
  <div class="product-head"><div><p class="eyebrow">3D PRODUCT DESIGN</p><h3 id="product-heading">Style a garment in 3D</h3>
  <p>Start from a template, then drag fabrics, colors and prints onto any part of the garment, or select a part and choose from the library. Fabrics and prints render at real size.</p></div>
  <div class="product-name"><label class="field">Product name<input id="product-name" maxlength="80" autocomplete="off"></label></div></div>
  <div class="product-templates" role="list" aria-label="Templates">${TEMPLATES.map(t => `<div role="listitem"><button class="template-card" data-template="${t.id}" aria-label="Use the ${t.name} template: ${t.description}"><strong>${t.name}</strong><span>${t.description}</span></button></div>`).join('')}</div>
  <div class="product-grid">
    <aside class="product-library" aria-label="Library">
      <p class="eyebrow">FABRICS</p><div class="library-list" id="material-list">${MATERIALS.map(m => `<button class="library-swatch" draggable="true" data-swatch='${JSON.stringify({ kind: 'material', id: m.id })}' aria-label="Apply ${m.name}"><canvas width="44" height="44" data-material-preview="${m.id}" aria-hidden="true"></canvas><span>${m.name}<small>${m.gsm} gsm</small></span></button>`).join('')}</div>
      <p class="eyebrow">COLORS</p><div class="color-chips">${PALETTE.map(c => `<button class="color-chip" draggable="true" style="background:${c}" data-swatch='${JSON.stringify({ kind: 'color', value: c })}' aria-label="Apply color ${c}"></button>`).join('')}</div>
      <p class="eyebrow">PRINTS</p><div class="library-list">${MOTIFS.map(m => `<button class="library-swatch" draggable="true" data-swatch='${JSON.stringify({ kind: 'print', motif: m })}' aria-label="Apply ${MOTIF_NAMES[m]} print"><canvas width="44" height="44" data-print-preview="${m}" aria-hidden="true"></canvas><span>${MOTIF_NAMES[m]}</span></button>`).join('')}</div>
      <p class="fine-print">Drag onto the garment, or select a part and click.</p>
    </aside>
    <div class="product-stage">
      <canvas id="product-canvas" aria-label="3D garment. Drag to orbit; click a part to select it." tabindex="0"></canvas>
      <div class="view-buttons" role="group" aria-label="Camera view">${['front', 'back', 'left', 'right'].map(v => `<button data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
      <div class="part-list" role="radiogroup" aria-label="Garment parts">${PART_IDS.map(id => `<label><input type="radio" name="product-part" value="${id}"> ${PART_NAMES[id]}</label>`).join('')}</div>
      <p id="product-status" class="fine-print" role="status"></p>
    </div>
    <aside class="product-inspector" aria-label="Selected part">
      <h4 id="inspector-heading">Front body</h4>
      <label class="field">Fabric<select id="part-material">${MATERIALS.map(m => `<option value="${m.id}">${m.name} · ${m.gsm} gsm</option>`).join('')}</select></label>
      <div class="color-row"><label for="part-color">Fabric color</label><input id="part-color" type="color"></div>
      <label class="field">Print<select id="part-print"><option value="">No print</option>${MOTIFS.map(m => `<option value="${m}">${MOTIF_NAMES[m]}</option>`).join('')}</select></label>
      <div class="print-options"><div class="color-row"><label for="print-color">Print color</label><input id="print-color" type="color"></div>
        <label class="field">Repeat<select id="print-layout">${LAYOUTS.map(l => `<option value="${l}">${LAYOUT_NAMES[l]}</option>`).join('')}</select></label>
        <label class="field">Repeat size (cm)<input id="print-scale" type="number" min="${LIMITS.scaleCm[0]}" max="${LIMITS.scaleCm[1]}" step="0.5"></label></div>
      <button id="apply-all-parts" class="quiet">Use this style on every part</button>
      <p class="eyebrow">MEASUREMENTS</p>
      <div class="measure-grid"><label class="field">Chest (cm)<input id="product-chest" type="number" min="${LIMITS.chest[0]}" max="${LIMITS.chest[1]}" step="1"></label>
        <label class="field">Body length (cm)<input id="product-length" type="number" min="${LIMITS.length[0]}" max="${LIMITS.length[1]}" step="1"></label>
        <label class="field">Sleeve length (cm)<input id="product-sleeve" type="number" min="${LIMITS.sleeve[0]}" max="${LIMITS.sleeve[1]}" step="1"></label>
        <label class="field">Neckline<select id="product-neckline"><option value="crew">Crew neck</option><option value="v">V-neck</option></select></label></div>
      <button id="apply-measurements">Apply measurements</button>
      <p class="eyebrow">ARTWORK</p>
      <label class="field">Artwork side<select id="artwork-side"><option value="front">Front</option><option value="back">Back</option></select></label>
      <label class="button quiet file-button">Upload artwork (PNG, JPEG, WebP)<input id="artwork-file" type="file" accept="image/png,image/jpeg,image/webp"></label>
      <div class="measure-grid"><label class="field">Artwork width (cm)<input id="artwork-width" type="number" min="${LIMITS.artworkWidthCm[0]}" max="${LIMITS.artworkWidthCm[1]}" step="0.5"></label>
        <label class="field">From centre (cm)<input id="artwork-x" type="number" step="0.5"></label>
        <label class="field">Below shoulder (cm)<input id="artwork-y" type="number" step="0.5"></label></div>
      <div class="inline-actions"><button id="apply-artwork">Apply placement</button><button id="remove-artwork" class="quiet">Remove artwork</button></div>
    </aside>
  </div>
  <div class="pattern-strip"><div><p class="eyebrow">LINKED PATTERN PIECES</p><p class="fine-print">Finished size in cm, without seam allowance. The same fabrics and prints as the 3D garment; click a piece to select its part.</p></div><div id="product-pieces"></div></div>
  <div class="product-exports"><button id="product-png-front" class="product-export">Export front render PNG ↓</button><button id="product-png-back" class="product-export">Export back render PNG ↓</button><button id="product-glb" class="product-export">Export 3D model (GLB) ↓</button></div>
  <p class="fine-print">A styling model built from the measurements, not a fitted drape: fabric weight and stretch do not change its shape here. Renders and the GLB use the shapes shown.</p>
</section>`;

export function mountProduct(options: { current: () => Project; commit: (next: Project) => void; notice: (text: string, error?: boolean) => void; download: (blob: Blob, suffix: string) => void }) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $('product-canvas') as HTMLCanvasElement;
  let selected: PartId = 'front', scene: import('./product-3d.ts').ProductScene | null = null, shown = '';
  const ready = import('./product-3d.ts').then(({ ProductScene }) => { scene = new ProductScene(canvas); shown = ''; render(options.current()); return scene; })
    .catch(() => { $('product-status').textContent = 'This browser could not start the 3D view (WebGL is required). Pattern pieces and editing still work.'; return null; });

  // Library previews use the same tiles as the garment.
  for (const preview of document.querySelectorAll<HTMLCanvasElement>('[data-material-preview]')) {
    const tile = paintTile({ material: preview.dataset.materialPreview!, color: '#d8d2c4', print: null }).canvas;
    preview.getContext('2d')!.drawImage(tile, 0, 0, 44, 44);
  }
  for (const preview of document.querySelectorAll<HTMLCanvasElement>('[data-print-preview]')) {
    const tile = paintTile({ material: 'jersey-180', color: '#efe8d8', print: { motif: preview.dataset.printPreview as Print['motif'], color: '#1f2a4f', scaleCm: 6, layout: 'grid' } }).canvas;
    preview.getContext('2d')!.drawImage(tile, 0, 0, 44, 44);
  }

  const product = () => options.current().product ?? null;
  function update(mutate: (draft: Product) => void, text: string) {
    const current = product() ?? template('blank');
    const draft = structuredClone(current);
    try { mutate(draft); options.commit({ ...options.current(), product: validateProduct(draft) }); options.notice(text); }
    catch (error) { options.notice(error instanceof Error ? error.message : 'That change is not valid.', true); }
  }
  function applySwatch(part: PartId, swatch: Swatch) {
    update(draft => {
      const style = draft.parts[part];
      if (swatch.kind === 'material') { material(swatch.id); style.material = swatch.id; }
      else if (swatch.kind === 'color') style.color = swatch.value;
      else style.print = { motif: swatch.motif, color: style.print?.color ?? '#1f2a4f', scaleCm: style.print?.scaleCm ?? 6, layout: style.print?.layout ?? 'grid' };
    }, `${PART_NAMES[part]}: ${swatch.kind === 'material' ? material(swatch.id).name : swatch.kind === 'color' ? `color ${swatch.value}` : `${MOTIF_NAMES[swatch.motif]} print`}.`);
  }
  const parseSwatch = (raw: string | undefined): Swatch | null => { try { return raw ? JSON.parse(raw) as Swatch : null; } catch { return null; } };

  // Library: click applies to the selected part; drag applies to the part under the drop point.
  for (const button of document.querySelectorAll<HTMLElement>('#product-editor [data-swatch]')) {
    button.addEventListener('click', () => { const swatch = parseSwatch(button.dataset.swatch); if (swatch) applySwatch(selected, swatch); });
    button.addEventListener('dragstart', event => { event.dataTransfer?.setData(DRAG_TYPE, button.dataset.swatch!); event.dataTransfer!.effectAllowed = 'copy'; });
  }
  canvas.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  canvas.addEventListener('drop', event => {
    event.preventDefault();
    const swatch = parseSwatch(event.dataTransfer?.getData(DRAG_TYPE)), part = scene?.pick(event.clientX, event.clientY);
    if (!swatch) return;
    if (!part) { options.notice('Drop the swatch onto a part of the garment.', true); return; }
    selected = part; applySwatch(part, swatch);
  });
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', event => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 4) { down = null; return; }
    down = null; const part = scene?.pick(event.clientX, event.clientY);
    if (part) { selected = part; render(options.current()); }
  });
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name=product-part]')) radio.addEventListener('change', () => { selected = radio.value as PartId; render(options.current()); });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => scene?.setView(button.dataset.view as 'front'));
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-template]')) button.addEventListener('click', () => {
    const current = product();
    const name = TEMPLATES.find(item => item.id === button.dataset.template)?.name ?? 'chosen';
    if (current && !window.confirm(`Replace “${current.name}” with the ${name} template? You can undo this.`)) return;
    const next = template(button.dataset.template!);
    options.commit({ ...options.current(), product: next }); options.notice(`${next.name} template loaded. Style any part to make it yours.`);
  });

  // Inspector fields commit on change.
  $('part-material').addEventListener('change', () => applySwatch(selected, { kind: 'material', id: ($('part-material') as HTMLSelectElement).value }));
  $('part-color').addEventListener('change', () => applySwatch(selected, { kind: 'color', value: ($('part-color') as HTMLInputElement).value }));
  $('part-print').addEventListener('change', () => {
    const motif = ($('part-print') as HTMLSelectElement).value;
    if (motif) applySwatch(selected, { kind: 'print', motif: motif as Print['motif'] });
    else update(draft => { draft.parts[selected].print = null; }, `${PART_NAMES[selected]}: print removed.`);
  });
  for (const id of ['print-color', 'print-layout', 'print-scale']) $(id).addEventListener('change', () => update(draft => {
    const print = draft.parts[selected].print;
    if (!print) throw new Error('Choose a print for this part first.');
    print.color = ($('print-color') as HTMLInputElement).value; print.layout = ($('print-layout') as HTMLSelectElement).value as Print['layout'];
    print.scaleCm = Number(($('print-scale') as HTMLInputElement).value);
  }, `${PART_NAMES[selected]}: print updated.`));
  $('apply-all-parts').addEventListener('click', () => update(draft => {
    const style = draft.parts[selected];
    for (const id of PART_IDS) if (id !== selected) draft.parts[id] = id === 'neckband' ? { ...structuredClone(style), material: draft.parts.neckband.material, print: null } : structuredClone(style);
  }, `Every part now uses the ${PART_NAMES[selected].toLowerCase()} style (the neck rib keeps its rib knit).`));
  $('product-name').addEventListener('change', () => update(draft => { draft.name = ($('product-name') as HTMLInputElement).value; }, 'Product renamed.'));
  $('apply-measurements').addEventListener('click', () => update(draft => {
    draft.measurements = { chest: Number(($('product-chest') as HTMLInputElement).value), length: Number(($('product-length') as HTMLInputElement).value), sleeve: Number(($('product-sleeve') as HTMLInputElement).value) };
    draft.neckline = ($('product-neckline') as HTMLSelectElement).value as Product['neckline'];
    // Artwork that no longer fits the panel is pulled back inside rather than rejected.
    for (const art of draft.artwork) { const half = draft.measurements.chest / 4 + 1; art.xCm = Math.max(-half, Math.min(half, art.xCm)); art.yCm = Math.min(art.yCm, draft.measurements.length); }
  }, 'Measurements applied to the 3D garment and its pattern pieces.'));

  // Artwork: transparent PNG kept, scaled to at most 1024 px.
  $('artwork-file').addEventListener('change', async () => {
    const input = $('artwork-file') as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file) return;
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP image of at most 10 MB.');
      const bitmap = await createImageBitmap(file);
      let edge = Math.min(1024, Math.max(bitmap.width, bitmap.height)), dataUrl = '', width = 0, height = 0;
      for (; edge >= 128; edge = Math.round(edge * 0.75)) {
        const scale = edge / Math.max(bitmap.width, bitmap.height), c = document.createElement('canvas');
        width = c.width = Math.max(1, Math.round(bitmap.width * scale)); height = c.height = Math.max(1, Math.round(bitmap.height * scale));
        c.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); dataUrl = c.toDataURL('image/png');
        if (dataUrl.length <= LIMITS.artworkBytes * 1.33) break;
      }
      bitmap.close();
      const side = ($('artwork-side') as HTMLSelectElement).value as Artwork['part'];
      update(draft => {
        draft.artwork = draft.artwork.filter(art => art.part !== side);
        draft.artwork.push({ part: side, dataUrl, width, height, name: file.name.slice(0, 120), xCm: 0, yCm: side === 'front' ? 10 : 12, widthCm: Math.min(24, draft.measurements.chest / 4) });
      }, `Artwork placed on the ${side}. Adjust its width and position below.`);
    } catch (error) { options.notice(error instanceof Error ? error.message : 'That image could not be used.', true); }
  });
  $('apply-artwork').addEventListener('click', () => update(draft => {
    const side = ($('artwork-side') as HTMLSelectElement).value, art = draft.artwork.find(item => item.part === side);
    if (!art) throw new Error(`Upload artwork for the ${side} first.`);
    art.widthCm = Number(($('artwork-width') as HTMLInputElement).value); art.xCm = Number(($('artwork-x') as HTMLInputElement).value); art.yCm = Number(($('artwork-y') as HTMLInputElement).value);
  }, 'Artwork placement applied.'));
  $('remove-artwork').addEventListener('click', () => update(draft => {
    const side = ($('artwork-side') as HTMLSelectElement).value;
    if (!draft.artwork.some(art => art.part === side)) throw new Error(`There is no artwork on the ${side}.`);
    draft.artwork = draft.artwork.filter(art => art.part !== side);
  }, 'Artwork removed.'));
  $('artwork-side').addEventListener('change', () => render(options.current(), true));

  // Exports.
  const exporting = async (action: () => Promise<void>) => { try { await action(); } catch (error) { options.notice(error instanceof Error ? error.message : 'Export failed.', true); } };
  $('product-png-front').addEventListener('click', () => void exporting(async () => { const s = await ready; if (!s) throw new Error('The 3D view is unavailable.'); options.download(await s.png('front'), '-front.png'); }));
  $('product-png-back').addEventListener('click', () => void exporting(async () => { const s = await ready; if (!s) throw new Error('The 3D view is unavailable.'); options.download(await s.png('back'), '-back.png'); }));
  $('product-glb').addEventListener('click', () => void exporting(async () => { const s = await ready; if (!s) throw new Error('The 3D view is unavailable.'); options.download(new Blob([await s.glb()], { type: 'model/gltf-binary' }), '.glb'); }));

  function piecesSvg(design: Product): string {
    const pieces = patternPieces(design), gap = 6, scale = 3;
    let x = 0; const placed = pieces.map(piece => { const at = x; x += piece.width + gap; return { piece, at }; });
    const height = Math.max(...pieces.map(p => p.height));
    const defs = PART_IDS.map(id => {
      const { canvas: tile, tileCm } = paintTile(design.parts[id]);
      return `<pattern id="fill-${id}" patternUnits="userSpaceOnUse" width="${tileCm}" height="${tileCm}"><image href="${tile.toDataURL('image/png')}" width="${tileCm}" height="${tileCm}"/></pattern>`;
    }).join('');
    return `<svg viewBox="-2 -2 ${x + 4} ${height + 12}" width="${(x + 4) * scale}" role="img" aria-label="Pattern pieces: ${pieces.map(p => PART_NAMES[p.part]).join(', ')}"><defs>${defs}</defs>${placed.map(({ piece, at }) => `<g transform="translate(${at} 0)" data-piece="${piece.part}" class="pattern-piece${piece.part === selected ? ' is-selected' : ''}" tabindex="0" role="button" aria-label="${PART_NAMES[piece.part]}, ${piece.width.toFixed(1)} by ${piece.height.toFixed(1)} cm"><polygon points="${piece.outline.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}" fill="url(#fill-${piece.part})" stroke="#4b3b2f" stroke-width="0.4"/><text x="${piece.width / 2}" y="${height + 8}" text-anchor="middle" font-size="3.4">${PART_NAMES[piece.part]} · ${piece.width.toFixed(0)}×${piece.height.toFixed(0)} cm</text></g>`).join('')}</svg>`;
  }
  $('product-pieces').addEventListener('click', event => {
    const piece = (event.target as Element).closest<SVGGElement>('[data-piece]'); if (!piece) return;
    selected = piece.dataset.piece as PartId; render(options.current());
  });
  $('product-pieces').addEventListener('keydown', event => {
    const piece = (event.target as Element).closest<SVGGElement>('[data-piece]');
    if (piece && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selected = piece.dataset.piece as PartId; render(options.current()); }
  });

  function render(project: Project, sideOnly = false) {
    const design = project.product ?? template('blank');
    const style = design.parts[selected], side = ($('artwork-side') as HTMLSelectElement).value, art = design.artwork.find(item => item.part === side);
    ($('artwork-width') as HTMLInputElement).value = String(art?.widthCm ?? ''); ($('artwork-x') as HTMLInputElement).value = String(art?.xCm ?? ''); ($('artwork-y') as HTMLInputElement).value = String(art?.yCm ?? '');
    $('remove-artwork').toggleAttribute('disabled', !art); $('apply-artwork').toggleAttribute('disabled', !art);
    if (sideOnly) return;
    $('inspector-heading').textContent = PART_NAMES[selected];
    for (const radio of document.querySelectorAll<HTMLInputElement>('input[name=product-part]')) radio.checked = radio.value === selected;
    ($('part-material') as HTMLSelectElement).value = style.material; ($('part-color') as HTMLInputElement).value = style.color;
    ($('part-print') as HTMLSelectElement).value = style.print?.motif ?? '';
    for (const id of ['print-color', 'print-layout', 'print-scale']) ($(id) as HTMLInputElement).disabled = !style.print;
    ($('print-color') as HTMLInputElement).value = style.print?.color ?? '#1f2a4f'; ($('print-layout') as HTMLSelectElement).value = style.print?.layout ?? 'grid';
    ($('print-scale') as HTMLInputElement).value = String(style.print?.scaleCm ?? 6);
    ($('product-name') as HTMLInputElement).value = design.name;
    ($('product-chest') as HTMLInputElement).value = String(design.measurements.chest); ($('product-length') as HTMLInputElement).value = String(design.measurements.length);
    ($('product-sleeve') as HTMLInputElement).value = String(design.measurements.sleeve); ($('product-neckline') as HTMLSelectElement).value = design.neckline;
    const signature = JSON.stringify([design, selected]);
    if (signature !== shown) {
      shown = signature;
      $('product-pieces').innerHTML = piecesSvg(design);
      scene?.setProduct(design, selected);
      $('product-status').textContent = project.product ? `Editing ${design.name}. Selected: ${PART_NAMES[selected]} — ${material(style.material).name}${style.print ? `, ${MOTIF_NAMES[style.print.motif]} print` : ''}.`
        : 'Choose a template to start, or style the blank tee shown.';
    }
  }
  return { render: (project: Project) => render(project) };
}
