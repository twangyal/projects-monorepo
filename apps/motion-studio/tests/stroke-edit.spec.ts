import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { nativeCurrent, nativeCurrentRaw } from './native-saved-project.ts';
import { originalStrokeProject, literalMovedProject, literalMediaEdit, gifDelays, type OracleProject } from './stroke-edit-fixtures.ts';

async function download(page: Page, selector = '#backup') {
  const pending = page.waitForEvent('download'); await page.locator(selector).click();
  const path = await (await pending).path(); if (!path) throw Error('Native download is missing'); return readFile(path);
}
async function backup(page: Page): Promise<OracleProject> { return JSON.parse((await download(page)).toString('utf8')) as OracleProject; }
async function durable(page: Page, project: OracleProject) {
  await expect.poll(() => nativeCurrent(page)).toEqual(project);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
}
async function open(page: Page, project = originalStrokeProject()) {
  await page.goto('/'); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false'); await expect(page.locator('#project-file')).toBeEnabled();
  await page.locator('#project-file').setInputFiles({ name: 'original-strokes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#project-title')).toHaveValue(project.title); await durable(page, project);
  await page.locator('#layers button').filter({ hasText: 'Paint' }).click();
  await page.getByRole('button', { name: 'Edit strokes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Selected drawing strokes', exact: true })).toBeVisible();
}
async function select(page: Page, index: number) { await page.getByRole('button', { name: `Stroke ${index + 1}`, exact: true }).click(); }
async function frame(page: Page, value: number) {
  await page.locator('#frame').evaluate((node, value) => { (node as HTMLInputElement).value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', String(value));
}
async function coordinates(page: Page, x: number, y: number) {
  await page.locator('#stage').scrollIntoViewIfNeeded(); const box = await page.locator('#stage').boundingBox(); if (!box) throw Error('Stage has no native geometry');
  return { x: box.x + x * box.width / 640, y: box.y + y * box.height / 360, box };
}
async function drag(page: Page, from: [number, number], to: [number, number], release = true) {
  const a = await coordinates(page, ...from); await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(a.box.x + to[0] * a.box.width / 640, a.box.y + to[1] * a.box.height / 360, { steps: 5 });
  if (release) await page.mouse.up();
}
async function clickStage(page: Page, x: number, y: number) { const point = await coordinates(page, x, y); await page.mouse.click(point.x, point.y); }
function rigidGraph(actual: OracleProject, expected: OracleProject, index = 1) {
  // Predeclared native CSS-coordinate rounding tolerance: <0.005 local units per point.
  const points = actual.layers[0].cels[0].strokes[index].points, desired = expected.layers[0].cels[0].strokes[index].points;
  expect(points).toHaveLength(desired.length);
  for (let i = 0; i < points.length; i++) { expect(points[i].x).toBeCloseTo(desired[i].x, 2); expect(points[i].y).toBeCloseTo(desired[i].y, 2); }
  const rest = structuredClone(actual); rest.layers[0].cels[0].strokes[index].points = structuredClone(desired); expect(rest).toEqual(expected);
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const messages: string[] = []; errors.set(page, messages); page.on('pageerror', error => messages.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test('rotated scaled overlap drag changes one entire path once and preserves independent cel, keys and PNG', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original);
  await drag(page, [190, 120], [210, 110]);
  const moved = await backup(page); rigidGraph(moved, literalMovedProject());
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(original);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(moved); await durable(page, moved);
});

test('native overlap, one-point and repeated-point picks plus list selection cause no history or native save', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original); const saved = await nativeCurrentRaw(page);
  const undoDisabled = await page.locator('#undo').isDisabled();
  for (const [x, y, color, width] of [[190, 120, '#0000ff', '4'], [180, 170, '#00ff00', '10'], [160, 190, '#ffff00', '8']] as const) {
    await clickStage(page, x, y); await expect(page.locator('#stroke-color')).toHaveValue(color); await expect(page.locator('#stroke-width')).toHaveValue(width);
  }
  await select(page, 0); await expect(page.locator('#stroke-color')).toHaveValue('#ff0000');
  expect(await backup(page)).toEqual(original); expect(await nativeCurrentRaw(page)).toEqual(saved); expect(await page.locator('#undo').isDisabled()).toBe(undoDisabled);
});

test('appearance Apply, same-value no-op and deletion have independent reversible full-graph history', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original); await select(page, 1);
  await page.locator('#stroke-color').fill('#800080'); await page.locator('#stroke-width').fill('7.250'); await page.locator('#stroke-apply').click();
  const changed = structuredClone(original); Object.assign(changed.layers[0].cels[0].strokes[1], { color: '#800080', width: 7.25 }); expect(await backup(page)).toEqual(changed);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(original); await select(page, 1);
  // Same-value Apply can be disabled, or enabled and produce a no-op; neither may consume Redo.
  if (await page.locator('#stroke-apply').isEnabled()) await page.locator('#stroke-apply').click();
  await expect(page.locator('#redo')).toBeEnabled(); await page.locator('#redo').click(); expect(await backup(page)).toEqual(changed);
  await select(page, 1); await page.locator('#stroke-delete').click(); const deleted = structuredClone(changed); deleted.layers[0].cels[0].strokes.splice(1, 1); expect(await backup(page)).toEqual(deleted);
  await expect(page.locator('#stroke-delete')).toBeDisabled(); await page.locator('#undo').click(); expect(await backup(page)).toEqual(changed);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(deleted);
  for (let count = 3; count > 0; count--) { await select(page, 0); await page.locator('#stroke-delete').click(); }
  const blank = structuredClone(deleted); blank.layers[0].cels[0].strokes = []; expect(await backup(page)).toEqual(blank);
  await page.locator('#undo').click(); expect((await backup(page)).layers[0].cels[0].strokes).toHaveLength(1);
});

test('raw width node and caret survive refused actions; pointer admission preserves unrelated preblur pose', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original); await select(page, 1);
  const width = page.locator('#stroke-width'); await width.fill('7e-'); await width.focus();
  await width.evaluate(node => { node.setAttribute('data-oracle-node', 'retained'); (node as HTMLInputElement).setSelectionRange(1, 2); });
  await page.getByRole('button', { name: 'Stroke 1', exact: true }).click();
  await expect(width).toHaveValue('7e-'); await expect(width).toHaveAttribute('data-oracle-node', 'retained'); await expect(width).toBeFocused();
  expect(await width.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([1, 2]);
  expect(await backup(page)).toEqual(original); await page.locator('#stroke-discard').click(); await expect(width).toHaveValue('4');
  const x = page.locator('#pose-x'); await x.fill('211'); await x.focus(); await x.evaluate(node => node.setAttribute('data-oracle-pose', 'same'));
  await select(page, 0); await expect(x).toHaveValue('211'); await expect(x).toHaveAttribute('data-oracle-pose', 'same'); await expect(x).toBeFocused();
  expect(await nativeCurrent(page)).toEqual(original); await page.locator('#discard-pose-edits').click(); expect(await backup(page)).toEqual(original);
});

test('Escape, actual viewport resize and out-of-bounds motion cancel whole gestures without consuming Redo', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original); await select(page, 1); await page.locator('#stroke-width').fill('5'); await page.locator('#stroke-apply').click(); const future = await backup(page); await page.locator('#undo').click();
  await drag(page, [190, 120], [210, 110], false); await page.keyboard.press('Escape'); await page.mouse.up(); expect(await backup(page)).toEqual(original); await expect(page.locator('#redo')).toBeEnabled();
  await drag(page, [190, 120], [210, 110], false); const viewport = page.viewportSize()!; await page.setViewportSize({ width: viewport.width - 40, height: viewport.height }); await page.mouse.up(); expect(await backup(page)).toEqual(original); await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(future);
  const edge = originalStrokeProject(); edge.title = 'Literal local boundary'; edge.layers[0].keys[0] = { ...edge.layers[0].keys[0], x: 200, y: 100, scale: 0.1, rotation: 0 };
  edge.layers[0].cels[0].strokes = [{ color: '#ff0000', width: 40, points: [{ x: 1279, y: 0 }, { x: 1280, y: 0 }] }]; await open(page, edge);
  await drag(page, [327.95, 100], [330, 100]); expect(await backup(page)).toEqual(edge);
});

test('frame, layer and history replacements retire selected indices instead of deleting a new occupant', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original); await select(page, 1); await frame(page, 1);
  await expect(page.locator('#stroke-delete')).toBeDisabled(); expect(await backup(page)).toEqual(original);
  await select(page, 1); await frame(page, 6); await expect(page.locator('#stroke-delete')).toBeDisabled(); expect(await backup(page)).toEqual(original);
  await select(page, 0); await page.locator('#layers button').filter({ hasText: 'Moving cyan control' }).click(); await expect(page.locator('#stroke-delete')).toBeDisabled();
  await page.locator('#layers button').filter({ hasText: 'Paint' }).click(); await frame(page, 0); await select(page, 1); await page.locator('#stroke-delete').click(); await page.locator('#undo').click();
  await expect(page.locator('#stroke-delete')).toBeDisabled(); expect(await backup(page)).toEqual(original);
});

test('new stroke selection and changed-back input retire a held genuine File read without stale publication', async ({ page }) => {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    const gate = { entered: false, delivered: false, release: () => {} }; Object.assign(window, { strokeFileGate: gate });
    File.prototype.text = async function () { const text = await original.call(this); if (this.name === 'held-stroke-import.json') { gate.entered = true; await new Promise<void>(resolve => { gate.release = resolve; }); gate.delivered = true; } return text; };
  });
  const original = originalStrokeProject(); await open(page, original); await select(page, 1);
  const incoming = originalStrokeProject(true); incoming.title = 'Late unrelated imported artwork';
  await page.locator('#project-file').setInputFiles({ name: 'held-stroke-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await expect.poll(() => page.evaluate(() => (window as unknown as { strokeFileGate: { entered: boolean } }).strokeFileGate.entered)).toBe(true);
  // Import admission clears transient selection. Explicit re-selection is itself newer editing intent.
  await select(page, 1); await page.locator('#stroke-width').fill('9'); await page.locator('#stroke-width').fill('4'); await page.locator('#stroke-width').focus();
  await page.evaluate(() => (window as unknown as { strokeFileGate: { release(): void } }).strokeFileGate.release());
  await expect.poll(() => page.evaluate(() => (window as unknown as { strokeFileGate: { delivered: boolean } }).strokeFileGate.delivered)).toBe(true);
  expect(await backup(page)).toEqual(original); await expect(page.locator('#project-title')).toHaveValue(original.title); await expect(page.locator('#stroke-width')).toHaveValue('4');
  // Changed-back raw intent remains dirty until explicit Discard; only then start a fresh import.
  await page.locator('#stroke-discard').click();
  await page.locator('#project-file').setInputFiles({ name: 'fresh-stroke-import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
  await expect(page.locator('#project-title')).toHaveValue(incoming.title); await durable(page, incoming); expect(await backup(page)).toEqual(incoming);
});

test('390px trusted touch selection and focused keyboard correction preserve stage-axis math and field editing', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const target = await context.newPage(); const original = originalStrokeProject(); await open(target, original);
    const point = await coordinates(target, 190, 120); await target.touchscreen.tap(point.x, point.y); await expect(target.locator('#stroke-width')).toHaveValue('4');
    const button = target.getByRole('button', { name: 'Stroke 2', exact: true }); await button.focus(); await button.press('Shift+ArrowRight'); await button.press('Shift+ArrowRight'); await button.press('Shift+ArrowUp');
    const actual = await backup(target); rigidGraph(actual, literalMovedProject());
    await select(target, 1); const width = target.locator('#stroke-width'); await width.fill('40'); await width.press('ArrowLeft'); await width.press('Backspace'); await expect(width).toHaveValue('0'); expect(await backup(target)).toEqual(actual);
    await target.locator('#stroke-discard').click(); await select(target, 1); await button.focus(); await button.press('Delete'); const deleted = structuredClone(actual); deleted.layers[0].cels[0].strokes.splice(1, 1); expect(await backup(target)).toEqual(deleted);
    await target.locator('#undo').click(); expect(await backup(target)).toEqual(actual);
  } finally { await context.close(); }
});

function assertPixels(data: Uint8Array | Uint8ClampedArray, frameNumber: number) {
  const at = (x: number, y: number) => Array.from(data.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 4));
  expect(at(320, 180)).toEqual(frameNumber < 6 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  expect(at(320, 220)).toEqual(frameNumber < 6 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
  expect(at(280, 180)).toEqual([255, 0, 0, 255]); expect(at(450 + frameNumber * 4, 280)).toEqual([0, 255, 255, 255]);
  expect(at(550, 40)).toEqual([255, 0, 255, 255]); expect(at(220, 120)).toEqual([0, 255, 0, 255]); expect(at(240, 240)).toEqual([255, 255, 0, 255]);
  for (const [x, y] of [[290, 220], [350, 220], [320, 210], [320, 230], [20, 20]]) expect(at(x, y)).toEqual([255, 255, 255, 255]);
}
test('actual PNG and twelve decoded GIF frames retain held cuts, moving pose, embedded image and reload graph', async ({ page }) => {
  test.setTimeout(60_000); await open(page, originalStrokeProject(true)); await drag(page, [320, 180], [320, 220]); const edited = await backup(page); rigidGraph(edited, literalMediaEdit()); await durable(page, edited);
  for (const n of [0, 5, 6, 11]) { await frame(page, n); await select(page, 1); const png = PNG.sync.read(await download(page, '#png')); expect([png.width, png.height]).toEqual([640, 360]); assertPixels(png.data, n); }
  const bytes = await download(page, '#gif'); const gif = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); const frames = decompressFrames(gif, true);
  expect(frames).toHaveLength(12); expect(frames.map(value => value.delay)).toEqual(gifDelays); expect(frames.reduce((n, value) => n + value.delay, 0)).toBe(1000);
  frames.forEach((value, n) => { expect(value.dims).toEqual({ top: 0, left: 0, width: 640, height: 360 }); assertPixels(value.patch!, n); });
  expect(await backup(page)).toEqual(edited); await page.reload(); await expect(page.locator('#project-title')).toHaveValue(edited.title); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false'); expect(await backup(page)).toEqual(edited);
});

test('canceled translation ignores late pointerup and preserves subsequent raw title intent', async ({ page }) => {
  const original = originalStrokeProject(); await open(page, original); await drag(page, [190, 120], [210, 110], false);
  const title = page.locator('#project-title'); await expect(title).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(title).toBeEnabled();
  await title.fill('New raw title <keep>'); await title.focus(); await title.evaluate(node => { node.setAttribute('data-oracle-title', 'same'); (node as HTMLInputElement).setSelectionRange(4, 7); }); await page.mouse.up();
  await expect(title).toHaveValue('New raw title <keep>'); await expect(title).toHaveAttribute('data-oracle-title', 'same'); await expect(title).toBeFocused();
  expect(await title.evaluate(node => [(node as HTMLInputElement).selectionStart, (node as HTMLInputElement).selectionEnd])).toEqual([4, 7]);
  // Inspect durable state without a backup button blur, then explicitly commit only the title.
  expect(await nativeCurrent(page)).toEqual(original); await title.press('Tab'); const committed = structuredClone(original); committed.title = 'New raw title <keep>'; expect(await backup(page)).toEqual(committed);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(original);
});


test('unchanged native color control preserves original uppercase color bytes and Redo', async ({ page }) => {
  const original = originalStrokeProject(); original.title = 'Original uppercase color spelling'; original.layers[0].cels[0].strokes[1].color = '#0000FF';
  await open(page, original); await select(page, 1); await expect(page.locator('#stroke-color')).toHaveValue('#0000ff');
  await select(page, 0); await page.locator('#stroke-width').fill('5'); await page.locator('#stroke-apply').click(); const edited = await backup(page);
  const intended = structuredClone(original); intended.layers[0].cels[0].strokes[0].width = 5;
  // Establish real Redo on a different stroke, isolating unchanged uppercase Apply.
  expect(edited).toEqual(intended); await page.locator('#undo').click(); await durable(page, original); const saved = await nativeCurrentRaw(page);
  await select(page, 1); if (await page.locator('#stroke-apply').isEnabled()) await page.locator('#stroke-apply').click();
  expect(await backup(page)).toEqual(original); expect(await nativeCurrentRaw(page)).toEqual(saved); await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(intended);
});
