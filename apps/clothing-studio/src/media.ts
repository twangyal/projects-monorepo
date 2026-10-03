import type { Photo } from './model.ts';

export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 16_000_000;
export const MAX_INPUT_EDGE = 8000;
export const MAX_PHOTO_EDGE = 1200;
export const MAX_PHOTO_TEXT = 3 * 1024 * 1024;
const MAX_JPEG_HEADER_BYTES = 256 * 1024;
const MAX_CHUNKS = 4096;
const JPEG_PREFIX = 'data:image/jpeg;base64,';

export interface ImageHeader { format: 'png' | 'jpeg' | 'webp'; width: number; height: number }

function invalidImage(): never { throw new Error('The image is corrupt, truncated, or has an invalid header.'); }

function dimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_INPUT_EDGE || height > MAX_INPUT_EDGE) {
    throw new Error('Image dimensions must be between 1 and 8000 pixels on each edge.');
  }
  if (width * height > MAX_INPUT_PIXELS) throw new Error('Choose a photo with at most 16 million pixels.');
}

function textAt(bytes: Uint8Array, offset: number, text: string): boolean {
  return [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function pngHeader(bytes: Uint8Array, view: DataView): ImageHeader {
  if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) {
    throw new Error('The image MIME type does not match PNG image data.');
  }
  if (view.getUint32(8) !== 13 || !textAt(bytes, 12, 'IHDR')) invalidImage();
  const width = view.getUint32(16), height = view.getUint32(20);
  dimensions(width, height);
  if (bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) invalidImage();
  let offset = 8;
  let chunks = 0;
  while (offset + 12 <= bytes.length && ++chunks <= MAX_CHUNKS) {
    const length = view.getUint32(offset);
    const end = offset + length + 12;
    if (end > bytes.length) invalidImage();
    if (textAt(bytes, offset + 4, 'IEND')) {
      if (length !== 0 || end !== bytes.length) invalidImage();
      return { format: 'png', width, height };
    }
    if (offset !== 8 && textAt(bytes, offset + 4, 'IHDR')) invalidImage();
    offset = end;
  }
  return invalidImage();
}

function jpegHeader(bytes: Uint8Array, view: DataView): ImageHeader {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) {
    throw new Error('The image MIME type does not match JPEG image data.');
  }
  if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) invalidImage();
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (offset > MAX_JPEG_HEADER_BYTES) throw new Error('JPEG header metadata is too large to inspect safely.');
    if (bytes[offset++] !== 255) invalidImage();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0 || marker === 216 || marker === 217 || marker === 218) invalidImage();
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) invalidImage();
    const length = view.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) invalidImage();
    if (end > MAX_JPEG_HEADER_BYTES) throw new Error('JPEG header metadata is too large to inspect safely.');
    if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
      if (length < 8 || length !== 8 + 3 * (bytes[offset + 7] ?? 0)) invalidImage();
      const height = view.getUint16(offset + 3), width = view.getUint16(offset + 5);
      dimensions(width, height);
      return { format: 'jpeg', width, height };
    }
    offset = end;
  }
  return invalidImage();
}

function webpHeader(bytes: Uint8Array, view: DataView): ImageHeader {
  if (bytes.length < 20 || !textAt(bytes, 0, 'RIFF') || !textAt(bytes, 8, 'WEBP')) {
    throw new Error('The image MIME type does not match WebP image data.');
  }
  if (view.getUint32(4, true) !== bytes.length - 8) invalidImage();
  let offset = 12;
  let chunks = 0;
  let header: ImageHeader | null = null;
  while (offset + 8 <= bytes.length && ++chunks <= MAX_CHUNKS) {
    const length = view.getUint32(offset + 4, true);
    const data = offset + 8;
    const end = data + length + (length % 2);
    if (end > bytes.length) invalidImage();
    {
      let width: number | undefined, height: number | undefined;
      if (textAt(bytes, offset, 'VP8X')) {
        if (length !== 10) invalidImage();
        if (((bytes[data] ?? 0) & 2) !== 0) throw new Error('Choose a still WebP photo instead of an animated image.');
        width = 1 + (bytes[data + 4] ?? 0) + ((bytes[data + 5] ?? 0) << 8) + ((bytes[data + 6] ?? 0) << 16);
        height = 1 + (bytes[data + 7] ?? 0) + ((bytes[data + 8] ?? 0) << 8) + ((bytes[data + 9] ?? 0) << 16);
      } else if (textAt(bytes, offset, 'VP8L')) {
        if (length < 5 || bytes[data] !== 47) invalidImage();
        const bits = view.getUint32(data + 1, true);
        width = 1 + (bits & 0x3fff);
        height = 1 + ((bits >>> 14) & 0x3fff);
      } else if (textAt(bytes, offset, 'VP8 ')) {
        if (length < 10 || ((bytes[data] ?? 1) & 1) !== 0 || bytes[data + 3] !== 157 || bytes[data + 4] !== 1 || bytes[data + 5] !== 42) invalidImage();
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
      }
      if (width !== undefined && height !== undefined) {
        dimensions(width, height);
        if (header && (header.width !== width || header.height !== height)) {
          throw new Error('WebP compressed-frame dimensions do not match its canvas metadata.');
        }
        header = { format: 'webp', width, height };
      }
    }
    offset = end;
  }
  if (offset !== bytes.length || !header || chunks > MAX_CHUNKS) invalidImage();
  return header;
}

/** Checks the bounded container and dimensions before any browser image decode. */
export function inspectImageHeader(bytes: Uint8Array, mimeType: string): ImageHeader {
  if (bytes.length > MAX_INPUT_BYTES) throw new Error('Choose a photo no larger than 10 MiB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  switch (mimeType) {
    case 'image/png': return pngHeader(bytes, view);
    case 'image/jpeg': return jpegHeader(bytes, view);
    case 'image/webp': return webpHeader(bytes, view);
    default: throw new Error('Choose a PNG, JPEG, or WebP photo with the correct image MIME type.');
  }
}

/** Synchronous backup envelope verification; full image decode follows in validatePhoto. */
export function validatePhotoHeader(photo: Photo): Uint8Array {
  if (!photo || typeof photo !== 'object' || typeof photo.dataUrl !== 'string' || photo.dataUrl.length > MAX_PHOTO_TEXT) {
    throw new Error('The encoded photo must be a JPEG data URI no larger than 3 MiB.');
  }
  if (!Number.isInteger(photo.width) || !Number.isInteger(photo.height) || photo.width < 1 || photo.height < 1 || photo.width > MAX_PHOTO_EDGE || photo.height > MAX_PHOTO_EDGE) {
    throw new Error('Saved photo dimensions must be integers between 1 and 1200 pixels.');
  }
  if (typeof photo.name !== 'string' || !photo.name.trim() || photo.name.length > 120) throw new Error('The photo name must contain 1–120 characters.');
  if (!photo.dataUrl.startsWith(JPEG_PREFIX)) throw new Error('The saved photo must contain a normalized JPEG image data URI.');
  const encoded = photo.dataUrl.slice(JPEG_PREFIX.length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('The saved photo has invalid JPEG base64 image data.');
  let binary: string;
  try {
    binary = atob(encoded);
    if (btoa(binary) !== encoded) throw new Error('Noncanonical base64');
  } catch { throw new Error('The saved photo has invalid JPEG base64 image data.'); }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const header = inspectImageHeader(bytes, 'image/jpeg');
  if (header.width !== photo.width || header.height !== photo.height) throw new Error('Saved photo dimensions do not match its encoded JPEG metadata.');
  return bytes;
}

async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  if (typeof globalThis.createImageBitmap !== 'function') throw new Error('This browser cannot decode local photos. Try a current browser.');
  try { return await createImageBitmap(blob); }
  catch { throw new Error('The photo could not be decoded. It may be corrupt or truncated.'); }
}

export async function importPhoto(file: File): Promise<Photo> {
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error('Choose a nonempty photo no larger than 10 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = inspectImageHeader(bytes, file.type);
  const bitmap = await decodeImage(file);
  try {
    dimensions(bitmap.width, bitmap.height);
    // Browser EXIF orientation can exchange the two edges before normalization.
    if (!((bitmap.width === header.width && bitmap.height === header.height) || (bitmap.width === header.height && bitmap.height === header.width))) {
      throw new Error('Decoded photo dimensions do not match its image header.');
    }
    const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare a photo preview.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const photo: Photo = {
      dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height,
      name: file.name.trim().slice(0, 120) || 'Local photo',
    };
    validatePhotoHeader(photo);
    return photo;
  } finally { bitmap.close(); }
}

export async function validatePhoto(photo: Photo | null): Promise<void> {
  if (photo === null) return;
  const bytes = validatePhotoHeader(photo);
  const bitmap = await decodeImage(new Blob([Uint8Array.from(bytes)], { type: 'image/jpeg' }));
  try {
    if (bitmap.width !== photo.width || bitmap.height !== photo.height) throw new Error('Decoded photo dimensions do not match the saved photo metadata.');
  } finally { bitmap.close(); }
}
