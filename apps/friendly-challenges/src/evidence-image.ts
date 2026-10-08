import { inspectPhotoHeader, stripGeneratedJpegMetadata } from './photo-header.ts';

/** Local normalization only; the service independently admits the retained JPEG. */
export async function normalizeEvidenceImage(file: File, signal?: AbortSignal): Promise<{ blob: Blob; width: number; height: number }> {
  if (signal?.aborted) throw new DOMException('Image operation cancelled.', 'AbortError');
  if (!(file instanceof Blob) || !file.size || file.size > 8 * 1024 * 1024) throw new Error('Choose a nonempty PNG or JPEG of at most 8 MiB.');
  let retired = false, failure: Error | undefined;
  let rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  void stopped.catch(() => {});
  const deadline = performance.now() + 15_000;
  const stop = (error: Error): void => { if (!retired) { retired = true; failure = error; rejectStop(error); } };
  const cancel = (): void => stop(new DOMException('Image operation cancelled.', 'AbortError'));
  const timer = setTimeout(() => stop(new Error('Image normalization timed out. Choose the image again.')), 15_000);
  signal?.addEventListener('abort', cancel, { once: true });
  const check = (): void => {
    if (signal?.aborted) cancel();
    if (!retired && performance.now() >= deadline) stop(new Error('Image normalization timed out. Choose the image again.'));
    if (failure) throw failure;
  };
  const wait = async <T>(pending: Promise<T>): Promise<T> => { const value = await Promise.race([pending, stopped]); check(); return value; };
  let decoded: ImageBitmap | undefined, canvas: OffscreenCanvas | undefined;
  try {
    check();
    const bytes = new Uint8Array(await wait(file.arrayBuffer()));
    if (bytes.length !== file.size) throw new Error('The image file could not be read completely.');
    const header = inspectPhotoHeader(bytes), mime = header.format === 'png' ? 'image/png' : 'image/jpeg';
    if (file.type && file.type !== mime) throw new Error('The file type does not match its PNG or JPEG contents.');
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('Safe image normalization is unavailable in this browser.');
    const pending = createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'from-image' }).then(value => {
      // Native decoders cannot be physically aborted. Retired outputs are never published.
      if (retired) value.close(); else decoded = value;
      return value;
    });
    try { await wait(pending); }
    catch (error) { check(); if (error instanceof Error && error.name === 'AbortError') throw error; throw new Error('The compressed image could not be decoded.'); }
    if (!decoded) throw new Error('The image decoder returned no bitmap.');
    const swapped = header.orientation >= 5;
    const sourceWidth = swapped ? header.height : header.width, sourceHeight = swapped ? header.width : header.height;
    if (decoded.width !== sourceWidth || decoded.height !== sourceHeight) throw new Error('Decoded dimensions do not match the image header and orientation.');
    const factor = Math.min(1, 1024 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * factor)), height = Math.max(1, Math.round(sourceHeight * factor));
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!context) throw new Error('Canvas image access is unavailable in this browser.');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(decoded, 0, 0, width, height);
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      check();
      const blob = await wait(canvas.convertToBlob({ type: 'image/jpeg', quality }));
      if (blob.type !== 'image/jpeg' || !blob.size || blob.size > 8 * 1024 * 1024) throw new Error('The browser could not produce a normalized JPEG.');
      const raw = new Uint8Array(await wait(blob.arrayBuffer()));
      const stripped = stripGeneratedJpegMetadata(raw); check();
      const normalized = new Blob([stripped], { type: 'image/jpeg' });
      if (normalized.size <= 512 * 1024) return { blob: normalized, width, height };
    }
    throw new Error('The normalized JPEG exceeds 512 KiB. Choose a simpler image.');
  } finally {
    retired = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
    decoded?.close(); if (canvas) canvas.width = canvas.height = 0;
  }
}
