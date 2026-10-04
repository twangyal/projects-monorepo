import { validateProject } from './model.ts';
import { inspectPhotoHeader, validatePhotoAsset } from './photo-header.ts';
import { encodePng } from './png.ts';
import { LIMITS, type PhotoAsset, type Project, type Raster } from './types.ts';

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image operation cancelled.', 'AbortError');
}
function canvasContext(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas pixel access is unavailable in this browser.');
  return ctx;
}
async function bitmap(source: Blob, signal?: AbortSignal): Promise<ImageBitmap> {
  check(signal);
  if (typeof createImageBitmap !== 'function') throw new Error('This browser does not support safe image decoding.');
  let result: ImageBitmap;
  try { result = await createImageBitmap(source, { imageOrientation: 'from-image' }); }
  catch { check(signal); throw new Error('The compressed image could not be decoded.'); }
  if (signal?.aborted) { result.close(); check(signal); }
  return result;
}
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}
function webpWithoutExif(data: Uint8Array): Blob {
  const parts: Uint8Array<ArrayBuffer>[] = [data.slice(0, 12)], view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  while (offset + 8 <= data.length) {
    const kind = String.fromCharCode(...data.subarray(offset, offset + 4)), length = view.getUint32(offset + 4, true);
    const end = offset + 8 + length + length % 2;
    if (kind !== 'EXIF') {
      const part = data.slice(offset, end);
      if (kind === 'VP8X') part[8] &= ~8;
      parts.push(part);
    }
    offset = end;
  }
  new DataView(parts[0].buffer).setUint32(4, parts.reduce((sum, part) => sum + part.length, 0) - 8, true);
  return new Blob(parts, { type: 'image/webp' });
}
function orient(ctx: OffscreenCanvasRenderingContext2D, value: number): void {
  if (value === 2) ctx.scale(-1, 1);
  else if (value === 3) ctx.rotate(Math.PI);
  else if (value === 4) ctx.scale(1, -1);
  else if (value === 5) { ctx.rotate(Math.PI / 2); ctx.scale(1, -1); }
  else if (value === 6) ctx.rotate(Math.PI / 2);
  else if (value === 7) { ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); }
  else if (value === 8) ctx.rotate(-Math.PI / 2);
}
/** Normalize locally; no URL fetching, document dependency or retained bitmap. */
export async function normalizePhoto(file: File, signal?: AbortSignal): Promise<PhotoAsset> {
  check(signal);
  if (!(file instanceof Blob) || !file.size || file.size > LIMITS.sourceBytes) throw new Error('Choose a nonempty photo of at most 8 MiB.');
  const data = new Uint8Array(await file.arrayBuffer()); check(signal);
  const header = inspectPhotoHeader(data), mime = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[header.format];
  if (file.type && file.type !== mime) throw new Error('The file type does not match its PNG, JPEG or WebP contents.');
  const manual = header.format === 'webp';
  const decoded = await bitmap(manual ? webpWithoutExif(data) : new Blob([data], { type: mime }), signal);
  let canvas: OffscreenCanvas | undefined;
  try {
    check(signal);
    const swapped = header.orientation >= 5, orientedWidth = swapped ? header.height : header.width, orientedHeight = swapped ? header.width : header.height;
    if (decoded.width !== (manual ? header.width : orientedWidth) || decoded.height !== (manual ? header.height : orientedHeight)) throw new Error('Decoded dimensions do not match the image header and orientation.');
    if (typeof OffscreenCanvas !== 'function') throw new Error('This browser does not support safe Canvas normalization.');
    const factor = Math.min(1, LIMITS.photoSide / Math.max(orientedWidth, orientedHeight));
    const width = Math.max(1, Math.round(orientedWidth * factor)), height = Math.max(1, Math.round(orientedHeight * factor));
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvasContext(canvas);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.translate(width / 2, height / 2);
    ctx.scale(width / orientedWidth, height / orientedHeight);
    if (manual) orient(ctx, header.orientation);
    ctx.drawImage(decoded, -decoded.width / 2, -decoded.height / 2);
    check(signal);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const encoded = encodePng({ width, height, rgba }); check(signal);
    return validatePhotoAsset({ id: crypto.randomUUID(), width, height, dataUrl: 'data:image/png;base64,' + base64(encoded) });
  } finally { decoded.close(); if (canvas) canvas.width = canvas.height = 0; }
}
/** Worker-safe actual compressed-pixel gate; output is a detached canonical raster. */
export async function decodePhoto(photo: PhotoAsset, signal?: AbortSignal): Promise<Raster> {
  check(signal);
  const safe = validatePhotoAsset(photo), text = atob(safe.dataUrl.slice('data:image/png;base64,'.length));
  const bytes = Uint8Array.from(text, char => char.charCodeAt(0));
  const decoded = await bitmap(new Blob([bytes], { type: 'image/png' }), signal);
  let canvas: OffscreenCanvas | undefined;
  try {
    check(signal);
    if (decoded.width !== safe.width || decoded.height !== safe.height) throw new Error('Decoded image dimensions do not match its saved asset.');
    if (typeof OffscreenCanvas !== 'function') throw new Error('This browser does not support safe Canvas pixel decoding.');
    canvas = new OffscreenCanvas(safe.width, safe.height);
    const ctx = canvasContext(canvas); ctx.drawImage(decoded, 0, 0);
    return { width: safe.width, height: safe.height, rgba: new Uint8ClampedArray(ctx.getImageData(0, 0, safe.width, safe.height).data) };
  } finally { decoded.close(); if (canvas) canvas.width = canvas.height = 0; }
}
export async function validateProjectImages(project: Project, signal?: AbortSignal): Promise<void> {
  check(signal);
  await decodePhoto(validateProject(project).photo, signal);
  check(signal);
}
