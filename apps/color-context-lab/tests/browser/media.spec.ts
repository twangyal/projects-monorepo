import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import type { Project } from '../../src/types.ts';
import type {} from '../media-harness.ts';
function png(width: number, height: number, pixels: Uint8Array): Buffer { return PNG.sync.write({ width, height, data: Buffer.from(pixels) } as PNG); }
function crc(bytes: Uint8Array): number { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Uint8Array): Buffer { const out = Buffer.alloc(data.length + 12); out.writeUInt32BE(data.length); out.write(type, 4, 'ascii'); out.set(data, 8); out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4); return out; }
function malformedCompressed(): Buffer {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header.set([8, 6], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', Uint8Array.of(1, 2, 3)), chunk('IEND', new Uint8Array())]);
}
function rawProject(): Project {
  return { schemaVersion: 1, id: '12345678-1234-4234-8234-123456789012', title: 'Raw <artist> & study', image: { id: '12345678-1234-4234-8234-123456789013', width: 2, height: 2, rgba: Buffer.from([51, 103, 207, 0, 201, 7, 99, 1, 15, 240, 41, 64, 22, 33, 44, 255]).toString('base64'), source: { fileName: '<literal> source.png', format: 'png', width: 2, height: 2 } }, settings: { mode: 'checker', border: 4, colorA: '#ff0000', colorB: '#00ff00', cellSize: 4 } };
}
function scalar(project: Project): Buffer {
  const { width: w, height: h, rgba } = project.image; const b = project.settings.border; const width = w + 2 * b; const out = Buffer.alloc(width * (h + 2 * b) * 4); const source = Buffer.from(rgba, 'base64');
  for (let y = 0; y < h + 2 * b; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    if (x >= b && x < b + w && y >= b && y < b + h) source.copy(out, at, ((y - b) * w + x - b) * 4, ((y - b) * w + x - b) * 4 + 4);
    else out.set((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255], at);
  }
  return out;
}
test.beforeEach(async ({ page }) => { await page.goto('/tests/media-harness.html'); await page.waitForFunction(() => !!window.colorMedia); });
test('actual worker PNG decode normalizes1200×1000 source to720×600 with correct native quadrant pixels', async ({ page }) => {
  const width = 1200; const height = 1000; const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) bytes.set(x < 600 ? (y < 500 ? [230, 20, 30, 255] : [10, 30, 230, 255]) : (y < 500 ? [20, 220, 30, 255] : [210, 180, 10, 255]), (y * width + x) * 4);
  const source = png(width, height, bytes);
  const asset = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); return window.colorMedia.normalize(new File([bytes], 'Original quadrants.png', { type: 'image/png' }));
  }, source.toString('base64'));
  expect([asset.width, asset.height]).toEqual([720, 600]); expect(asset.source).toEqual({ fileName: 'Original quadrants.png', format: 'png', width, height });
  const actual = Buffer.from(asset.rgba, 'base64');
  for (const [x, y, expected] of [[100, 100, [230, 20, 30, 255]], [620, 100, [20, 220, 30, 255]], [100, 500, [10, 30, 230, 255]], [620, 500, [210, 180, 10, 255]]] as const) expect([...actual.subarray((y * 720 + x) * 4, (y * 720 + x) * 4 + 4)]).toEqual(expected);
});
test('native normalization retains its own low-alpha baseline while raw-project PNG exports retain exact hiddenRGB', async ({ page }) => {
  const source = Uint8Array.of(51, 103, 207, 0, 201, 7, 99, 1, 15, 240, 41, 64, 22, 33, 44, 255);
  const normalized = await page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const file = new File([bytes], 'Transparent original.png', { type: 'image/png' });
    const reference = await createImageBitmap(file, { imageOrientation: 'none', colorSpaceConversion: 'default' });
    const canvas = new OffscreenCanvas(2, 2); const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })!; ctx.drawImage(reference, 0, 0); const baseline = [...ctx.getImageData(0, 0, 2, 2).data]; reference.close(); canvas.width = canvas.height = 0;
    const asset = await window.colorMedia.normalize(file); return { baseline, actual: [...window.colorMedia.decodePixels(asset).rgba] };
  }, png(2, 2, source).toString('base64'));
  expect(normalized.actual).toEqual(normalized.baseline);
  const project = rawProject();
  const results = await page.evaluate(async project => {
    const comparison = await window.colorMedia.preview(project);
    const source = [...await window.colorMedia.exportPng(project, 'source')]; const result = [...await window.colorMedia.exportPng(project, 'result')]; const report = await window.colorMedia.exportReport(project);
    return { source, result, report, shown: [...comparison.result.rgba], metrics: comparison.metrics, original: project.image.rgba };
  }, project);
  expect(PNG.sync.read(Buffer.from(results.source)).data).toEqual(Buffer.from(project.image.rgba, 'base64'));
  const expected = scalar(project);
  expect(PNG.sync.read(Buffer.from(results.result)).data).toEqual(expected); expect(Buffer.from(results.shown)).toEqual(expected);
  expect(results.original).toBe(project.image.rgba); expect(results.metrics.artworkChangedPixels).toBe(0);
  expect(results.report).toContain(createHash('sha256').update(Buffer.from(project.image.rgba, 'base64')).digest('hex'));
  expect(results.report).toContain('&lt;literal&gt; source.png'); expect(results.report).toContain('Raw &lt;artist&gt; &amp; study');
  const embedded = [...results.report.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)]; expect(embedded).toHaveLength(2);
  expect(PNG.sync.read(Buffer.from(embedded[1]![1]!, 'base64')).data).toEqual(expected);
});
test('physical invalid PNG fails before decoder; CRC-valid broken compressed image reaches and fails real native decode', async ({ page }) => {
  const valid = png(1, 1, Uint8Array.of(20, 30, 40, 255)); const badCrc = Buffer.from(valid); badCrc[29] = badCrc[29]! ^ 1;
  const oriented = Buffer.concat([valid.subarray(0, 33), chunk('eXIf', Uint8Array.of(0)), valid.subarray(33)]);
  const result = await page.evaluate(async fixtures => {
    const native = window.createImageBitmap; let calls = 0; window.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => { calls++; return native(...args); }) as typeof createImageBitmap;
    const failures: string[] = [];
    try { for (const encoded of fixtures) { const file = new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], 'bad.png', { type: 'image/png' }); try { await window.colorMedia.normalizeImage(file); failures.push('unexpected success'); } catch (error) { failures.push(error instanceof Error ? error.message : 'unknown'); } } } finally { window.createImageBitmap = native; }
    return { calls, failures };
  }, [badCrc, oriented, malformedCompressed()].map(bytes => bytes.toString('base64')));
  expect(result.calls).toBe(1); expect(result.failures).toHaveLength(3); expect(result.failures.join(' ')).not.toContain('unexpected success'); expect(result.failures[2]).toContain('could not be decoded');
});
test('cancelling pending native decode closes its actual returned bitmap before publication', async ({ page }) => {
  const bytes = png(1, 1, Uint8Array.of(20, 30, 40, 255)).toString('base64');
  const result = await page.evaluate(async base64 => {
    const native = window.createImageBitmap; const controller = new AbortController(); let closed = 0; let drawn = 0;
    const draw = OffscreenCanvasRenderingContext2D.prototype.drawImage;
    OffscreenCanvasRenderingContext2D.prototype.drawImage = (function (this: OffscreenCanvasRenderingContext2D, ...args: Parameters<typeof draw>) { drawn++; return draw.apply(this, args); }) as typeof draw;
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => { const bitmap = await native(...args); const close = bitmap.close.bind(bitmap); bitmap.close = () => { closed++; close(); }; controller.abort(); return bitmap; }) as typeof createImageBitmap;
    try { await window.colorMedia.normalizeImage(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'Original.png', { type: 'image/png' }), controller.signal); return { error: 'unexpected success', closed, drawn }; } catch (error) { return { error: error instanceof Error ? error.name : 'unknown', closed, drawn }; } finally { window.createImageBitmap = native; OffscreenCanvasRenderingContext2D.prototype.drawImage = draw; }
  }, bytes);
  expect(result).toEqual({ error: 'AbortError', closed: 1, drawn: 0 });
});
test('real worker supersession and Stop reject old results without detaching the live asset', async ({ page }) => {
  const result = await page.evaluate(async project => {
    const old = window.colorMedia.exportReport(project); const oldResult = old.then(() => 'unexpected success', error => error.name);
    const current = await window.colorMedia.preview(project);
    const pending = window.colorMedia.exportReport(project); const cancelled = pending.then(() => 'unexpected success', error => error.name); window.colorMedia.cancelJobs();
    const retried = await window.colorMedia.exportPng(project, 'source');
    return { old: await oldResult, stopped: await cancelled, retryBytes: retried.length, preserved: project.image.rgba, current: current.result.width };
  }, rawProject());
  expect(result.old).toBe('AbortError'); expect(result.stopped).toBe('AbortError'); expect(result.retryBytes).toBeGreaterThan(50); expect(result.preserved).toBe(rawProject().image.rgba); expect(result.current).toBe(10);
});
