import { LIMITS, type PhotoAsset, type PhotoHeader } from './types.ts';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$(?![\s\S])/;
const INPUT_LIMIT = LIMITS.sourceBytes, PIXEL_LIMIT = LIMITS.sourcePixels;
function dimensions(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > LIMITS.sourceSide || h > LIMITS.sourceSide || w * h > PIXEL_LIMIT) throw new Error('Image dimensions must be at most 8192 per side and contain 1–16,000,000 pixels.');
}
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
function corrupt(): never { throw new Error('Corrupt or truncated image header.'); }
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
  let value = byte;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}
function png(b: Uint8Array): PhotoHeader {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8, count = 0, width = 0, height = 0, data = 0, orientation: PhotoHeader['orientation'] | undefined, seenExif = false;
  while (o + 12 <= b.length && ++count <= 4096) {
    const n = v.getUint32(o), kind = ascii(b, o + 4, 4);
    if (n > b.length - o - 12) corrupt();
    if (!/^[A-Za-z]{4}$/.test(kind) || crc32(b.subarray(o + 4, o + 8 + n)) !== v.getUint32(o + 8 + n)) corrupt();
    if (count === 1) {
      if (kind !== 'IHDR' || n !== 13) corrupt();
      width = v.getUint32(o + 8); height = v.getUint32(o + 12); dimensions(width, height);
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[b[o + 17]]?.includes(b[o + 16]) || b[o + 18] || b[o + 19] || b[o + 20] > 1) corrupt();
    } else if (kind === 'IHDR') corrupt();
    if (kind === 'eXIf') {
      if (seenExif) corrupt();
      seenExif = true;
      orientation = exifOrientation(b, o + 8, o + 8 + n, true);
    }
    if (kind === 'acTL') throw new Error('Animated PNG is unsupported; choose a static image.');
    if (kind === 'IDAT') data += n;
    o += n + 12;
    if (kind === 'IEND') { if (n || o !== b.length || !data) corrupt(); return orientation === undefined ? { format: 'png', width, height, orientation: 1 } : { format: 'png', width, height, orientation }; }
  }
  return corrupt();
}
function exifOrientation(b: Uint8Array, start: number, end: number, bare = false): PhotoHeader['orientation'] | undefined {
  const prefixed = ascii(b, start, 6) === 'Exif\0\0';
  if (!prefixed && !bare) return undefined;
  const base = prefixed ? start + 6 : start;
  if (base + 8 > end) corrupt();
  const order = ascii(b, base, 2);
  if (order !== 'II' && order !== 'MM') corrupt();
  const little = order === 'II', view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (view.getUint16(base + 2, little) !== 42) corrupt();
  const offset = view.getUint32(base + 4, little), directory = base + offset;
  if (offset < 8 || directory + 2 > end) corrupt();
  const count = view.getUint16(directory, little);
  if (count > 4096 || directory + 2 + count * 12 + 4 > end) corrupt();
  let orientation: PhotoHeader['orientation'] | undefined;
  for (let index = 0; index < count; index++) {
    const entry = directory + 2 + index * 12;
    if (view.getUint16(entry, little) !== 0x112) continue;
    if (orientation !== undefined || view.getUint16(entry + 2, little) !== 3 || view.getUint32(entry + 4, little) !== 1) corrupt();
    const found = view.getUint16(entry + 8, little);
    if (found < 1 || found > 8) corrupt();
    orientation = found as PhotoHeader['orientation'];
  }
  return orientation;
}
function jpeg(b: Uint8Array): PhotoHeader {
  if (b.length < 4 || b[b.length - 2] !== 255 || b[b.length - 1] !== 217) corrupt();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 2, count = 0;
  let frame: PhotoHeader | undefined, orientation: PhotoHeader['orientation'] | undefined, seenExif = false;
  while (o < b.length - 2) {
    if (++count > 4096) throw new Error('JPEG contains too many header markers.');
    if (o > INPUT_LIMIT) throw new Error('JPEG header metadata exceeds 8 MiB.');
    if (b[o++] !== 255) corrupt();
    while (b[o] === 255) o++;
    const marker = b[o++];
    if (marker === 0 || marker === 217) corrupt();
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (o + 2 > b.length) corrupt();
    const n = v.getUint16(o);
    if (n < 2 || o + n > b.length) corrupt();
    if (o + n > INPUT_LIMIT) throw new Error('JPEG header metadata exceeds 8 MiB.');
    if (marker === 225) {
      if (ascii(b, o + 2, 6) === 'Exif\0\0') { if (seenExif) corrupt(); seenExif = true; }
      const found = exifOrientation(b, o + 2, o + n);
      if (found !== undefined) { if (orientation !== undefined) corrupt(); orientation = found; }
    }
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (n < 8 || n !== 8 + 3 * b[o + 7]) corrupt();
      const height = v.getUint16(o + 3), width = v.getUint16(o + 5); dimensions(width, height);
      if (frame) throw new Error('Corrupt JPEG: multiple image frame headers.');
      frame = { format: 'jpeg', width, height, orientation: 1 };
    }
    if (marker === 218) { if (!frame) corrupt(); return orientation === undefined ? frame : { ...frame, orientation }; }
    o += n;
  }
  if (frame && o === b.length - 2) return orientation === undefined ? frame : { ...frame, orientation };
  return corrupt();
}
function webp(b: Uint8Array): PhotoHeader {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 20 || v.getUint32(4, true) !== b.length - 8) corrupt();
  let o = 12, count = 0, frame: PhotoHeader | undefined, canvas: PhotoHeader | undefined, orientation: PhotoHeader['orientation'] | undefined, seenExif = false;
  while (o + 8 <= b.length && ++count <= 4096) {
    const kind = ascii(b, o, 4), n = v.getUint32(o + 4, true), at = o + 8;
    if (n > b.length - at) corrupt();
    if (kind === 'EXIF') {
      if (seenExif) corrupt();
      seenExif = true;
      orientation = exifOrientation(b, at, at + n, true);
    }
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated WebP is unsupported; choose a static image.');
    if (kind === 'VP8X') {
      if (canvas || count !== 1 || n !== 10 || b[at] & 0xc1 || b[at + 1] || b[at + 2] || b[at + 3]) corrupt();
      if (b[at] & 2) throw new Error('Animated WebP is unsupported; choose a static image.');
      const u24 = (p: number) => b[p] + b[p + 1] * 256 + b[p + 2] * 65536;
      canvas = { format: 'webp', width: u24(at + 4) + 1, height: u24(at + 7) + 1, orientation: 1 }; dimensions(canvas.width, canvas.height);
    }
    if (kind === 'VP8L' || kind === 'VP8 ') {
      if (frame) throw new Error('Corrupt WebP: multiple image frames.');
      let width: number, height: number;
      if (kind === 'VP8L') {
        if (n < 5 || b[at] !== 47) corrupt();
        const packed = v.getUint32(at + 1, true); if (packed >>> 29) corrupt();
        width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1;
      } else {
        if (n < 10 || b[at] & 1 || ascii(b, at + 3, 3) !== '\x9d\x01\x2a') corrupt();
        width = v.getUint16(at + 6, true) & 0x3fff; height = v.getUint16(at + 8, true) & 0x3fff;
      }
      dimensions(width, height); frame = { format: 'webp', width, height, orientation: 1 };
    }
    o = at + n + n % 2;
  }
  if (o !== b.length || !frame) throw new Error('Corrupt WebP: missing image frame.');
  if (canvas && (canvas.width !== frame.width || canvas.height !== frame.height)) throw new Error('WebP canvas dimensions do not match its image frame.');
  return orientation === undefined ? frame : { ...frame, orientation };
}
/** Container bounds are checked before allocating a browser bitmap. */
export function inspectPhotoHeader(bytes: Uint8Array): PhotoHeader {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > INPUT_LIMIT) throw new Error('Choose a nonempty image of at most 8 MiB.');
  let header: PhotoHeader;
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') header = png(bytes);
  else if (bytes[0] === 255 && bytes[1] === 216) header = jpeg(bytes);
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') header = webp(bytes);
  else throw new Error('Choose an actual PNG, JPEG, or static WebP image.');
  return header;
}
const PNG_PREFIX = 'data:image/png;base64,';
/** Header/structure validation is synchronous; compressed pixels are gated by decodePhoto. */
export function validatePhotoAsset(value: unknown): PhotoAsset {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Photo must be a plain object with exact fields.');
  const prototype = Object.getPrototypeOf(value), expected = ['id', 'width', 'height', 'dataUrl'], keys = Reflect.ownKeys(value);
  if ((prototype !== Object.prototype && prototype !== null) || keys.length !== expected.length || keys.some(key => typeof key !== 'string' || !expected.includes(key))) throw new Error('Photo must contain exactly its plain data fields.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (expected.some(key => !('value' in descriptors[key]) || !descriptors[key].enumerable)) throw new Error('Photo fields must contain plain data.');
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || !UUID.test(input.id)) throw new Error('Photo must have a canonical lowercase UUID.');
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || (input.width as number) < 1 || (input.height as number) < 1 || (input.width as number) > LIMITS.photoSide || (input.height as number) > LIMITS.photoSide) throw new Error('Normalized photo dimensions must be integers from 1 through 1280.');
  if (typeof input.dataUrl !== 'string' || !input.dataUrl.startsWith(PNG_PREFIX)) throw new Error('Photo must contain an embedded PNG data URL.');
  if (input.dataUrl.length > PNG_PREFIX.length + Math.ceil(LIMITS.photoBytes / 3) * 4) throw new Error('Normalized PNG exceeds the 7 MiB byte limit.');
  const encoded = input.dataUrl.slice(PNG_PREFIX.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid PNG base64.');
  let raw: string;
  try { raw = atob(encoded); if (btoa(raw) !== encoded) throw new Error(); } catch { throw new Error('Invalid canonical PNG base64.'); }
  if (raw.length > LIMITS.photoBytes) throw new Error('Normalized PNG exceeds the 7 MiB byte limit.');
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0)), header = inspectPhotoHeader(bytes);
  if (header.format !== 'png' || header.width !== input.width || header.height !== input.height) throw new Error('Normalized PNG header dimensions must match its declared dimensions.');
  const view = new DataView(bytes.buffer);
  for (let offset = 8; offset + 12 <= bytes.length; offset += view.getUint32(offset) + 12) {
    if (['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(ascii(bytes, offset + 4, 4))) throw new Error('Normalized PNG must not contain orientation or text metadata.');
  }
  return { id: input.id, width: input.width as number, height: input.height as number, dataUrl: input.dataUrl };
}
