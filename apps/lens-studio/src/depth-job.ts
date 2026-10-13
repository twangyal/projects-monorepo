import type { PhotoAsset } from './types.ts';

export interface DepthResult { width: number; height: number; values: Float32Array; seconds: number; threads: number }
export type DepthStage = 'model' | 'infer';

/** Inference is slow on CPU-only browsers (tens of seconds single-threaded); this bounds a stuck worker. */
export const DEPTH_TIMEOUT_MS = 180_000;

/** Owned worker per estimate: cancel, timeout and every failure terminate it; late messages are ignored. */
export function estimateDepth(model: Blob, photo: PhotoAsset, signal: AbortSignal, onStage: (stage: DepthStage, threads?: number) => void): Promise<DepthResult> {
  if (signal.aborted) return Promise.reject(new DOMException('Depth estimation canceled.', 'AbortError'));
  if (typeof Worker !== 'function') return Promise.reject(new Error('This browser needs module workers for depth estimation.'));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./depth-estimate.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('The depth worker could not start. Reload this local app and retry.')); return; }
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Depth estimation took longer than 3 minutes and was stopped. Try a smaller photo or a faster browser.')), DEPTH_TIMEOUT_MS);
    function finish(error: Error | null, result?: DepthResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.removeEventListener('message', message);
      worker.removeEventListener('error', failure);
      worker.removeEventListener('messageerror', failure);
      worker.terminate();
      if (error) reject(error); else resolve(result!);
    }
    function cancel(): void { finish(new DOMException('Depth estimation canceled.', 'AbortError')); }
    function failure(event: Event): void { event.preventDefault(); finish(new Error('Depth estimation failed in this browser.')); }
    function message(event: MessageEvent<unknown>): void {
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object') { finish(new Error('Depth estimation failed in this browser.')); return; }
      if (data.kind === 'stage' && (data.stage === 'model' || data.stage === 'infer')) { onStage(data.stage, typeof data.threads === 'number' ? data.threads : undefined); return; }
      if (data.kind === 'error') { finish(new Error(typeof data.message === 'string' ? data.message.slice(0, 300) : 'Depth estimation failed in this browser.')); return; }
      const { width, height, values, seconds, threads } = data;
      if (data.kind !== 'depth' || width !== photo.width || height !== photo.height || !(values instanceof Float32Array) || values.length !== photo.width * photo.height
        || typeof seconds !== 'number' || typeof threads !== 'number' || values.some(v => !(v >= 0 && v <= 1))) {
        finish(new Error('The depth worker returned an unexpected result.'));
        return;
      }
      finish(null, { width, height, values, seconds, threads });
    }
    worker.addEventListener('message', message);
    worker.addEventListener('error', failure);
    worker.addEventListener('messageerror', failure);
    signal.addEventListener('abort', cancel, { once: true });
    try { worker.postMessage({ model, photo }); }
    catch { finish(new Error('The depth worker could not receive this photo.')); }
  });
}
