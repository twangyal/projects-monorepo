import { admitImageFile } from './images.ts';
import { validateImageAsset, validateProject } from './model.ts';
import { inspectPng } from './png.ts';
import { LIMITS } from './types.ts';
import type { Comparison, ImageAsset, Metrics, Project, Raster } from './types.ts';
export interface JobOptions { signal?: AbortSignal }
export type JobRequest = { kind: 'normalize'; file: File } | { kind: 'preview'; project: Project } | { kind: 'png'; project: Project; variant: 'source' | 'result' } | { kind: 'report'; project: Project };
export type JobReply = { ok: true; kind: 'normalize'; value: ImageAsset } | { ok: true; kind: 'preview'; value: Comparison } | { ok: true; kind: 'png'; value: Uint8Array } | { ok: true; kind: 'report'; value: string } | { ok: false; error: string };
let active: { stop: () => void } | undefined;
const abort = () => new DOMException('Operation cancelled.', 'AbortError');
const failed = () => new Error('Image processing failed. Retry the operation or choose a supported PNG.');
function signalFrom(options?: JobOptions): AbortSignal | undefined {
  if (options === undefined) return undefined;
  if (!exact(options, ['signal'], true) || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) throw new Error('Invalid job options.');
  if (options.signal?.aborted) throw abort();
  return options.signal;
}
function exact(value: unknown, keys: string[], optional = false): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return (optional || actual.length === keys.length) && actual.every(key => typeof key === 'string' && keys.includes(key) && 'value' in Object.getOwnPropertyDescriptor(value, key)!) && (optional || keys.every(key => Object.hasOwn(value, key)));
}
function raster(value: unknown, width: number, height: number): Raster {
  if (!exact(value, ['width', 'height', 'rgba']) || value.width !== width || value.height !== height || !(value.rgba instanceof Uint8ClampedArray) || value.rgba.length !== width * height * 4) throw failed();
  return value as unknown as Raster;
}
function comparison(value: unknown, project: Project): Comparison {
  if (!exact(value, ['baseline', 'result', 'metrics'])) throw failed();
  const width = project.image.width + 2 * project.settings.border;
  const height = project.image.height + 2 * project.settings.border;
  const baseline = raster(value.baseline, width, height);
  const result = raster(value.result, width, height);
  const metrics = value.metrics;
  const fields = ['artworkChangedPixels', 'artworkMaxChannelDelta', 'surroundPixels', 'totalPixels', 'rgbRmse', 'maxRgbDelta', 'meanAbsoluteLuminanceDelta'];
  if (!exact(metrics, fields) || !fields.every(key => typeof metrics[key] === 'number' && Number.isFinite(metrics[key])) || metrics.artworkChangedPixels !== 0 || metrics.artworkMaxChannelDelta !== 0 || metrics.totalPixels !== width * height || metrics.surroundPixels !== width * height - project.image.width * project.image.height || (metrics.rgbRmse as number) < 0 || (metrics.rgbRmse as number) > 255 || !Number.isInteger(metrics.maxRgbDelta) || (metrics.maxRgbDelta as number) < 0 || (metrics.maxRgbDelta as number) > 255 || (metrics.meanAbsoluteLuminanceDelta as number) < 0 || (metrics.meanAbsoluteLuminanceDelta as number) > 1) throw failed();
  return { baseline, result, metrics: metrics as unknown as Metrics };
}
function start<T>(request: JobRequest, signal: AbortSignal | undefined, admit: (reply: unknown) => T): Promise<T> {
  cancelJobs();
  return new Promise<T>((resolve, reject) => {
    const started = performance.now();
    let worker: Worker;
    try { worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' }); } catch { reject(failed()); return; }
    let settled = false;
    const owner = { stop: () => finish(abort()) };
    function finish(error?: Error, value?: T): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', owner.stop);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (active === owner) active = undefined;
      if (error) reject(error); else resolve(value!);
    }
    const timer = setTimeout(() => finish(new Error('Image processing timed out after 30 seconds. Retry with a smaller image.')), LIMITS.jobTimeoutMs);
    active = owner;
    signal?.addEventListener('abort', owner.stop, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (active !== owner || settled) return;
      if (signal?.aborted) { finish(abort()); return; }
      if (performance.now() - started >= LIMITS.jobTimeoutMs) { finish(new Error('Image processing timed out after 30 seconds.')); return; }
      try {
        const data = event.data;
        if (!exact(data, ['ok', 'kind', 'value']) || data.ok !== true || data.kind !== request.kind) throw failed();
        const value = admit(data.value);
        if (performance.now() - started >= LIMITS.jobTimeoutMs) throw new Error('Image processing timed out after 30 seconds.');
        finish(undefined, value);
      } catch { finish(failed()); }
    };
    worker.onerror = event => { event.preventDefault(); if (active === owner) finish(failed()); };
    worker.onmessageerror = () => { if (active === owner) finish(failed()); };
    try { worker.postMessage(request); } catch { finish(failed()); }
  });
}
export async function normalize(file: File, options?: JobOptions): Promise<ImageAsset> {
  admitImageFile(file);
  const signal = signalFrom(options);
  return start({ kind: 'normalize', file }, signal, validateImageAsset);
}
export async function preview(project: Project, options?: JobOptions): Promise<Comparison> {
  const snapshot = validateProject(project);
  const signal = signalFrom(options);
  return start({ kind: 'preview', project: snapshot }, signal, value => comparison(value, snapshot));
}
export async function exportPng(project: Project, variant: 'source' | 'result', options?: JobOptions): Promise<Uint8Array> {
  const snapshot = validateProject(project);
  if (variant !== 'source' && variant !== 'result') throw new Error('Choose source or result PNG.');
  const signal = signalFrom(options);
  return start({ kind: 'png', project: snapshot, variant }, signal, value => {
    if (!(value instanceof Uint8Array) || !value.length || value.length > LIMITS.pngBytes) throw failed();
    const header = inspectPng(value);
    const border = variant === 'source' ? 0 : snapshot.settings.border;
    if (header.width !== snapshot.image.width + 2 * border || header.height !== snapshot.image.height + 2 * border || header.colorType !== 6) throw failed();
    return value;
  });
}
export async function exportReport(project: Project, options?: JobOptions): Promise<string> {
  const snapshot = validateProject(project);
  const signal = signalFrom(options);
  return start({ kind: 'report', project: snapshot }, signal, value => {
    if (typeof value !== 'string' || value.length > LIMITS.reportBytes || new TextEncoder().encode(value).length > LIMITS.reportBytes) throw failed();
    return value;
  });
}
export function cancelJobs(): void { active?.stop(); }
