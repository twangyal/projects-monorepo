import { test, expect, type Page } from './expanded-workspace';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { parseGIF, decompressFrames } from 'gifuct-js';
import type { Project, Point } from '../src/model.ts';

const fixture = (): Project => ({ schemaVersion: 2, title: 'Shape authoring', background: '#ffffff', frameCount: 12, layers: [{ id: 'paint', name: 'Paint', kind: 'drawing', cels: [{ frame: 0, strokes: [] }], keys: [{ frame: 0, x: 320, y: 180, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] }] });
async function open(page: Page, project = fixture()) {
  await page.goto('/'); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#project-file').setInputFiles({ name: 'shape.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#project-title')).toHaveValue('Shape authoring');
  await page.locator('#layers button').filter({ hasText: 'Paint' }).click();
  await page.locator('#ink').fill('#000000');
}
async function download(page: Page, selector: string) {
  const waiting = page.waitForEvent('download'); await page.locator(selector).click();
  const path = await (await waiting).path(); if (!path) throw Error('Missing native download'); return readFile(path);
}
async function saved(page: Page) { return JSON.parse((await download(page, '#backup')).toString()) as Project; }
function strokes(p: Project) { const l = p.layers[0]; if (l.kind !== 'drawing') throw Error('Expected drawing'); return l.cels[0].strokes; }
async function coordinates(page: Page, x: number, y: number) {
  await page.locator('#stage').scrollIntoViewIfNeeded();
  const box = await page.locator('#stage').boundingBox(); if (!box) throw Error('Missing canvas');
  return { x: box.x + x * box.width / 640, y: box.y + y * box.height / 360 };
}
async function drag(page: Page, start: Point, end: Point) {
  const a = await coordinates(page, start.x, start.y), b = await coordinates(page, end.x, end.y);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
}
function near(points: Point[], expected: Point[]) {
  expect(points.length).toBe(expected.length);
  points.forEach((p, i) => { expect(p.x).toBeCloseTo(expected[i].x, 0); expect(p.y).toBeCloseTo(expected[i].y, 0); });
}

test('native rectangle becomes one retained edit with fill, reload and decoded PNG/GIF', async ({ page }) => {
  await open(page); await expect(page.getByRole('combobox', { name: 'Draw shape', exact: true })).toHaveValue('freehand');
  await page.getByRole('combobox', { name: 'Draw shape', exact: true }).selectOption('rectangle');
  await drag(page, { x: 280, y: 140 }, { x: 360, y: 220 });
  near(strokes(await saved(page))[0].points, [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }, { x: -40, y: -40 }]);
  await page.locator('#undo').click(); expect(strokes(await saved(page))).toHaveLength(0);
  await page.locator('#redo').click(); expect(strokes(await saved(page))).toHaveLength(1);
  await page.locator('#edit-strokes-mode').click(); await page.getByRole('button', { name: 'Stroke 1', exact: true }).click();
  await page.getByLabel('Enable stroke fill', { exact: true }).check(); await page.getByLabel('Selected stroke fill color', { exact: true }).fill('#ff0000'); await page.locator('#stroke-apply').click();
  const authored = await saved(page); expect(strokes(authored)[0].fill).toBe('#ff0000');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); await page.reload(); expect(await saved(page)).toEqual(authored);
  const offset = (180 * 640 + 320) * 4;
  const png = PNG.sync.read(await download(page, '#png')); expect([...png.data.subarray(offset, offset + 4)]).toEqual([255, 0, 0, 255]);
  const gif = await download(page, '#gif'); const frames = decompressFrames(parseGIF(gif.buffer.slice(gif.byteOffset, gif.byteOffset + gif.byteLength)), true);
  expect(frames).toHaveLength(12); for (const f of frames) expect([...f.patch.subarray(offset, offset + 4)]).toEqual([255, 0, 0, 255]);
});

test('line and ellipse follow rotated scaled local axes and retained point editing', async ({ page }) => {
  const p = fixture(); Object.assign(p.layers[0].keys[0], { rotation: 90, scale: 2 }); await open(page, p);
  await page.locator('#draw-shape').selectOption('line'); await drag(page, { x: 360, y: 100 }, { x: 280, y: 260 });
  near(strokes(await saved(page))[0].points, [{ x: -40, y: -20 }, { x: 40, y: 20 }]);
  await page.locator('#draw-shape').selectOption('ellipse'); await drag(page, { x: 280, y: 260 }, { x: 360, y: 100 });
  const points = strokes(await saved(page))[1].points; expect(points).toHaveLength(65);
  expect(points.at(-1)).toEqual(points[0]); near([points[0], points[16], points[32], points[48]], [{ x: 40, y: 0 }, { x: 0, y: 20 }, { x: -40, y: 0 }, { x: 0, y: -20 }]);
  await page.locator('#edit-strokes-mode').click(); await page.getByRole('button', { name: 'Stroke 2', exact: true }).click();
  await expect(page.locator('#stroke-point')).toBeVisible();
});

test('shape preview cancels on Escape, blur and geometry changes without persisted residue', async ({ page }) => {
  await open(page); await page.locator('#draw-shape').selectOption('rectangle');
  for (const cancel of ['escape', 'blur', 'resize']) {
    const a = await coordinates(page, 280, 140), b = await coordinates(page, 360, 220);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y);
    await expect(page.locator('#draw-shape')).toBeDisabled();
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'blur') await page.locator('#stage').evaluate(node => (node as HTMLElement).blur());
    if (cancel === 'resize') await page.setViewportSize({ width: 1050, height: 790 });
    await page.mouse.up(); await expect(page.locator('#draw-shape')).toBeEnabled(); expect(strokes(await saved(page))).toHaveLength(0);
  }
});

test('click and zero-area rectangle preserve Redo; pointerup-only endpoint is honored', async ({ page }) => {
  await open(page); await page.locator('#draw-shape').selectOption('line');
  await drag(page, { x: 200, y: 100 }, { x: 250, y: 150 }); await page.locator('#undo').click();
  await page.locator('#draw-shape').selectOption('rectangle');
  await drag(page, { x: 280, y: 140 }, { x: 280, y: 140 }); await drag(page, { x: 280, y: 140 }, { x: 280, y: 220 });
  expect(strokes(await saved(page))).toHaveLength(0); await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#redo').click();
  // Controlled pointer coordinates characterize the endpoint branch; other cases use native mouse events.
  const a = await coordinates(page, 280, 140), b = await coordinates(page, 360, 220);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.locator('#stage').dispatchEvent('pointerup', { pointerId: 1, isPrimary: true, button: 0, clientX: b.x, clientY: b.y });
  await page.mouse.up(); expect(strokes(await saved(page))).toHaveLength(2);
});

test('whole shape point-budget refusal is atomic and exact capacity remains usable', async ({ page }) => {
  const p = fixture(); const l = p.layers[0]; if (l.kind !== 'drawing') throw Error('Expected drawing');
  l.cels[0].strokes = Array.from({ length: 10 }, (_, i) => ({ color: '#000000', width: 1, points: Array.from({ length: i === 9 ? 945 : 999 }, () => ({ x: 0, y: 0 })) }));
  await open(page, p); await page.locator('#draw-shape').selectOption('ellipse');
  await drag(page, { x: 280, y: 140 }, { x: 360, y: 220 }); await expect(page.locator('#message')).toContainText('point limit'); expect(await saved(page)).toEqual(p);
  l.cels[0].strokes[9].points.pop(); await open(page, p); await page.locator('#draw-shape').selectOption('ellipse');
  await drag(page, { x: 280, y: 140 }, { x: 360, y: 220 }); expect(strokes(await saved(page)).reduce((n, s) => n + s.points.length, 0)).toBe(10000);
});

test('phone tool choice respects raw drafts and new shape remains editable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 }); await open(page);
  await page.locator('#pose-x').fill('27'); await page.locator('#draw-shape').selectOption('ellipse');
  await expect(page.locator('#draw-shape')).toHaveValue('freehand'); await expect(page.locator('#pose-x')).toHaveValue('27'); await expect(page.locator('#pose-draft-status')).toBeVisible();
  await page.locator('#discard-pose-edits').click(); await page.locator('#draw-shape').selectOption('ellipse');
  await drag(page, { x: 280, y: 140 }, { x: 360, y: 220 }); expect(strokes(await saved(page))[0].points).toHaveLength(65);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
