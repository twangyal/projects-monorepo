import { test, expect, type Page } from './expanded-workspace';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { parseGIF, decompressFrames } from 'gifuct-js';
const fixture = () => ({ schemaVersion: 2, title: 'Filled artwork', background: '#ffffff', frameCount: 12, layers: [{ id: 'paint', name: 'Paint', kind: 'drawing', cels: [{ frame: 0, strokes: [{ color: '#000000', width: 2, points: [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }] }] }], keys: [{ frame: 0, x: 320, y: 180, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] }] });
async function open(page: Page, project = fixture()) {
  await page.goto('/'); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#project-file').setInputFiles({ name: 'fill.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#project-title')).toHaveValue('Filled artwork');
  await page.locator('#layers button').filter({ hasText: 'Paint' }).click();
  await page.getByRole('button', { name: 'Edit strokes', exact: true }).click();
  await page.getByRole('button', { name: 'Stroke 1', exact: true }).click();
}
async function download(page: Page, selector: string) {
  const waiting = page.waitForEvent('download'); await page.locator(selector).click();
  const path = await (await waiting).path(); if (!path) throw Error('Missing native download'); return readFile(path);
}
async function pixel(page: Page, x = 320, y = 180) {
  return page.locator('#stage').evaluate((node, point) => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(point[0], point[1], 1, 1).data], [x, y]);
}
async function applyFill(page: Page) {
  await page.getByLabel('Enable stroke fill', { exact: true }).check();
  await page.getByLabel('Selected stroke fill color', { exact: true }).fill('#ff0000');
  await page.locator('#stroke-apply').click();
}
test('native fill edit reaches history reload and independently decoded PNG and GIF', async ({ page }) => {
  await open(page); expect(await pixel(page)).toEqual([255, 255, 255, 255]);
  await applyFill(page); expect(await pixel(page)).toEqual([255, 0, 0, 255]);
  // The implicit closing edge is not a new stroked black segment.
  expect(await pixel(page, 280, 180)).not.toEqual([0, 0, 0, 255]);
  const changed = JSON.parse((await download(page, '#backup')).toString()); expect(changed.layers[0].cels[0].strokes[0].fill).toBe('#ff0000');
  await page.locator('#undo').click(); expect(await pixel(page)).toEqual([255, 255, 255, 255]);
  await page.locator('#redo').click(); expect(await pixel(page)).toEqual([255, 0, 0, 255]);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Filled artwork'); expect(await pixel(page)).toEqual([255, 0, 0, 255]);
  const png = PNG.sync.read(await download(page, '#png')); const offset = (180 * 640 + 320) * 4;
  expect([...png.data.subarray(offset, offset + 4)]).toEqual([255, 0, 0, 255]);
  const gif = await download(page, '#gif'); const frames = decompressFrames(parseGIF(gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength)), true);
  expect(frames).toHaveLength(12); expect([...frames[0].patch.subarray(offset, offset + 4)]).toEqual([255, 0, 0, 255]);
});
test('fill drafts refuse unrelated frame changes and Discard preserves committed outline', async ({ page }) => {
  await open(page); await page.getByLabel('Enable stroke fill', { exact: true }).check();
  await page.getByLabel('Selected stroke fill color', { exact: true }).fill('#00ff00');
  await page.locator('#frame').evaluate(node => { const field = node as HTMLInputElement; field.value = '5'; field.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', '0');
  await expect(page.getByLabel('Enable stroke fill', { exact: true })).toBeChecked(); expect(await pixel(page)).toEqual([255, 255, 255, 255]);
  await page.locator('#stroke-discard').click(); await expect(page.getByLabel('Enable stroke fill', { exact: true })).not.toBeChecked();
  expect(JSON.parse((await download(page, '#backup')).toString())).toEqual(fixture());
});
test('filled interiors select natively and disabling fill retains the outline through phone keyboard Apply', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 });
  const project = fixture(); project.layers[0].keys[0].rotation = 90; project.layers[0].keys[0].scale = 1.5;
  project.layers[0].cels[0].strokes[0].points = [{ x: -40, y: -10 }, { x: 40, y: -10 }, { x: -40, y: 10 }];
  await open(page, project); await applyFill(page); expect(await pixel(page, 320, 128)).toEqual([255, 0, 0, 255]);
  await page.locator('#undo').click(); await page.locator('#redo').click();
  await expect(page.getByRole('button', { name: 'Stroke 1', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#stage').scrollIntoViewIfNeeded(); const box = await page.locator('#stage').boundingBox(); if (!box) throw Error('Missing stage geometry');
  // Literal local (-35, 0) becomes stage (320, 127.5); wrong rotation or scale misses this narrow triangle.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 127.5 / 360);
  await expect(page.getByRole('button', { name: 'Stroke 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Enable stroke fill', { exact: true }).uncheck(); await page.locator('#stroke-apply').focus(); await page.keyboard.press('Enter');
  expect(await pixel(page, 320, 128)).toEqual([255, 255, 255, 255]); expect(JSON.parse((await download(page, '#backup')).toString())).toEqual(project);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('neighbor guides tint filled interiors without changing committed frame export', async ({ page }) => {
  const project = fixture(), base = project.layers[0].cels[0];
  Object.assign(base.strokes[0], { fill: '#ff0000' });
  base.strokes[0].points = base.strokes[0].points.map(p => ({ x: p.x - 100, y: p.y }));
  const next = structuredClone(base); next.frame = 8; next.strokes[0].points = next.strokes[0].points.map(p => ({ x: p.x + 200, y: p.y }));
  project.layers[0].cels.push({ frame: 4, strokes: [] }, next); await open(page, project);
  await page.locator('#frame').fill('4'); await page.locator('#onion-enabled').check();
  const values = await page.locator('#onion-overlay').evaluate(node => {
    const ctx = (node as HTMLCanvasElement).getContext('2d')!;
    return [220, 420].map(x => [...ctx.getImageData(x, 180, 1, 1).data]);
  });
  for (const [actual, expected] of [[values[0], [8, 127, 140, 64]], [values[1], [196, 61, 100, 64]]]) {
    for (let i = 0; i < 4; i++) expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(i === 3 ? 0 : 2);
  }
  expect(await pixel(page, 220, 180)).toEqual([255, 255, 255, 255]);
  const png = PNG.sync.read(await download(page, '#png')); expect([...png.data.subarray((180 * 640 + 220) * 4, (180 * 640 + 220) * 4 + 4)]).toEqual([255, 255, 255, 255]);
});

test('reviewed fill interpolation renders literal midpoint color in native canvas', async ({ page }) => {
  await page.goto('/tests/tween-harness.html'); await expect(page.locator('#ready')).toContainText('ready');
  const result = await page.evaluate(project => {
    const layer = project.layers[0], end = structuredClone(layer.cels[0]); end.frame = 10;
    Object.assign(layer.cels[0].strokes[0], { fill: '#ff0000' }); Object.assign(end.strokes[0], { fill: '#0000ff' }); layer.cels.push(end);
    const h = window.tweenHarness, proposal = h.buildDrawingTween(project as Parameters<typeof h.buildDrawingTween>[0], { layerId: 'paint', startFrame: 0, endFrame: 10 }, { pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames: [5] });
    const preview = h.previewDrawingTween(project as Parameters<typeof h.previewDrawingTween>[0], proposal), canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d')!; h.createFrameRenderer(preview, new Map()).render(ctx, 5);
    return [...ctx.getImageData(320, 180, 1, 1).data];
  }, fixture());
  expect(result).toEqual([128, 0, 128, 255]);
});

test('endpoint thumbnails show filled interiors and mixed endpoint review refuses', async ({ page }) => {
  const project = fixture(), first = project.layers[0].cels[0], end = structuredClone(first); end.frame = 10;
  Object.assign(first.strokes[0], { fill: '#ff0000' }); project.layers[0].cels.push(end);
  await open(page, project);
  await page.locator('#make-tween').click(); await expect(page.locator('#tween-panel')).toBeVisible();
  await page.locator('#tween-start').selectOption('0');
  const thumbnail = page.locator('#tween-pairs canvas').first(); await expect(thumbnail).toBeAttached();
  expect(await thumbnail.evaluate(node => [...(node as HTMLCanvasElement).getContext('2d')!.getImageData(90, 50, 1, 1).data])).toEqual([255, 0, 0, 255]);
  await page.locator('#tween-pair-order').click(); await page.locator('#tween-review').click();
  await expect(page.locator('#tween-status')).toContainText('fill'); await expect(page.locator('#tween-apply')).toBeDisabled();
});
