import { validateProject } from './model.ts';
import { inspectPhotoHeader } from './photo-header.ts';
import { validateRaster } from './png.ts';
import { LIMITS } from './types.ts';
import type { Project, Rendered } from './types.ts';

type Kind = 'render' | 'export';
let active: { cancel: () => void } | null = null;
const aborted = (): DOMException => new DOMException('The rendering job was cancelled.', 'AbortError');
const failed = (): Error => new Error('The rendering worker could not complete this photo. Retry or import a valid image.');

async function run(project: Project, kind: Kind, signal?: AbortSignal): Promise<Rendered | Blob> {
  // A bad replacement must not cancel a useful job already in progress.
  const snapshot = validateProject(project);
  if (signal?.aborted) throw aborted();
  if (typeof Worker !== 'function') throw new Error('This browser needs module workers. Use a current desktop Chromium browser.');
  active?.cancel();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('The rendering worker could not start. Reload this local app and retry.')); return; }
    let settled = false;
    const task = { cancel: () => finish(aborted()) };
    const timer = setTimeout(() => finish(new Error('Rendering timed out after 30 seconds. Try a smaller photo.')), LIMITS.jobTimeoutMs);
    function finish(error: Error | null, value?: Rendered | Blob): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      signal?.removeEventListener('abort', task.cancel);
      worker.terminate();
      if (active === task) active = null;
      if (error) reject(error); else resolve(value!);
    }
    function onError(event: Event): void { event.preventDefault(); finish(failed()); }
    function onMessage(event: MessageEvent<unknown>): void {
      try {
        const data = event.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw failed();
        const result = data as Record<string, unknown>;
        if (kind === 'render' && result.kind === 'rendered' && Object.keys(result).length === 2) {
          validateRaster(result.frame);
          const frame = result.frame as Rendered;
          if (frame.width !== snapshot.photo.width || frame.height !== snapshot.photo.height || typeof frame.missingFraction !== 'number') throw failed();
          finish(null, frame);
        } else if (kind === 'export' && result.kind === 'png' && Object.keys(result).length === 2) {
          if (!(result.bytes instanceof Uint8Array) || !(result.bytes.buffer instanceof ArrayBuffer)
              || result.bytes.byteLength > LIMITS.pngBytes) throw failed();
          const header = inspectPhotoHeader(result.bytes);
          if (header.format !== 'png' || header.width !== snapshot.photo.width || header.height !== snapshot.photo.height) throw failed();
          finish(null, new Blob([new Uint8Array(result.bytes)], { type: 'image/png' }));
        } else throw failed();
      } catch { finish(failed()); }
    }
    active = task;
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    signal?.addEventListener('abort', task.cancel, { once: true });
    try { worker.postMessage({ kind, project: snapshot }); }
    catch { finish(failed()); }
  });
}

export async function renderProject(project: Project, signal?: AbortSignal): Promise<Rendered> {
  return await run(project, 'render', signal) as Rendered;
}
export async function exportPng(project: Project, signal?: AbortSignal): Promise<Blob> {
  return await run(project, 'export', signal) as Blob;
}
