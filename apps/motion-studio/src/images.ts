import { HEIGHT, WIDTH, validateProject, type ImageLayer, type Project } from './model.ts';
const INPUT_LIMIT = 4 * 1024 * 1024, PIXEL_LIMIT = 16_000_000, DATA_LIMIT = 1.5 * 1024 * 1024;
const PREFIX = 'data:image/png;base64,';
export interface ImageHeader { format: 'png' | 'jpeg' | 'webp'; width: number; height: number }
function dimensions(w: number, h: number): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > PIXEL_LIMIT) throw new Error('Image dimensions must contain 1–16,000,000 pixels.');
}
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
function corrupt(): never { throw new Error('Corrupt or truncated image header.'); }
function png(b: Uint8Array): ImageHeader {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8, count = 0, width = 0, height = 0, data = 0;
  while (o + 12 <= b.length && ++count <= 4096) {
    const n = v.getUint32(o), kind = ascii(b, o + 4, 4);
    if (n > b.length - o - 12) corrupt();
    if (count === 1) {
      if (kind !== 'IHDR' || n !== 13) corrupt();
      width = v.getUint32(o + 8); height = v.getUint32(o + 12); dimensions(width, height);
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[b[o + 17]]?.includes(b[o + 16]) || b[o + 18] || b[o + 19] || b[o + 20] > 1) corrupt();
    } else if (kind === 'IHDR') corrupt();
    if (kind === 'acTL') throw new Error('Animated PNG is unsupported; choose a static image.');
    if (kind === 'IDAT') data += n;
    o += n + 12;
    if (kind === 'IEND') { if (n || o !== b.length || !data) corrupt(); return { format: 'png', width, height }; }
  }
  return corrupt();
}
function jpeg(b: Uint8Array): ImageHeader {
  if (b.length < 4 || b[b.length - 2] !== 255 || b[b.length - 1] !== 217) corrupt();
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 2;
  let frame: ImageHeader | undefined;
  while (o < b.length - 2) {
    if (o > 256 * 1024) throw new Error('JPEG header metadata exceeds 256 KiB.');
    if (b[o++] !== 255) corrupt();
    while (b[o] === 255) o++;
    const marker = b[o++];
    if (marker === 0 || marker === 217) corrupt();
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    if (o + 2 > b.length) corrupt();
    const n = v.getUint16(o);
    if (n < 2 || o + n > b.length) corrupt();
    if (o + n > 256 * 1024) throw new Error('JPEG header metadata exceeds 256 KiB.');
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (n < 8 || n !== 8 + 3 * b[o + 7]) corrupt();
      const height = v.getUint16(o + 3), width = v.getUint16(o + 5); dimensions(width, height);
      if (frame) throw new Error('Corrupt JPEG: multiple image frame headers.');
      frame = { format: 'jpeg', width, height };
    }
    if (marker === 218) { if (!frame) corrupt(); return frame; }
    o += n;
  }
  if (frame && o === b.length - 2) return frame;
  return corrupt();
}
function webp(b: Uint8Array): ImageHeader {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 20 || v.getUint32(4, true) !== b.length - 8) corrupt();
  let o = 12, count = 0, frame: ImageHeader | undefined, canvas: ImageHeader | undefined;
  while (o + 8 <= b.length && ++count <= 4096) {
    const kind = ascii(b, o, 4), n = v.getUint32(o + 4, true), at = o + 8;
    if (n > b.length - at) corrupt();
    if (kind === 'ANIM' || kind === 'ANMF') throw new Error('Animated WebP is unsupported; choose a static image.');
    if (kind === 'VP8X') {
      if (canvas || count !== 1 || n !== 10 || b[at] & 0xc1 || b[at + 1] || b[at + 2] || b[at + 3]) corrupt();
      if (b[at] & 2) throw new Error('Animated WebP is unsupported; choose a static image.');
      const u24 = (p: number) => b[p] + b[p + 1] * 256 + b[p + 2] * 65536;
      canvas = { format: 'webp', width: u24(at + 4) + 1, height: u24(at + 7) + 1 }; dimensions(canvas.width, canvas.height);
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
      dimensions(width, height); frame = { format: 'webp', width, height };
    }
    o = at + n + n % 2;
  }
  if (o !== b.length || !frame) throw new Error('Corrupt WebP: missing image frame.');
  if (canvas && (canvas.width !== frame.width || canvas.height !== frame.height)) throw new Error('WebP canvas dimensions do not match its image frame.');
  return frame;
}
/** Container bounds are checked before allocating a browser bitmap. */
export function inspectImageHeader(bytes: Uint8Array, mimeType = ''): ImageHeader {
  if (!bytes.length || bytes.length > INPUT_LIMIT) throw new Error('Choose a nonempty image of at most 4 MiB.');
  let header: ImageHeader;
  if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') header = png(bytes);
  else if (bytes[0] === 255 && bytes[1] === 216) header = jpeg(bytes);
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') header = webp(bytes);
  else throw new Error('Choose an actual PNG, JPEG, or static WebP image.');
  if (mimeType && mimeType !== { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[header.format]) throw new Error('The file type does not match its PNG, JPEG, or WebP contents.');
  return header;
}
export function validateAssetHeader(image: ImageLayer['image']): Uint8Array {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width > 800 || image.height > 800) throw new Error('Normalized PNG dimensions must be integers from 1 to 800.');
  if (typeof image.dataUrl !== 'string' || image.dataUrl.length > DATA_LIMIT || !image.dataUrl.startsWith(PREFIX)) throw new Error('Assets must contain an embedded PNG of at most 1.5 MiB.');
  const encoded = image.dataUrl.slice(PREFIX.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Invalid PNG base64.');
  let raw: string;
  try { raw = atob(encoded); if (btoa(raw) !== encoded) throw new Error(); } catch { throw new Error('Invalid PNG base64.'); }
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0)), header = inspectImageHeader(bytes, 'image/png');
  if (header.width !== image.width || header.height !== image.height) throw new Error('PNG dimensions do not match saved asset metadata.');
  return bytes;
}
/** Worker-compatible: embedded bytes only, no remote fetch or DOM Image. */
export async function decodeImageAsset(image: ImageLayer['image']): Promise<ImageBitmap> {
  const bytes = validateAssetHeader(image);
  if (typeof createImageBitmap !== 'function') throw new Error('This browser does not support safe image decoding.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' })); }
  catch { throw new Error('The PNG compressed image could not be decoded.'); }
  if (bitmap.width !== image.width || bitmap.height !== image.height) { bitmap.close(); throw new Error('Decoded PNG dimensions do not match saved asset metadata.'); }
  return bitmap;
}
export async function validateProjectImages(project: Project): Promise<void> {
  for (const layer of validateProject(project).layers) if (layer.kind === 'image') { const bitmap = await decodeImageAsset(layer.image); bitmap.close(); }
}
export async function importImage(file: File): Promise<ImageLayer> {
  if (!file.size || file.size > INPUT_LIMIT) throw new Error('Choose a nonempty image of at most 4 MiB.');
  const header = inspectImageHeader(new Uint8Array(await file.arrayBuffer()), file.type);
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') throw new Error('This browser does not support safe image import.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('The image compressed pixels could not be decoded.'); }
  const canvas = document.createElement('canvas');
  try {
    dimensions(bitmap.width, bitmap.height);
    const match = bitmap.width === header.width && bitmap.height === header.height;
    const oriented = header.format === 'jpeg' && bitmap.width === header.height && bitmap.height === header.width;
    if (!match && !oriented) throw new Error('Decoded image dimensions do not match its header.');
    let ratio = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height)), dataUrl = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas rendering is unavailable.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length <= DATA_LIMIT) break;
      ratio *= Math.min(0.85, Math.sqrt(DATA_LIMIT / dataUrl.length) * 0.9);
    }
    const image = { dataUrl, width: canvas.width, height: canvas.height }; validateAssetHeader(image);
    return { id: crypto.randomUUID(), name: file.name.replace(/\0/g, '').trim().slice(0, 40) || 'Imported image', kind: 'image', image,
      keys: [{ frame: 0, x: WIDTH / 2, y: HEIGHT / 2, scale: 1, rotation: 0, opacity: 1, easing: 'linear' }] };
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
}
