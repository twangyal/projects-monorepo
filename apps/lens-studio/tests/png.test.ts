import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { encodePng } from '../src/png.ts';
import type { Raster } from '../src/types.ts';

function raster(width: number, height: number): Raster {
  return { width, height, rgba: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i * 79 + 13) % 256) };
}
function chunks(bytes: Uint8Array): { name: string; data: Buffer }[] {
  const file = Buffer.from(bytes); const result = [];
  for (let offset = 8; offset < file.length;) {
    const length = file.readUInt32BE(offset);
    result.push({ name: file.toString('ascii', offset + 4, offset + 8), data: file.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  return result;
}

test('lossless PNG preserves exact straight low-alpha colors and emits only the three required chunks', () => {
  const source = { width: 3, height: 1, rgba: new Uint8ClampedArray([128, 64, 32, 1, 100, 150, 200, 2, 17, 33, 65, 10]) };
  const before = source.rgba.slice(); const bytes = encodePng(source);
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const decoded = PNG.sync.read(Buffer.from(bytes), { checkCRC: true });
  assert.equal(decoded.width, 3); assert.equal(decoded.height, 1);
  assert.deepEqual([...decoded.data], [...before]); assert.deepEqual(source.rgba, before);
  assert.deepEqual(chunks(bytes).map(c => c.name), ['IHDR', 'IDAT', 'IEND']);
  bytes.fill(0); assert.deepEqual(source.rgba, before);
});

test('stored DEFLATE blocks cross 65535 bytes with valid lengths, checksum and scanline filters', () => {
  const source = raster(257, 70); const bytes = encodePng(source);
  const data = chunks(bytes)[1]!.data;
  assert.equal(data[0], 0x78); assert.equal(data[1], 0x01);
  let offset = 2; let blocks = 0; let final = false;
  while (!final) {
    const header = data[offset++]!; assert.ok(header === 0 || header === 1); final = header === 1;
    const length = data.readUInt16LE(offset); const inverse = data.readUInt16LE(offset + 2);
    assert.equal(length ^ inverse, 65535); assert.ok(length > 0); offset += 4 + length; blocks++;
  }
  assert.equal(offset + 4, data.length); assert.equal(blocks, 2);
  const scanlines = inflateSync(data); const stride = source.width * 4 + 1;
  for (let y = 0; y < source.height; y++) {
    assert.equal(scanlines[y * stride], 0);
    assert.deepEqual([...scanlines.subarray(y * stride + 1, (y + 1) * stride)], [...source.rgba.subarray(y * source.width * 4, (y + 1) * source.width * 4)]);
  }
  assert.deepEqual([...PNG.sync.read(Buffer.from(bytes), { checkCRC: true }).data], [...source.rgba]);
});

test('maximum normalized raster has bounded deterministic output with independent PNG decode', () => {
  const source = raster(1280, 1280); const encoded = encodePng(source);
  assert.equal(encoded.byteLength, 6_555_448);
  assert.deepEqual(PNG.sync.read(Buffer.from(encoded), { checkCRC: true }).data, Buffer.from(source.rgba));
});

test('invalid raster dimensions, wrong arrays and byte counts reject before encoding', () => {
  const source = raster(1, 1);
  for (const bad of [null, { ...source, width: 0 }, { ...source, width: 1281 }, { ...source, height: 1.5 },
    { ...source, width: NaN }, { ...source, rgba: new Uint8Array(4) }, { ...source, rgba: new Uint8ClampedArray(3) },
    { ...source, extra: true }]) assert.throws(() => encodePng(bad as Raster), /raster|dimension|pixel|field/i);
});
