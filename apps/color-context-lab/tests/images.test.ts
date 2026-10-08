import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePng } from '../src/png.ts';
import { PNG } from 'pngjs';
import { normalizeImage } from '../src/images.ts';
function file(width = 2, height = 1) {
  const rgba = new Uint8ClampedArray(width * height * 4).fill(90);
  const png = width <= 976 && height <= 976 ? encodePng({ width, height, rgba }) : PNG.sync.write({ width, height, data: Buffer.from(rgba) } as PNG);
  return new File([new Uint8Array(png).buffer], 'literal <image>.png', { type: 'image/png' });
}
async function native<T>(run: (state: { closed: number; sized: number[]; drawn: number; options?: ImageBitmapOptions }) => Promise<T>, dimensions = [2, 1]): Promise<T> {
  const state = { closed: 0, sized: [] as number[], drawn: 0, options: undefined as ImageBitmapOptions | undefined };
  const bitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  const canvasDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (_blob: Blob, options: ImageBitmapOptions) => { state.options = options; return { width: dimensions[0], height: dimensions[1], close() { state.closed++; } }; } });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: class {
    width: number; height: number;
    constructor(width: number, height: number) { this.width = width; this.height = height; state.sized = [width, height]; }
    getContext() { return { imageSmoothingEnabled: false, imageSmoothingQuality: 'low', drawImage() { state.drawn++; }, getImageData: () => ({ data: new Uint8ClampedArray(this.width * this.height * 4).fill(35) }) }; }
  } });
  try { return await run(state); } finally {
    if (bitmapDescriptor) Object.defineProperty(globalThis, 'createImageBitmap', bitmapDescriptor); else Reflect.deleteProperty(globalThis, 'createImageBitmap');
    if (canvasDescriptor) Object.defineProperty(globalThis, 'OffscreenCanvas', canvasDescriptor); else Reflect.deleteProperty(globalThis, 'OffscreenCanvas');
  }
}
test('normalization uses admitted PNG dimensions, native sRGB and an owned normalized raw baseline', async () => native(async state => {
  const image = await normalizeImage(file());
  assert.equal(image.width, 2); assert.equal(image.height, 1); assert.equal(atob(image.rgba).length, 8);
  assert.equal(image.source.fileName, 'literal <image>.png'); assert.equal(image.source.format, 'png');
  assert.deepEqual(state.sized, [2, 1]); assert.equal(state.drawn, 1); assert.equal(state.closed, 1);
  assert.deepEqual(state.options, { imageOrientation: 'none', colorSpaceConversion: 'default' });
}));
test('normalization exact720 ratio and native header mismatch cleanup', async () => native(async state => {
  const image = await normalizeImage(file(1200, 1000));
  assert.equal(image.width, 720); assert.equal(image.height, 600); assert.deepEqual(state.sized, [720, 600]); assert.equal(state.closed, 1);
}, [1200, 1000]));
test('wrong native dimensions reject and close returned bitmap', async () => native(async state => {
  await assert.rejects(normalizeImage(file()), /decode|dimensions|PNG/i); assert.equal(state.closed, 1); assert.equal(state.drawn, 0);
}, [1, 2]));
test('immediate type/MIME/name/size and physical PNG failures never call native decoder', async () => native(async state => {
  for (const invalid of [new File([], 'empty.png'), new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png'), new File(['not png'], 'bad.png', { type: 'image/png' }), new File(['x'], 'a.jpg', { type: 'image/jpeg' }), new File(['x'], 'a\n.png'), new File(['x'], '\ud800.png')]) await assert.rejects(normalizeImage(invalid));
  assert.equal(state.closed, 0); assert.equal(state.drawn, 0);
}));
test('abort after asynchronous decode closes its bitmap and never draws or publishes', async () => native(async state => {
  const original = createImageBitmap;
  const cancel = new AbortController();
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (...args: Parameters<typeof createImageBitmap>) => { const bitmap = await original(...args); cancel.abort(); return bitmap; } });
  await assert.rejects(normalizeImage(file(), cancel.signal), { name: 'AbortError' });
  assert.equal(state.closed, 1); assert.equal(state.drawn, 0);
  await assert.rejects(normalizeImage(file(), cancel.signal), { name: 'AbortError' });
  assert.equal(state.closed, 1);
}));
