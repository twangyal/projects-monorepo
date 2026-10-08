import { validateProject, type Project } from './model.ts';
import { MAX_ARCHIVE_BYTES, validatePngArchive } from './png-archive.ts';

/** One complete committed animation, owned by a disposable worker. */
export async function exportPngFrames(project: Project, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<Blob> {
  const snapshot = validateProject(project);
  const cancelled = () => new DOMException('PNG archive export cancelled.', 'AbortError');
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('This browser does not support PNG archive export with workers and OffscreenCanvas.');
  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker | null = null, timer: ReturnType<typeof setTimeout> | undefined, settled = false, progress = 0;
    const deadline = performance.now() + 30_000;
    function finish(error?: Error, blob?: Blob) {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (worker) { worker.onmessage = worker.onerror = worker.onmessageerror = null; worker.terminate(); }
      if (error) reject(error); else if (blob) resolve(blob); else reject(new Error('PNG archive export failed.'));
    }
    function abort() { finish(cancelled()); }
    function check() {
      if (signal?.aborted) throw cancelled();
      if (performance.now() >= deadline) throw new Error('PNG archive export timed out after 30 seconds.');
    }
    try {
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new Error('PNG archive export timed out after 30 seconds.')), 30_000);
      worker = new Worker(new URL('./png-frames.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        try {
          check();
          if (!event.data || typeof event.data !== 'object') throw new Error('Invalid PNG worker response.');
          const message = event.data as { type?: unknown; fraction?: unknown; buffer?: unknown; message?: unknown };
          if (message.type === 'progress') {
            if (typeof message.fraction !== 'number' || !Number.isFinite(message.fraction) || message.fraction < progress || message.fraction > 1) throw new Error('Invalid PNG worker progress.');
            progress = message.fraction; onProgress(progress);
          } else if (message.type === 'complete') {
            if (!(message.buffer instanceof ArrayBuffer) || message.buffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error('Invalid PNG archive worker output (at most 96 MiB).');
            validatePngArchive(new Uint8Array(message.buffer), snapshot);
            check();
            if (progress < 1) onProgress(1);
            // Progress callbacks can cancel or retire their owner synchronously.
            if (settled) return; check();
            finish(undefined, new Blob([message.buffer], { type: 'application/zip' }));
          } else if (message.type === 'error') throw new Error(typeof message.message === 'string' ? message.message.slice(0, 300) : 'PNG archive export failed.');
          else throw new Error('Invalid PNG worker response.');
        } catch (error) { finish(error instanceof Error ? error : new Error('PNG archive export failed.')); }
      };
      worker.onerror = event => { event.preventDefault(); finish(new Error(event.message.slice(0, 300) || 'PNG export worker failed.')); };
      worker.onmessageerror = () => finish(new Error('Could not receive the PNG frame archive.'));
      onProgress(0); check();
      if (!settled) worker.postMessage({ type: 'start', project: snapshot });
    } catch (error) { finish(error instanceof Error ? error : new Error('Could not start PNG archive export.')); }
  });
}
