import { createImageAsset } from './model.ts';
import { inspectPng } from './png.ts';
import { LIMITS } from './types.ts';
import type { ImageAsset } from './types.ts';

export function admitImageFile(file: File): void {
  if (!(file instanceof File) || file.size < 1 || file.size > LIMITS.sourceBytes || (file.type !== '' && file.type !== 'image/png')) throw new Error('Choose a nonempty PNG file no larger than 8 MiB.');
  if (file.name.length > LIMITS.fileNameCharacters * 2 || !file.name.trim() || [...file.name].length > LIMITS.fileNameCharacters || [...file.name].some(character => { const code = character.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029 || (code >= 0xd800 && code <= 0xdfff); })) throw new Error('Use a PNG file with a valid single-line name of at most 240 characters.');
}
function check(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError'); }
export async function normalizeImage(file: File, signal?: AbortSignal): Promise<ImageAsset> {
  admitImageFile(file);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal.');
  check(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  check(signal);
  const header = inspectPng(bytes);
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer], { type: 'image/png' }), { imageOrientation: 'none', colorSpaceConversion: 'default' });
    check(signal);
    if (bitmap.width !== header.width || bitmap.height !== header.height) throw new Error('PNG decoder dimensions do not match its header.');
    const ratio = Math.min(1, LIMITS.imageSide / Math.max(header.width, header.height));
    const width = Math.max(1, Math.round(header.width * ratio));
    const height = Math.max(1, Math.round(header.height * ratio));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!context) throw new Error('Canvas image decoding is unavailable.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const rgba = context.getImageData(0, 0, width, height).data;
    check(signal);
    return createImageAsset({ width, height, rgba }, { fileName: file.name, format: 'png', width: header.width, height: header.height });
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Operation cancelled.', 'AbortError');
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('The PNG could not be decoded. Convert it to a static, non-interlaced 8-bit RGB or RGBA PNG and retry.');
  } finally {
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
