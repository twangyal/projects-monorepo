import { test, expect, type Page, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { legacy, migrated, media, shortening, key, line, originalPng, type Film } from './cel-fixtures.ts';

async function bytes(download: Download) { const path = await download.path(); if (!path) throw Error('Native download missing'); return readFile(path); }
async function download(page: Page, selector = '#backup') { const waiting = page.waitForEvent('download'); await page.locator(selector).click(); return bytes(await waiting); }
async function backup(page: Page): Promise<Film> { return JSON.parse((await download(page)).toString('utf8')) as Film; }
async function open(page: Page, input: Film = legacy()) {
  await page.goto('/'); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
  await page.locator('#project-file').setInputFiles({ name: 'original-motion-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
  await expect(page.locator('#project-title')).toHaveValue(input.title);
  await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
}
async function scrub(page: Page, frame: number) {
  await page.locator('#frame').evaluate((input, value) => { (input as HTMLInputElement).value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, frame);
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', String(frame));
}
async function pixel(page: Page, x: number, y: number): Promise<number[]> { return page.locator('#stage').evaluate((node, point) => Array.from((node as HTMLCanvasElement).getContext('2d')!.getImageData(point.x, point.y, 1, 1).data), { x, y }); }
async function stroke(page: Page, from: [number, number], to: [number, number] = from) {
  await page.locator('#stage').scrollIntoViewIfNeeded(); const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.move(box.x + from[0] / 640 * box.width, box.y + from[1] / 360 * box.height); await page.mouse.down();
  if (from[0] !== to[0] || from[1] !== to[1]) await page.mouse.move(box.x + to[0] / 640 * box.width, box.y + to[1] / 360 * box.height, { steps: 4 });
  await page.mouse.up();
}
const diagnostics = new WeakMap<Page, { errors: string[]; external: string[] }>();
test.beforeEach(async ({ page, baseURL }) => {
  const state = { errors: [] as string[], external: [] as string[] }; diagnostics.set(page, state);
  page.on('dialog', dialog => dialog.accept());
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('request', request => { if (!/^(blob|data):/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL!).origin) state.external.push(request.url()); });
});
test.afterEach(async ({ page }) => { expect(diagnostics.get(page)?.errors).toEqual([]); expect(diagnostics.get(page)?.external).toEqual([]); });

test('valid legacy artwork opens before held drawing controls become available', async ({ page }) => {
  await open(page); expect(await pixel(page, 320, 180)).toEqual([255, 0, 0, 255]);
  await expect(page.getByRole('region', { name: 'Selected layer drawings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Duplicate held drawing at this frame', exact: true })).toBeVisible();
  expect(await backup(page)).toEqual(migrated(legacy()));
});

test('drawings duplicate independently, interior painting stays held, blank and deletion are exact reversible edits', async ({ page }) => {
  await open(page, legacy(true)); await page.locator('#ink').fill('#ff0000');
  await stroke(page, [240, 180], [400, 180]); const first = await backup(page);
  await scrub(page, 6); await page.locator('#duplicate-cel').click();
  await expect(page.locator('#duplicate-cel')).toBeFocused();
  await scrub(page, 8); await expect(page.locator('#drawing-status')).toContainText('frame 7');
  await page.locator('#ink').fill('#00ff00'); await stroke(page, [320, 220]);
  const second = await backup(page); expect(second.layers[0].cels?.map(cel => cel.frame)).toEqual([0, 6]);
  expect(second.layers[0].cels![0]).toEqual(first.layers[0].cels![0]); expect(second.layers[0].cels![1].strokes).toHaveLength(2);
  await scrub(page, 5); expect(await pixel(page, 320, 220)).toEqual([255, 255, 255, 255]);
  await scrub(page, 6); expect(await pixel(page, 320, 220)).toEqual([0, 255, 0, 255]);
  await scrub(page, 12); await page.locator('#add-blank-cel').click(); expect(await pixel(page, 320, 180)).toEqual([255, 255, 255, 255]);
  await page.locator('#ink').fill('#0000ff'); await stroke(page, [240, 180], [400, 180]);
  const final = await backup(page); expect(final.layers[0].cels?.map(cel => cel.frame)).toEqual([0, 6, 12]);
  await page.locator('#undo').click(); expect((await backup(page)).layers[0].cels![2].strokes).toEqual([]);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(final);
  await scrub(page, 18); await page.locator('#delete-cel').click();
  await expect(page.locator('#drawing-cels [data-cel-frame="6"]')).toBeFocused();
  expect((await backup(page)).layers[0].cels?.map(cel => cel.frame)).toEqual([0, 6]);
  expect(await pixel(page, 320, 220)).toEqual([0, 255, 0, 255]);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(final);
  await scrub(page, 0); await expect(page.locator('#delete-cel')).toBeDisabled(); await expect(page.locator('#duplicate-cel')).toBeDisabled();
  await expect(page.locator('#drawing-action-hint')).toContainText(/first|starts|frame/i);
});

async function pngPixel(page: Page, buffer: Buffer, x: number, y: number) {
  return page.evaluate(async ({ encoded, x, y }) => {
    const bytes = Uint8Array.from(atob(encoded), item => item.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0); const result = { width: bitmap.width, height: bitmap.height, rgba: Array.from(context.getImageData(x, y, 1, 1).data) }; bitmap.close(); return result;
  }, { encoded: buffer.toString('base64'), x, y });
}

test('downloaded PNG and all decoded GIF frames respect exact held cuts, blank interval and independent moving pose', async ({ page }) => {
  await open(page, media());
  for (const [frame, color] of [[5, [255, 0, 0, 255]], [6, [0, 0, 255, 255]], [11, [0, 0, 255, 255]], [12, [255, 255, 255, 255]], [23, [255, 255, 255, 255]]] as const) {
    await scrub(page, frame); const image = await pngPixel(page, await download(page, '#png'), 320, 180);
    expect(image).toEqual({ width: 640, height: 360, rgba: [...color] });
  }
  const encoded = await download(page, '#gif');
  const gif = parseGIF(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
  const frames = decompressFrames(gif, true); expect(frames).toHaveLength(24);
  expect(frames.map(frame => frame.delay)).toEqual(Array.from({ length: 24 }, (_, i) => 10 * (Math.round((i + 1) * 100 / 12) - Math.round(i * 100 / 12))));
  expect(frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(2000);
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]; expect(frame.dims).toEqual({ top: 0, left: 0, width: 640, height: 360 });
    const at = (x: number, y: number) => Array.from(frame.patch!.subarray((y * 640 + x) * 4, (y * 640 + x) * 4 + 4));
    expect(at(320, 180), `held artwork at stored frame ${i}`).toEqual(i < 6 ? [255, 0, 0, 255] : i < 12 ? [0, 0, 255, 255] : [255, 255, 255, 255]);
    expect(at(100 + 8 * Math.min(i, 12), 60), `moving control at stored frame ${i}`).toEqual([0, 255, 0, 255]);
    expect(at(20, 300)).toEqual([255, 255, 255, 255]);
  }
  expect(await backup(page)).toEqual(media());
});

async function record(page: Page, write?: { value: unknown }): Promise<unknown> {
  return page.evaluate(({ write }) => new Promise((resolve, reject) => {
    const opened = indexedDB.open('motion-studio', 1); opened.onerror = () => reject(opened.error);
    opened.onupgradeneeded = () => opened.result.createObjectStore('project');
    opened.onsuccess = () => { const db = opened.result, tx = db.transaction('project', write ? 'readwrite' : 'readonly'), store = tx.objectStore('project');
      const request = write ? store.put(write.value, 'current') : store.get('current');
      tx.oncomplete = () => { const value = request.result; db.close(); resolve(value); }; tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { write });
}

test('native stored schema1 migrates without a load write and actual schema2 edit survives reload', async ({ page }) => {
  await open(page); await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const original = { ...legacy(), harmlessExtension: { supplied: 'retain raw legacy field' } };
  await record(page, { value: original }); await page.reload();
  await expect(page.locator('#project-title')).toHaveValue(original.title); await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
  expect(await backup(page)).toEqual(migrated(legacy())); expect(await record(page)).toEqual(original);
  await scrub(page, 6); await page.locator('#duplicate-cel').click(); const edited = await backup(page);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); expect(await record(page)).toEqual(edited);
  await page.reload(); await expect(page.locator('#project-title')).toHaveValue(edited.title); expect(await backup(page)).toEqual(edited);
});

test('shortening asks exact multi-layer loss, refusal preserves all work and accepted resize is one reversible edit', async ({ page }) => {
  const original = shortening(); await open(page, original); await scrub(page, 32);
  page.removeAllListeners('dialog'); let dismissed = '';
  page.once('dialog', async dialog => { dismissed = dialog.message(); await dialog.dismiss(); });
  await page.locator('#duration').selectOption('24');
  expect(dismissed).toMatch(/3.*(?:drawing|cel)|(?:drawing|cel).*3/i); expect(dismissed).toMatch(/3.*(?:pose|key)|(?:pose|key).*3/i);
  expect(await backup(page)).toEqual(original); await expect(page.locator('#duration')).toHaveValue('48'); await expect(page.locator('#stage')).toHaveAttribute('data-frame', '32');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#duration').selectOption('24');
  const resized = await backup(page); expect(resized.frameCount).toBe(24);
  expect(resized.layers[0].cels?.map(cel => cel.frame)).toEqual([0, 12]); expect(resized.layers[1].cels?.map(cel => cel.frame)).toEqual([0]);
  expect(resized.layers[0].keys.at(-1)).toEqual(key(23, 330)); expect(resized.layers[1].keys.at(-1)).toEqual(key(23, 215, 60));
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(original); await page.locator('#redo').click(); expect(await backup(page)).toEqual(resized);
  await page.locator('#duration').selectOption('96'); const extended = await backup(page); expect(extended.frameCount).toBe(96); expect(extended.layers).toEqual(resized.layers);
});

test('aggregate duplicate rejection and no-op move preserve redo; occupied and first boundaries remain protected', async ({ page }) => {
  const input = migrated(legacy()); input.frameCount = 48;
  input.layers[0].cels![0].strokes = Array.from({ length: 100 }, () => ({ ...line(), points: Array.from({ length: 100 }, (_, i) => ({ x: i, y: 0 })) }));
  await open(page, input); await scrub(page, 12); await page.locator('#add-blank-cel').click();
  const withBlank = await backup(page); await page.locator('#undo').click(); await expect(page.locator('#redo')).toBeEnabled();
  await scrub(page, 6); await page.locator('#duplicate-cel').click(); await expect(page.locator('#message')).toContainText(/limit|100|budget|strokes/i);
  expect(await backup(page)).toEqual(input); await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#move-mode').click(); await stroke(page, [320, 180]); expect(await backup(page)).toEqual(input); await expect(page.locator('#redo')).toBeEnabled();
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(withBlank);
});

test('raw pose drafts block cel navigation without loss and off-grid committed numbers retain exact precision', async ({ page }) => {
  const input = media(); input.layers[0].keys = [key(0, 1 / 3)]; await open(page, input);
  await page.locator('#layers button').filter({ hasText: 'Paint' }).click();
  const x = page.locator('#pose-x'); await expect(x).toHaveValue(String(1 / 3));
  await x.fill(''); await x.focus(); const identity = await x.evaluate(node => { node.setAttribute('data-original-input', 'kept'); return node.getAttribute('data-original-input'); });
  for (const selector of ['#duplicate-cel', '#delete-cel', '#play', '#undo']) {
    const control = page.locator(selector); if (await control.isEnabled()) await control.click();
    await expect(x).toHaveValue(''); await expect(x).toHaveAttribute('data-original-input', identity!);
  }
  const cel = page.locator('#drawing-cels [data-cel-frame="6"]'); if (await cel.isEnabled()) await cel.click();
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', '0'); expect(await backup(page)).toEqual(input);
  await page.locator('#discard-pose-edits').click(); await expect(x).toHaveValue(String(1 / 3));
  await page.locator('#pose-y').fill('6.250'); await page.locator('#pose-y').press('Tab');
  const committed = await backup(page); expect(committed.layers[0].keys[0].x).toBe(1 / 3); expect(committed.layers[0].keys[0].y).toBe(6.25);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(input);
});

async function startStroke(page: Page) {
  await page.locator('#stage').scrollIntoViewIfNeeded(); const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.move(box.x + box.width / 3, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test('cancelled gestures and delayed resize notifications cannot commit artwork or destroy redo', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { hold: false, callbacks: [] as (() => void)[] }; Object.assign(window, { celGeometryGate: state });
    window.addEventListener('resize', event => { if (state.hold) event.stopImmediatePropagation(); }, true);
    const Original = window.ResizeObserver;
    window.ResizeObserver = class extends Original { constructor(callback: ResizeObserverCallback) { super((entries, observer) => { const run = () => callback(entries, observer); if (state.hold) state.callbacks.push(run); else run(); }); } };
  });
  await open(page, migrated(legacy(true))); await scrub(page, 6); await page.locator('#add-blank-cel').click();
  const future = await backup(page); await page.locator('#undo').click(); const before = await backup(page);
  for (const cancellation of ['escape', 'blur', 'pointercancel']) {
    await startStroke(page);
    if (cancellation === 'escape') await page.keyboard.press('Escape');
    else if (cancellation === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    else await page.locator('#stage').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
    await page.mouse.up(); expect(await backup(page)).toEqual(before); await expect(page.locator('#redo')).toBeEnabled();
  }
  await startStroke(page);
  await page.evaluate(() => { (window as unknown as { celGeometryGate: { hold: boolean } }).celGeometryGate.hold = true; });
  const viewport = page.viewportSize()!; await page.setViewportSize({ width: viewport.width, height: viewport.height + 37 });
  await page.mouse.up(); // Deliberately before either resize notification is delivered.
  expect(await backup(page)).toEqual(before); await expect(page.locator('#redo')).toBeEnabled();
  await page.evaluate(() => { const state = (window as unknown as { celGeometryGate: { hold: boolean; callbacks: (() => void)[] } }).celGeometryGate; state.hold = false; for (const callback of state.callbacks.splice(0)) callback(); window.dispatchEvent(new Event('resize')); });
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(future);
  await stroke(page, [300, 220]); expect((await backup(page)).layers[0].cels![1].strokes).toHaveLength(1);
});

test('late native PNG callback cannot download a changed-back raw draft or the wrong frame', async ({ page }) => {
  await open(page, media());
  await page.evaluate(() => {
    const state = { pending: [] as (() => void)[] }; Object.assign(window, { celPngGate: state });
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) { original.call(this, blob => state.pending.push(() => callback(blob)), type, quality); };
  });
  const downloads: string[] = []; page.on('download', artifact => downloads.push(artifact.suggestedFilename()));
  await page.locator('#png').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celPngGate: { pending: unknown[] } }).celPngGate.pending.length)).toBe(1);
  const x = page.locator('#pose-x'), prior = await x.inputValue(); await x.fill(''); await x.fill(prior);
  await page.evaluate(() => { (window as unknown as { celPngGate: { pending: (() => void)[] } }).celPngGate.pending.shift()!(); });
  await page.waitForTimeout(100); expect(downloads).toEqual([]);
  if (await page.locator('#discard-pose-edits').isVisible()) await page.locator('#discard-pose-edits').click();
  await page.locator('#png').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celPngGate: { pending: unknown[] } }).celPngGate.pending.length)).toBe(1);
  await scrub(page, 12);
  await page.evaluate(() => { (window as unknown as { celPngGate: { pending: (() => void)[] } }).celPngGate.pending.shift()!(); });
  await page.waitForTimeout(100); expect(downloads).toEqual([]);
});

test('recovery bitmap completion cannot replace newer raw pose intent, and the saved record remains protected', async ({ page }) => {
  await open(page); await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const corrupt = { ...legacy(), schemaVersion: 99 }; await record(page, { value: corrupt }); await page.reload();
  await expect(page.getByRole('region', { name: 'Saved draft recovery' })).toBeVisible();
  const current = await backup(page);
  const restored = migrated(legacy()); restored.title = 'Recovered immutable artwork';
  restored.layers.push({ id: 'image', name: 'Original magenta', kind: 'image', keys: [key(0, 70, 70)], image: { dataUrl: `data:image/png;base64,${originalPng().toString('base64')}`, width: 2, height: 2 } });
  await record(page, { value: restored });
  await page.evaluate(() => {
    const state = { hold: true, pending: [] as (() => void)[] }; Object.assign(window, { celBitmapGate: state });
    const native = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => native(...args).then(bitmap => state.hold ? new Promise<ImageBitmap>(resolve => state.pending.push(() => resolve(bitmap))) : bitmap)) as typeof createImageBitmap;
  });
  await page.locator('#recovery-retry').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celBitmapGate: { pending: unknown[] } }).celBitmapGate.pending.length)).toBe(1);
  const field = page.locator('#pose-x'); await field.fill(''); await field.focus();
  await page.evaluate(() => { const state = (window as unknown as { celBitmapGate: { hold: boolean; pending: (() => void)[] } }).celBitmapGate; state.hold = false; state.pending.shift()!(); });
  await expect(page.locator('#recovery-retry')).toBeEnabled(); await expect(field).toHaveValue(''); await expect(field).toBeFocused();
  expect(await backup(page)).toEqual(current); expect(await record(page)).toEqual(restored);
  await expect(page.locator('#recovery-panel')).toBeVisible();
});

test('mobile keyboard can reach all 24 cel boundaries and image artwork keeps its distinct explanation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const input = migrated(legacy()); input.frameCount = 48;
  input.layers[0].cels = Array.from({ length: 24 }, (_, i) => ({ frame: i * 2, strokes: i % 2 ? [] : [line()] }));
  input.layers.push({ id: 'image', name: 'Small magenta image', kind: 'image', keys: [key(0, 50, 50)], image: { dataUrl: `data:image/png;base64,${originalPng().toString('base64')}`, width: 2, height: 2 } });
  await open(page, input); await page.locator('#layers button').filter({ hasText: 'Paint' }).click();
  await expect(page.locator('#drawing-cels button')).toHaveCount(24);
  const last = page.locator('#drawing-cels [data-cel-frame="46"]'); await last.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', '46'); await expect(last).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#frame').focus(); await page.keyboard.press('End'); await expect(page.locator('#stage')).toHaveAttribute('data-frame', '47');
  await expect(page.locator('#add-blank-cel')).toBeDisabled(); await expect(page.locator('#drawing-action-hint')).toContainText(/24|limit/i);
  await page.locator('#delete-cel').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#drawing-cels [data-cel-frame="44"]')).toBeFocused();
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(input);
  await page.locator('#layers button').filter({ hasText: 'Small magenta image' }).click();
  await expect(page.locator('#drawing-status')).toContainText('Imported artwork stays the same'); await expect(page.locator('#add-blank-cel')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('endpoint key-cap rejection happens before loss consent and mixed legacy cel input cannot erase valid work', async ({ page }) => {
  const input = migrated(legacy()); input.frameCount = 96;
  input.layers[0].keys = [...Array.from({ length: 23 }, (_, frame) => key(frame)), key(30, 400)];
  input.layers[0].cels!.push({ frame: 60, strokes: [] });
  await open(page, input); await scrub(page, 25); await page.locator('#add-blank-cel').click(); await page.locator('#undo').click();
  page.removeAllListeners('dialog'); const confirmations: string[] = [];
  page.on('dialog', async dialog => { confirmations.push(dialog.message()); await dialog.dismiss(); });
  await page.locator('#duration').selectOption('48');
  await expect(page.locator('#message')).toContainText(/24|keyframe|pose.*limit/i);
  expect(confirmations).toEqual([]); expect(await backup(page)).toEqual(input); await expect(page.locator('#redo')).toBeEnabled();
  const invalid = legacy(); invalid.layers[0].cels = [{ frame: 0, strokes: [] }];
  await page.locator('#project-file').setInputFiles({ name: 'mixed-legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#message')).toContainText(/invalid|legacy|mixed|cel|schema|field/i);
  expect(await backup(page)).toEqual(input); await expect(page.locator('#redo')).toBeEnabled();
});

test('controlled persisted lifecycle during Undo decode cannot move newer history or lose its preceding state', async ({ page }) => {
  const withImage = migrated(legacy());
  withImage.layers.push({ id: 'image', name: 'Undo decode image', kind: 'image', keys: [key(0, 50, 50)], image: { dataUrl: `data:image/png;base64,${originalPng().toString('base64')}`, width: 2, height: 2 } });
  await open(page, withImage); await page.locator('#delete-layer').click(); const before = await backup(page);
  expect(before.layers.map(layer => layer.id)).toEqual(['paint']);
  await page.evaluate(() => {
    const state = { hold: true, pending: [] as (() => void)[] }; Object.assign(window, { celUndoGate: state });
    const native = window.createImageBitmap.bind(window);
    window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => native(...args).then(bitmap => state.hold ? new Promise<ImageBitmap>(resolve => state.pending.push(() => resolve(bitmap))) : bitmap)) as typeof createImageBitmap;
  });
  await page.locator('#undo').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celUndoGate: { pending: unknown[] } }).celUndoGate.pending.length)).toBe(1);
  // This deliberately exercises the browser lifecycle callbacks; it is not a claim of BFCache admission.
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.locator('#project-title').fill('Newer title after cached return');
  const after = { ...before, title: 'Newer title after cached return' }; expect(await backup(page)).toEqual(after);
  await page.evaluate(() => { const state = (window as unknown as { celUndoGate: { hold: boolean; pending: (() => void)[] } }).celUndoGate; state.hold = false; for (const complete of state.pending.splice(0)) complete(); });
  await page.waitForTimeout(100); expect(await backup(page)).toEqual(after); await expect(page.locator('#redo')).toBeDisabled();
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(before);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(after);
});

test('painting transformed artwork stores inverse coordinates only in the held drawing at gesture admission', async ({ page }) => {
  const input = migrated(legacy(true)); input.layers[0].cels!.push({ frame: 6, strokes: [] });
  input.layers[0].keys = [{ ...key(0, 160, 100), scale: 2, rotation: 90 }];
  await open(page, input); await scrub(page, 9); await page.locator('#ink').fill('#ff0000');
  await stroke(page, [160, 140], [160, 180]);
  const result = await backup(page); expect(result.layers[0].cels?.map(cel => cel.frame)).toEqual([0, 6]);
  expect(result.layers[0].cels![0].strokes).toEqual([]); expect(result.layers[0].cels![1].strokes).toHaveLength(1);
  const points = result.layers[0].cels![1].strokes[0].points;
  expect(points[0].x).toBeCloseTo(20, 0); expect(points.at(-1)!.x).toBeCloseTo(40, 0);
  for (const point of points) expect(Math.abs(point.y)).toBeLessThan(0.5);
  expect(await pixel(page, 160, 160)).toEqual([255, 0, 0, 255]);
  await scrub(page, 5); expect(await pixel(page, 160, 160)).toEqual([255, 255, 255, 255]);
  await scrub(page, 6); expect(await pixel(page, 160, 160)).toEqual([255, 0, 0, 255]);
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(input);
});

test('cancelled real GIF delivery cannot download after a new cel edit or replace a newer export', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    const state = { hold: true, pending: [] as (() => void)[] }; Object.assign(window, { celGifGate: state });
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (state.hold && event.data?.type === 'complete') { event.stopImmediatePropagation(); state.pending.push(() => this.dispatchEvent(event)); }
        });
      }
    };
  });
  await open(page, media()); await page.locator('#layers button').filter({ hasText: 'Paint' }).click();
  const downloads: string[] = []; page.on('download', artifact => downloads.push(artifact.suggestedFilename()));
  await page.locator('#gif').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celGifGate: { pending: unknown[] } }).celGifGate.pending.length)).toBe(1);
  await page.locator('#cancel-export').click(); await expect(page.locator('#gif')).toBeEnabled();
  await scrub(page, 18); await page.locator('#duplicate-cel').click();
  await page.locator('#project-title').fill('Newly edited cel movie');
  await page.evaluate(() => { const state = (window as unknown as { celGifGate: { hold: boolean; pending: (() => void)[] } }).celGifGate; state.hold = false; state.pending.shift()!(); });
  await page.waitForTimeout(100); expect(downloads).toEqual([]);
  const encoded = await download(page, '#gif'); expect(downloads).toHaveLength(1); expect(downloads[0]).toBe('Newly-edited-cel-movie.gif');
  const decoded = decompressFrames(parseGIF(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength)), true);
  expect(decoded).toHaveLength(24); expect(Array.from(decoded[18].patch!.slice((180 * 640 + 320) * 4, (180 * 640 + 320) * 4 + 4))).toEqual([255, 255, 255, 255]);
});

test('controlled persisted return during actual replacement transaction never claims newer unsaved work is saved', async ({ page }) => {
  await open(page); await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await record(page, { value: { ...legacy(), schemaVersion: 99 } }); await page.reload();
  await expect(page.locator('#recovery-panel')).toBeVisible();
  await page.locator('#project-title').fill('Explicit replacement snapshot A'); const before = await backup(page);
  await page.evaluate(() => {
    const state = { hold: true, armed: true, started: false, completed: 0 }; Object.assign(window, { celReplaceGate: state });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (state.armed && this.name === 'project' && key === 'current' && this.transaction.mode === 'readwrite') {
        state.armed = false;
        this.transaction.addEventListener('complete', () => { state.completed++; });
        request.addEventListener('success', () => {
          state.started = true;
          const keepAlive = () => { if (state.hold) this.get('current').addEventListener('success', keepAlive); };
          keepAlive();
        });
      }
      return request;
    };
  });
  await page.locator('#replace-saved-project').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celReplaceGate: { started: boolean } }).celReplaceGate.started)).toBe(true);
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.locator('#project-title').fill('Newer in-memory drawing B');
  const after = { ...before, title: 'Newer in-memory drawing B' }; expect(await backup(page)).toEqual(after);
  await page.evaluate(() => { (window as unknown as { celReplaceGate: { hold: boolean } }).celReplaceGate.hold = false; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { celReplaceGate: { completed: number } }).celReplaceGate.completed)).toBe(1);
  expect(await record(page)).toEqual(before); expect(await backup(page)).toEqual(after);
  await expect(page.locator('#save-status')).not.toHaveText('Saved in this browser');
  await expect(page.locator('#recovery-panel')).toBeVisible();
  expect(JSON.parse((await download(page, '#recovery-download')).toString('utf8'))).toEqual(before);
  await page.locator('#replace-saved-project').click();
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser'); expect(await record(page)).toEqual(after);
  await page.reload(); await expect(page.locator('#project-title')).toHaveValue(after.title); expect(await backup(page)).toEqual(after);
});

test('queued replacement failure preserves the actual preceding successful write receipt', async ({ page }) => {
  await open(page); await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const corrupt = { ...legacy(), schemaVersion: 99 }; await record(page, { value: corrupt }); await page.reload();
  await expect(page.locator('#recovery-panel')).toBeVisible();
  await page.locator('#project-title').fill('First authorized durable snapshot A'); const first = await backup(page);
  await page.evaluate(() => {
    const state = { hold: true, writes: 0, started: false, completed: false, aborted: false }; Object.assign(window, { celQueuedReplaceGate: state });
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      const request = original.call(this, value, key);
      if (this.name === 'project' && key === 'current' && this.transaction.mode === 'readwrite') {
        const order = ++state.writes;
        if (order === 1) {
          this.transaction.addEventListener('complete', () => { state.completed = true; });
          request.addEventListener('success', () => {
            state.started = true;
            const keepAlive = () => { if (state.hold) this.get('current').addEventListener('success', keepAlive); };
            keepAlive();
          });
        } else if (order === 2) {
          this.transaction.addEventListener('abort', () => { state.aborted = true; });
          request.addEventListener('success', () => this.transaction.abort());
        }
      }
      return request;
    };
  });
  await page.locator('#replace-saved-project').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { celQueuedReplaceGate: { started: boolean } }).celQueuedReplaceGate.started)).toBe(true);
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.locator('#project-title').fill('Second newer snapshot B whose write aborts');
  const second = { ...first, title: 'Second newer snapshot B whose write aborts' }; expect(await backup(page)).toEqual(second);
  await page.locator('#replace-saved-project').click(); // B queues behind the actual still-open A transaction.
  await page.evaluate(() => { (window as unknown as { celQueuedReplaceGate: { hold: boolean } }).celQueuedReplaceGate.hold = false; });
  await expect.poll(() => page.evaluate(() => { const state = (window as unknown as { celQueuedReplaceGate: { completed: boolean; aborted: boolean } }).celQueuedReplaceGate; return state.completed && state.aborted; })).toBe(true);
  await expect(page.locator('#replace-saved-project')).toBeEnabled();
  expect(await record(page)).toEqual(first); expect(await backup(page)).toEqual(second);
  await expect(page.locator('#save-status')).not.toHaveText('Saved in this browser'); await expect(page.locator('#recovery-panel')).toBeVisible();
  expect(JSON.parse((await download(page, '#recovery-download')).toString('utf8'))).toEqual(first);
  await page.locator('#replace-saved-project').click(); await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  expect(await record(page)).toEqual(second);
});
