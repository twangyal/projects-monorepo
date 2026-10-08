import { LIMITS } from './types.ts';
import type { PngHeader, Raster } from './types.ts';

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function fail(): never { throw new Error('Use a complete, static, non-interlaced 8-bit RGB or RGBA PNG within the image limits.'); }
function crc(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let i = start; i < end; i++) value = CRC_TABLE[(value ^ bytes[i]!) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
export function inspectPng(bytes: Uint8Array): PngHeader {
  if (!(bytes instanceof Uint8Array) || bytes.length < 57 || bytes.length > LIMITS.sourceBytes) fail();
  if (!SIGNATURE.every((value, index) => bytes[index] === value)) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let header: PngHeader | undefined;
  let idat = 0;
  let dataStarted = false;
  let dataEnded = false;
  let ancillary = 0;
  while (at < bytes.length) {
    if (bytes.length - at < 12) fail();
    const length = view.getUint32(at);
    if (length > bytes.length - at - 12) fail();
    const end = at + length + 12;
    const letters = bytes.subarray(at + 4, at + 8);
    if (!letters.every(value => (value >= 65 && value <= 90) || (value >= 97 && value <= 122)) || (letters[2]! & 32)) fail();
    const type = String.fromCharCode(...letters);
    if (crc(bytes, at + 4, end - 4) !== view.getUint32(end - 4)) fail();
    if (!header && type !== 'IHDR') fail();
    if (type === 'IHDR') {
      if (header || at !== 8 || length !== 13) fail();
      const width = view.getUint32(at + 8);
      const height = view.getUint32(at + 12);
      const colorType = bytes[at + 17];
      if (!width || !height || width > LIMITS.sourceSide || height > LIMITS.sourceSide || width * height > LIMITS.sourcePixels || bytes[at + 16] !== 8 || (colorType !== 2 && colorType !== 6) || bytes[at + 18] !== 0 || bytes[at + 19] !== 0 || bytes[at + 20] !== 0) fail();
      header = { width, height, colorType };
    } else if (type === 'IDAT') {
      if (dataEnded) fail();
      dataStarted = true;
      idat += length;
    } else if (type === 'IEND') {
      if (length !== 0 || !dataStarted || idat === 0 || end !== bytes.length) fail();
      return header!;
    } else {
      if (!(letters[0]! & 32) || ['acTL', 'fcTL', 'fdAT', 'eXIf'].includes(type)) fail();
      ancillary += length + 12;
      if (ancillary > LIMITS.ancillaryBytes) fail();
      if (dataStarted) dataEnded = true;
    }
    at = end;
  }
  return fail();
}

function admitRaster(raster: Raster): void {
  if (!raster || Object.getPrototypeOf(raster) !== Object.prototype || Reflect.ownKeys(raster).length !== 3 || !['width', 'height', 'rgba'].every(key => {
    const property = Object.getOwnPropertyDescriptor(raster, key);
    return property && 'value' in property;
  })) throw new Error('Invalid bounded RGBA raster.');
  const { width, height, rgba } = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > LIMITS.outputSide || height > LIMITS.outputSide || !(rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) throw new Error('Invalid bounded RGBA raster.');
}
function writeChunk(output: Uint8Array, at: number, type: string, data: Uint8Array): number {
  const view = new DataView(output.buffer);
  view.setUint32(at, data.length);
  for (let i = 0; i < 4; i++) output[at + 4 + i] = type.charCodeAt(i);
  output.set(data, at + 8);
  view.setUint32(at + data.length + 8, crc(output, at + 4, at + data.length + 8));
  return at + data.length + 12;
}
export function encodePng(raster: Raster): Uint8Array {
  admitRaster(raster);
  const stride = raster.width * 4;
  const raw = new Uint8Array((stride + 1) * raster.height);
  for (let row = 0; row < raster.height; row++) raw.set(raster.rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  const blockCount = Math.ceil(raw.length / 65535);
  const compressed = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  compressed.set([0x78, 0x01]);
  let at = 2;
  let a = 1;
  let b = 0;
  for (let start = 0; start < raw.length; start += 65535) {
    const length = Math.min(65535, raw.length - start);
    compressed[at++] = start + length === raw.length ? 1 : 0;
    compressed[at++] = length & 255;
    compressed[at++] = length >>> 8;
    compressed[at++] = (~length) & 255;
    compressed[at++] = ((~length) >>> 8) & 255;
    compressed.set(raw.subarray(start, start + length), at);
    at += length;
  }
  for (let start = 0; start < raw.length; start += 5552) {
    const end = Math.min(raw.length, start + 5552);
    for (let i = start; i < end; i++) { a += raw[i]!; b += a; }
    a %= 65521;
    b %= 65521;
  }
  new DataView(compressed.buffer).setUint32(at, ((b << 16) | a) >>> 0);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, raster.width);
  headerView.setUint32(4, raster.height);
  header.set([8, 6, 0, 0, 0], 8);
  const output = new Uint8Array(8 + 25 + 13 + compressed.length + 12 + 12);
  if (output.length > LIMITS.pngBytes) throw new Error('PNG exceeds the export limit.');
  output.set(SIGNATURE);
  at = writeChunk(output, 8, 'IHDR', header);
  at = writeChunk(output, at, 'sRGB', Uint8Array.of(0));
  at = writeChunk(output, at, 'IDAT', compressed);
  writeChunk(output, at, 'IEND', new Uint8Array());
  return output;
}
