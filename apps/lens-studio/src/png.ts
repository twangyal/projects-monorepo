import { LIMITS } from './types.ts';
import type { Raster } from './types.ts';

/** Validate raster views without copying or changing their pixels. */
export function validateRaster(value: unknown): asserts value is Raster {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A raster with dimensions and RGBA pixels is required.');
  const raster = value as Record<string, unknown>;
  if (Object.keys(raster).some(key => !['width', 'height', 'rgba', 'missingFraction'].includes(key))) throw new Error('The raster contains unsupported fields.');
  const { width, height, rgba } = raster;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width > LIMITS.photoSide || height > LIMITS.photoSide) throw new Error('Raster dimensions must be integers from 1 through 1280.');
  if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4
      || !(rgba.buffer instanceof ArrayBuffer)) throw new Error('The raster needs an exact, unshared RGBA8 pixel array.');
  if ('missingFraction' in raster && (typeof raster.missingFraction !== 'number' || !Number.isFinite(raster.missingFraction)
      || raster.missingFraction < 0 || raster.missingFraction > 1)) throw new Error('The raster coverage is invalid.');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(output: Uint8Array, offset: number, type: string, data: Uint8Array): number {
  const view = new DataView(output.buffer);
  view.setUint32(offset, data.length);
  for (let i = 0; i < 4; i++) output[offset + 4 + i] = type.charCodeAt(i);
  output.set(data, offset + 8);
  view.setUint32(offset + 8 + data.length, crc(output.subarray(offset + 4, offset + 8 + data.length)));
  return offset + data.length + 12;
}

/** Byte-exact straight RGBA PNG; Canvas must never be its pixel source. */
export function encodePng(raster: Raster): Uint8Array {
  validateRaster(raster);
  const { width, height, rgba } = raster;
  const stride = width * 4 + 1;
  const rawSize = stride * height;
  const zlibSize = 2 + rawSize + Math.ceil(rawSize / 65535) * 5 + 4;
  const outputSize = 8 + 25 + 12 + zlibSize + 12;
  if (outputSize > LIMITS.pngBytes) throw new Error('The PNG exceeds the supported output size.');
  const raw = new Uint8Array(rawSize);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  const zlib = new Uint8Array(zlibSize); zlib.set([0x78, 0x01]);
  const view = new DataView(zlib.buffer);
  let read = 0, write = 2, a = 1, b = 0;
  while (read < raw.length) {
    const count = Math.min(65535, raw.length - read);
    zlib[write++] = read + count === raw.length ? 1 : 0;
    view.setUint16(write, count, true); view.setUint16(write + 2, count ^ 0xffff, true); write += 4;
    zlib.set(raw.subarray(read, read + count), write); write += count;
    for (let end = read + count; read < end; read++) { a = (a + raw[read]!) % 65521; b = (b + a) % 65521; }
  }
  view.setUint32(write, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13); const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width); headerView.setUint32(4, height); header.set([8, 6, 0, 0, 0], 8);
  const output = new Uint8Array(outputSize); output.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = chunk(output, 8, 'IHDR', header);
  offset = chunk(output, offset, 'IDAT', zlib); chunk(output, offset, 'IEND', new Uint8Array());
  return output;
}
