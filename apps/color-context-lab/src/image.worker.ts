import { normalizeImage } from './images.ts';
import { decodePixels, validateProject } from './model.ts';
import { encodePng } from './png.ts';
import { renderComparison } from './render.ts';
import { buildHtmlReport, buildVariantReport, validateVariantPair } from './report.ts';
import { LIMITS } from './types.ts';
import type { JobReply, JobRequest } from './jobs.ts';
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage(value: JobReply, transfer?: Transferable[]): void; close(): void };
let used = false;
function request(value: unknown): JobRequest {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Invalid request.');
  const data = value as Record<string, unknown>;
  const keys = data.kind === 'normalize' ? ['kind', 'file'] : data.kind === 'png' ? ['kind', 'project', 'variant'] : (data.kind === 'variant-report' || data.kind === 'variant-preview') ? ['kind', 'project', 'first', 'second'] : ['kind', 'project'];
  if (Object.keys(data).length !== keys.length || !keys.every(key => Object.hasOwn(data, key)) || !['normalize', 'preview', 'png', 'report', 'variant-report', 'variant-preview'].includes(String(data.kind))) throw new Error('Invalid request.');
  if (data.kind !== 'normalize') validateProject(data.project);
  if (data.kind === 'png' && data.variant !== 'source' && data.variant !== 'result') throw new Error('Invalid request.');
  if (data.kind === 'variant-report' || data.kind === 'variant-preview') validateVariantPair(validateProject(data.project), data.first as number, data.second as number);
  return data as unknown as JobRequest;
}
scope.onmessage = event => {
  if (used) return;
  used = true;
  scope.onmessage = null;
  void run(event.data);
};
async function run(data: unknown): Promise<void> {
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(), LIMITS.jobTimeoutMs);
  try {
    const input = request(data);
    let reply: JobReply;
    const transfer: Transferable[] = [];
    if (input.kind === 'normalize') reply = { ok: true, kind: 'normalize', value: await normalizeImage(input.file, controller.signal) };
    else if (input.kind === 'preview') {
      const value = renderComparison(input.project);
      transfer.push(value.baseline.rgba.buffer, value.result.rgba.buffer);
      reply = { ok: true, kind: 'preview', value };
    } else if (input.kind === 'png') {
      const value = encodePng(input.variant === 'source' ? decodePixels(input.project.image) : renderComparison(input.project).result);
      transfer.push(value.buffer);
      reply = { ok: true, kind: 'png', value };
    } else if (input.kind === 'report') reply = { ok: true, kind: 'report', value: await buildHtmlReport(input.project, controller.signal) };
    else if (input.kind === 'variant-preview') {
      const first = renderComparison({...input.project, settings: input.project.variants![input.first]!.settings}).result;
      const second = renderComparison({...input.project, settings: input.project.variants![input.second]!.settings}).result;
      transfer.push(first.rgba.buffer, second.rgba.buffer);
      reply = {ok: true, kind: 'variant-preview', value: {first, second}};
    }
    else reply = {ok: true, kind: 'variant-report', value: await buildVariantReport(input.project, input.first, input.second, controller.signal)};
    if (controller.signal.aborted || performance.now() - started >= LIMITS.jobTimeoutMs) throw new Error('Deadline exceeded.');
    scope.postMessage(reply, transfer);
  } catch { scope.postMessage({ ok: false, error: 'Image processing failed. Choose a supported PNG or retry.' }); }
  finally { clearTimeout(timer); scope.close(); }
}
