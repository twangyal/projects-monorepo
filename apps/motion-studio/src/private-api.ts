import { MAX_JSON_BYTES, validateProject, type Project } from './model.ts';
export type PrivateStatus = { schemaVersion: 1; transport: { mode: 'http-loopback' | 'https-lan'; origin: string; setupRequired: true }; maxPublications: 8; maxProjectBytes: typeof MAX_JSON_BYTES };
export type Publication = { id: string; createdAt: string; projectSha256: string; projectBytes: number; readToken: string; revokeToken: string };
export type PrivateCredential = { id: string; kind: 'read' | 'revoke'; token: string };
export type SnapshotReceipt = { project: Project; json: Uint8Array<ArrayBuffer>; sha256: string };
export class PrivateApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'PrivateApiError'; this.code = code; }
}
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[0-9a-f]{64}$/;
function invalid(): never { throw new PrivateApiError('invalid', 'The private request or response is invalid. Keep your project and check the original link or service.'); }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new DOMException('Private request cancelled.', 'AbortError'); }
function identity(id: string, token: string): void { if (typeof id !== 'string' || !ID.test(id) || typeof token !== 'string' || !TOKEN.test(token)) invalid(); }
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.split(',').sort().join(',')) invalid();
  return value as Record<string, unknown>;
}
export function parsePrivateFragment(fragment: string): PrivateCredential | null {
  if (!fragment || fragment === '#') return null;
  if (fragment.length > 128 || !fragment.startsWith('#') || /[%+\s]/.test(fragment)) invalid();
  const params = new URLSearchParams(fragment.slice(1)), keys = [...params.keys()];
  if (keys.length !== 2 || !keys.includes('snapshot') || keys.filter(key => key === 'read' || key === 'revoke').length !== 1) invalid();
  const id = params.get('snapshot')!, kind = params.has('read') ? 'read' : 'revoke', token = params.get(kind)!;
  identity(id, token); return { id, kind, token };
}
async function send(path: string, method: 'GET' | 'POST', signal?: AbortSignal, token?: string, body?: string, setupKey?: string): Promise<Response> {
  abort(signal);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (setupKey) headers['X-Motion-Setup-Key'] = setupKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try { return await fetch(path, { method, headers, body, signal, cache: 'no-store', credentials: 'omit', redirect: 'error' }); }
  catch (error) { if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error; throw new PrivateApiError('connection', 'Could not confirm the private request. A publication or revocation may have arrived; no command is replayed. Keep your project and links.'); }
}
async function readBytes(response: Response, maximum: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  abort(signal);
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get('Content-Type') || '')) invalid();
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > maximum)) invalid();
  const reader = response.body?.getReader(); if (!reader) invalid();
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      abort(signal); const part = await reader.read(); abort(signal); if (part.done) break;
      size += part.value.byteLength; if (size > maximum) { await reader.cancel(); invalid(); }
      chunks.push(part.value.slice());
    }
    if (!size || length !== null && Number(length) !== size) invalid();
    const output = new Uint8Array(size); let at = 0; for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
    return output;
  } catch (error) { if (signal?.aborted) abort(signal); if (error instanceof PrivateApiError) throw error; return invalid(); }
  finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}
function parse(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const stack: ({ keys: Set<string>; expectsKey: boolean } | null)[] = []; let containers = 0;
    for (let i = 0; i < text.length;) {
      const c = text[i];
      if (c === '{' || c === '[') { stack.push(c === '{' ? { keys: new Set(), expectsKey: true } : null); if (stack.length > 32 || ++containers > 20000) invalid(); i++; }
      else if (c === '}' || c === ']') { stack.pop(); i++; }
      else if (c === ',') { const top = stack.at(-1); if (top) top.expectsKey = true; i++; }
      else if (c === '"') {
        const start = i++; while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
        if (i >= text.length) invalid(); i++;
        const top = stack.at(-1); if (top?.expectsKey) { const key = JSON.parse(text.slice(start, i)) as string; if (top.keys.has(key)) invalid(); top.keys.add(key); top.expectsKey = false; }
      } else i++;
    }
    return JSON.parse(text) as unknown;
  } catch { return invalid(); }
}
async function control(response: Response, signal?: AbortSignal): Promise<unknown> {
  const value = parse(await readBytes(response, 8192, signal));
  if (!response.ok) {
    const data = object(value, 'error,code');
    if (typeof data.error !== 'string' || typeof data.code !== 'string') invalid();
    const messages: Record<string, string> = {
      capacity: 'The service holds eight publications. Revoke one before another deliberate publication.',
      'not-found': 'This private link is unavailable or no longer authorized. Check the original link.',
      forbidden: 'This request is not authorized. Check the service address and re-enter the operator setup key for publishing. That key cannot view or revoke snapshots.',
      invalid: 'The request or project was not admitted. Keep your project and check the current controls or original link before another deliberate attempt.',
      busy: 'The service is busy admitting another publication. Keep your project and make a fresh deliberate attempt later.',
      cancelled: 'The private request was cancelled. It may have arrived; keep your project and links. No command is replayed.',
      timeout: 'The private request timed out. It may have arrived; keep your project and links. No command is replayed.',
      storage: 'The service could not confirm its saved state. Keep your project and links; ask the operator to inspect the library before retrying.',
      unavailable: 'The sharing service is unavailable. Keep your project and links and check the service. Local editing remains available.',
      durability: 'The publication or revocation may be complete, but durability was not confirmed. Keep your project and links and ask the operator to inspect the library; no command is replayed.',
    };
    const code = Object.hasOwn(messages, data.code) ? data.code : 'service';
    const message = messages[code] ?? 'The private request was not confirmed. Keep your project and links; no command is replayed.';
    throw new PrivateApiError(code, message);
  }
  return value;
}
export async function getPrivateStatus(signal?: AbortSignal): Promise<PrivateStatus> {
  const value = object(await control(await send('/api/status', 'GET', signal), signal), 'schemaVersion,transport,maxPublications,maxProjectBytes');
  const transport = object(value.transport, 'mode,origin,setupRequired');
  if (value.schemaVersion !== 1 || value.maxPublications !== 8 || value.maxProjectBytes !== MAX_JSON_BYTES || transport.setupRequired !== true || typeof transport.origin !== 'string' || transport.origin.length > 267) invalid();
  try {
    const origin = new URL(transport.origin);
    if (origin.origin !== transport.origin || (typeof location !== 'undefined' && location.origin !== transport.origin)) invalid();
    if (transport.mode === 'https-lan' ? origin.protocol !== 'https:'
      : transport.mode !== 'http-loopback' || !/^http:\/\/127\.0\.0\.1(?::[1-9]\d{0,4})?$/.test(transport.origin) || Number(origin.port || 80) > 65535) invalid();
  } catch { invalid(); }
  return value as unknown as PrivateStatus;
}
/** Bound the entire mutating exchange, including streamed response and hash checks.
 * The child signal expires without altering the UI caller's ownership signal. */
async function boundedCommand<T>(signal: AbortSignal | undefined, work: (owned: AbortSignal) => Promise<T>): Promise<T> {
  abort(signal);
  const controller = new AbortController(), deadline = performance.now()+80000;
  let expired = false, rejectStop: (error: Error) => void = () => {};
  const stopped = new Promise<never>((_resolve,reject)=> { rejectStop = reject; });
  const uncertain = () => new PrivateApiError('timeout','The private command timed out and may have arrived. Keep your project and links, and ask the operator to inspect the library before another deliberate attempt. No command is replayed.');
  const cancel = () => { controller.abort(); rejectStop(new DOMException('Private request cancelled.','AbortError')); };
  signal?.addEventListener('abort',cancel,{once:true});
  const timer = setTimeout(()=> { expired = true; controller.abort(); rejectStop(uncertain()); },80000);
  try {
    const result = await Promise.race([work(controller.signal),stopped]);
    if (expired || performance.now() >= deadline) { expired = true; controller.abort(); throw uncertain(); }
    abort(signal); return result;
  } catch (error) { if (expired) throw uncertain(); abort(signal); throw error; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',cancel); }
}
export async function publishSnapshot(project: Project, setupKey: string, signal?: AbortSignal): Promise<Publication> {
  if (typeof setupKey !== 'string' || !TOKEN.test(setupKey)) invalid();
  let json: string; try { json = JSON.stringify(validateProject(project)); } catch { invalid(); }
  const captured = new TextEncoder().encode(json);
  if (captured.length > MAX_JSON_BYTES) invalid();
  return await boundedCommand(signal,async owned => {
  const response = await send('/api/snapshots', 'POST', owned, undefined, json, setupKey);
  const value = object(await control(response, owned), 'id,createdAt,projectSha256,projectBytes,readToken,revokeToken');
  identity(value.id as string, value.readToken as string); identity(value.id as string, value.revokeToken as string);
  if (response.status !== 201 || value.readToken === value.revokeToken || typeof value.projectSha256 !== 'string' || !TOKEN.test(value.projectSha256)
    || !Number.isSafeInteger(value.projectBytes) || (value.projectBytes as number) < 1 || (value.projectBytes as number) > MAX_JSON_BYTES
    || typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) invalid();
  const digest = await crypto.subtle.digest('SHA-256', captured); abort(owned);
  if (value.projectBytes !== captured.length || Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== value.projectSha256) invalid();
  return value as unknown as Publication;
  });
}
export async function fetchSnapshot(id: string, readToken: string, signal?: AbortSignal): Promise<SnapshotReceipt> {
  identity(id, readToken); const response = await send(`/api/snapshots/${id}`, 'GET', signal, readToken);
  if (!response.ok) { await control(response, signal); invalid(); }
  const sha256 = response.headers.get('X-Project-SHA256'), length = response.headers.get('Content-Length');
  if (!sha256 || !TOKEN.test(sha256) || !length || !/^[1-9]\d*$/.test(length) || Number(length) > MAX_JSON_BYTES) invalid();
  const json = await readBytes(response, MAX_JSON_BYTES, signal);
  const digest = await crypto.subtle.digest('SHA-256', json); abort(signal);
  if (Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') !== sha256) invalid();
  let project: Project; try { project = validateProject(parse(json)); } catch { invalid(); }
  return { project, json, sha256 };
}
export async function revokeSnapshot(id: string, revokeToken: string, signal?: AbortSignal): Promise<void> {
  identity(id, revokeToken);
  await boundedCommand(signal,async owned => {
  const value = object(await control(await send(`/api/snapshots/${id}/revoke`, 'POST', owned, revokeToken), owned), 'revoked');
  if (value.revoked !== true) invalid();
  });
}
