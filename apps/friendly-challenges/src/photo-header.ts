export interface PhotoHeader { format: 'png' | 'jpeg'; width: number; height: number; orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 }
const INPUT_LIMIT = 8 * 1024 * 1024, PIXEL_LIMIT = 16_000_000;
function dimensions(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > PIXEL_LIMIT) throw new Error('Image dimensions must contain 1–16,000,000 pixels.');
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
    if (['acTL', 'fcTL', 'fdAT'].includes(kind)) throw new Error('Animated PNG is unsupported; choose a static image.');
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
interface JpegSegment { marker: number; start: number; lengthAt: number; end: number }
/** Bounded physical extents including entropy escapes and all progressive scans. */
function jpegSegments(b: Uint8Array): JpegSegment[] {
  if (b.length < 4 || b.length > INPUT_LIMIT || b[0] !== 255 || b[1] !== 216) corrupt();
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength), segments: JpegSegment[] = [];
  let at = 2, entropy = false;
  while (at < b.length && segments.length < 4096) {
    if (entropy) {
      let found = false;
      while (at < b.length) {
        if (b[at++] !== 255) continue;
        const start = at - 1;
        while (at < b.length && b[at] === 255) at++;
        if (at >= b.length) corrupt();
        const marker = b[at++];
        if (marker === 0 || marker >= 208 && marker <= 215) continue;
        at = start; found = true; break;
      }
      if (!found) corrupt();
      entropy = false;
    }
    const start = at;
    if (b[at++] !== 255) corrupt();
    while (at < b.length && b[at] === 255) at++;
    if (at >= b.length) corrupt();
    const marker = b[at++], lengthAt = at;
    if (marker === 217) {
      if (at !== b.length) throw new Error('Multiple images or trailing JPEG bytes are unsupported.');
      segments.push({ marker, start, lengthAt, end: at }); return segments;
    }
    if (marker === 0 || marker === 216 || marker >= 208 && marker <= 215) corrupt();
    if (marker === 1) { segments.push({ marker, start, lengthAt, end: at }); continue; }
    if (at + 2 > b.length) corrupt();
    const length = view.getUint16(at);
    if (length < 2 || length > b.length - at) corrupt();
    at += length; segments.push({ marker, start, lengthAt, end: at });
    if (marker === 218) entropy = true;
  }
  return corrupt();
}
function jpeg(b: Uint8Array): PhotoHeader {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let frame: PhotoHeader | undefined, orientation: PhotoHeader['orientation'] | undefined, seenExif = false, scan = false;
  for (const segment of jpegSegments(b)) {
    const { marker, lengthAt: o, end } = segment;
    if (marker === 226 && ascii(b, o + 2, 4) === 'MPF\0') throw new Error('Multi-picture JPEG is unsupported; choose a single static image.');
    if (marker === 225) {
      if (ascii(b, o + 2, 6) === 'Exif\0\0') { if (seenExif) corrupt(); seenExif = true; }
      const found = exifOrientation(b, o + 2, end);
      if (found !== undefined) { if (orientation !== undefined) corrupt(); orientation = found; }
    }
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      const n = view.getUint16(o);
      if (n < 8 || n !== 8 + 3 * b[o + 7]) corrupt();
      const height = view.getUint16(o + 3), width = view.getUint16(o + 5); dimensions(width, height);
      if (frame || scan) throw new Error('Multiple image frame headers are unsupported.');
      frame = { format: 'jpeg', width, height, orientation: 1 };
    }
    if (marker === 218) { if (!frame) corrupt(); scan = true; }
  }
  if (!frame || !scan) return corrupt();
  return orientation === undefined ? frame : { ...frame, orientation };
}
/** Strip metadata only from bounded browser-generated JPEG, before its preview. */
export function stripGeneratedJpegMetadata(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []; let start = 0;
  for (const segment of jpegSegments(bytes)) {
    if (segment.marker >= 225 && segment.marker <= 239 || segment.marker === 254) {
      parts.push(bytes.subarray(start, segment.start)); start = segment.end;
    }
  }
  parts.push(bytes.subarray(start));
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0; for (const part of parts) { result.set(part, at); at += part.length; }
  jpeg(result); return result;
}
/** Container bounds are checked before allocating a browser bitmap. */
export function inspectPhotoHeader(bytes: Uint8Array): PhotoHeader {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > INPUT_LIMIT) throw new Error('Choose a nonempty image of at most 8 MiB.');
  let header: PhotoHeader;
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') header = png(bytes);
  else if (bytes[0] === 255 && bytes[1] === 216) header = jpeg(bytes);
  else throw new Error('Choose an actual static PNG or JPEG image.');
  return header;
}
