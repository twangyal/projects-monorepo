import assert from 'node:assert/strict';
import test from 'node:test';
import { importImage, inspectImageHeader, validateAssetHeader } from '../src/images.ts';

function concat(...parts: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) { bytes.set(part, cursor); cursor += part.length; }
  return bytes;
}
const text = (value: string) => Uint8Array.from(value, character => character.charCodeAt(0));
function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.length + 12);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set(text(name), 4); chunk.set(data, 8);
  return chunk;
}
function png(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width); view.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  return concat(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', Uint8Array.of(0)), pngChunk('IEND', new Uint8Array()));
}
function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 217]);
}
function webpChunk(name: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + data.length + data.length % 2);
  chunk.set(text(name)); new DataView(chunk.buffer).setUint32(4, data.length, true); chunk.set(data, 8);
  return chunk;
}
function webp(...chunks: Uint8Array[]): Uint8Array {
  const result = concat(text('RIFF'), new Uint8Array(4), text('WEBP'), ...chunks);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}
function vp8l(width: number, height: number): Uint8Array {
  const payload = new Uint8Array(5); payload[0] = 47;
  new DataView(payload.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
  return webpChunk('VP8L', payload);
}
function vp8x(width: number, height: number, flags = 0): Uint8Array {
  const payload = new Uint8Array(10); payload[0] = flags;
  for (let i = 0; i < 3; i++) { payload[4 + i] = (width - 1) >> (i * 8); payload[7 + i] = (height - 1) >> (i * 8); }
  return webpChunk('VP8X', payload);
}
function dataUrl(bytes: Uint8Array): string { return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`; }

test('headers detect actual PNG, JPEG, and static lossless/extended WebP dimensions', () => {
  assert.deepEqual(inspectImageHeader(png(400, 200), 'image/png'), { format: 'png', width: 400, height: 200 });
  assert.deepEqual(inspectImageHeader(jpeg(640, 480), 'image/jpeg'), { format: 'jpeg', width: 640, height: 480 });
  assert.deepEqual(inspectImageHeader(webp(vp8l(320, 180)), 'image/webp'), { format: 'webp', width: 320, height: 180 });
  assert.deepEqual(inspectImageHeader(webp(vp8x(320, 180), vp8l(320, 180)), 'image/webp'), { format: 'webp', width: 320, height: 180 });
  assert.equal(inspectImageHeader(png(1, 1)).format, 'png');
});

test('pixel and encoded-byte limits are checked before decoding', () => {
  assert.equal(inspectImageHeader(png(4000, 4000)).width, 4000);
  for (const bytes of [png(4001, 4000), png(0, 1), jpeg(8000, 8000), webp(vp8l(16000, 16000))]) {
    assert.throws(() => inspectImageHeader(bytes), /dimensions|pixels/i);
  }
  assert.throws(() => inspectImageHeader(new Uint8Array(4 * 1024 * 1024 + 1)), /4 MiB/);
});

test('MIME mismatches, unsupported formats, truncated containers, and excessive header metadata are rejected', () => {
  assert.throws(() => inspectImageHeader(png(1, 1), 'image/jpeg'), /match/i);
  assert.throws(() => inspectImageHeader(text('<svg/>'), 'image/svg+xml'), /PNG|JPEG|WebP/);
  for (const bytes of [png(1, 1).subarray(0, 40), jpeg(1, 1).subarray(0, 14), webp(vp8l(1, 1)).subarray(0, 20)]) assert.throws(() => inspectImageHeader(bytes), /corrupt|truncated|header/i);
  const segment = new Uint8Array(65537); segment[0] = 255; segment[1] = 225; segment[2] = 255; segment[3] = 255;
  assert.throws(() => inspectImageHeader(concat(Uint8Array.of(255, 216), segment, segment, segment, segment, segment, jpeg(1, 1).subarray(2))), /metadata/i);
});

test('animated WebP, deceptive canvas sizes, missing frames, and multiple image frames are rejected', () => {
  assert.throws(() => inspectImageHeader(webp(vp8x(10, 10, 2), vp8l(10, 10))), /animated|static/i);
  assert.throws(() => inspectImageHeader(webp(vp8x(10, 10), webpChunk('ANIM', new Uint8Array(6)), vp8l(10, 10))), /animated|static/i);
  assert.throws(() => inspectImageHeader(webp(vp8x(10, 10), vp8l(16000, 16000))), /pixels|dimensions/i);
  assert.throws(() => inspectImageHeader(webp(vp8x(10, 10), vp8l(20, 20))), /dimensions|match/i);
  assert.throws(() => inspectImageHeader(webp(vp8x(10, 10))), /frame|corrupt/i);
  assert.throws(() => inspectImageHeader(webp(vp8l(10, 10), vp8l(10, 10))), /frame|corrupt/i);
});

test('saved assets require bounded canonical PNG data and matching normalized dimensions', () => {
  const asset = { dataUrl: dataUrl(png(320, 180)), width: 320, height: 180 };
  assert.deepEqual(validateAssetHeader(asset), png(320, 180));
  for (const invalid of [
    { ...asset, width: 321 }, { ...asset, height: NaN }, { ...asset, width: 801 },
    { ...asset, dataUrl: 'https://example.com/image.png' }, { ...asset, dataUrl: 'data:image/svg+xml,<svg/>' },
    { ...asset, dataUrl: 'data:image/png;base64,AA=A' }, { ...asset, dataUrl: 'data:image/png;base64,' + 'A'.repeat(1.5 * 1024 * 1024) },
  ]) assert.throws(() => validateAssetHeader(invalid), /PNG|dimensions|800|1.5 MiB|base64/i);
});

test('empty, oversized, SVG, and falsely labeled files fail before a browser decoder is needed', async () => {
  await assert.rejects(importImage(new File([], 'empty.png', { type: 'image/png' })), /nonempty|4 MiB/i);
  await assert.rejects(importImage(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })), /4 MiB/i);
  await assert.rejects(importImage(new File(['<svg/>'], 'drawing.svg', { type: 'image/svg+xml' })), /PNG|JPEG|WebP/);
  await assert.rejects(importImage(new File([Uint8Array.from(png(1, 1))], 'fake.jpg', { type: 'image/jpeg' })), /match/i);
});

test('JPEG cannot hide a second oversized frame behind a small first header', () => {
  const deceptive = concat(jpeg(1, 1).subarray(0, 15), jpeg(8000, 8000).subarray(2));
  assert.throws(() => inspectImageHeader(deceptive), /dimensions|pixels|frame/i);
});
