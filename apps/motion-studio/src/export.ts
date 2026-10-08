import { validateProject, type Project } from './model.ts';

const MAX_BYTES = 32 * 1024 * 1024;
const TIMEOUT = 30_000;

function cancelled(): DOMException {
  return new DOMException('GIF export cancelled.', 'AbortError');
}

/** Export an independent, validated snapshot in a disposable module worker. */
export async function exportGif(
  project: Project,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const snapshot = validateProject(project);
  if (signal?.aborted) throw cancelled();
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('This browser does not support GIF export with workers and OffscreenCanvas.');
  }

  return new Promise<Blob>((resolve, reject) => {
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let lastProgress = 0;

    function finish(error?: Error, blob?: Blob): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
      if (error) reject(error);
      else if (blob) resolve(blob);
      else reject(new Error('GIF export failed.'));
    }

    function abort(): void { finish(cancelled()); }

    try {
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new Error('GIF export timed out after 30 seconds.')), TIMEOUT);
      worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        try {
          if (!event.data || typeof event.data !== 'object') throw new Error('Invalid GIF worker response.');
          const message = event.data as { type?: string; fraction?: unknown; buffer?: unknown; message?: unknown };
          if (message.type === 'progress') {
            const fraction = message.fraction;
            if (typeof fraction !== 'number' || !Number.isFinite(fraction)
                || fraction < lastProgress || fraction > 1) {
              throw new Error('Invalid GIF worker progress.');
            }
            lastProgress = fraction;
            onProgress(fraction);
          } else if (message.type === 'complete') {
            const buffer = message.buffer;
            if (!(buffer instanceof ArrayBuffer)) throw new Error('Invalid GIF worker output.');
            if (buffer.byteLength > MAX_BYTES) throw new Error('GIF export exceeds the 32 MiB output limit.');
            const signature = String.fromCharCode(...new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength)));
            if (signature !== 'GIF89a' && signature !== 'GIF87a') throw new Error('Invalid GIF worker output.');
            if (lastProgress < 1) onProgress(1);
            finish(undefined, new Blob([buffer], { type: 'image/gif' }));
          } else if (message.type === 'error') {
            throw new Error(typeof message.message === 'string' ? message.message.slice(0, 300) : 'GIF export failed.');
          } else {
            throw new Error('Invalid GIF worker response.');
          }
        } catch (error) {
          finish(error instanceof Error ? error : new Error('GIF export failed.'));
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        finish(new Error(event.message.slice(0, 300) || 'The GIF export worker failed.'));
      };
      worker.onmessageerror = () => finish(new Error('Could not receive the generated GIF.'));
      onProgress(0);
      if (!settled) worker.postMessage({ type: 'start', project: snapshot });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Could not start GIF export.'));
    }
  });
}
