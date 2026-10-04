import { ERROR_CODES, ID_PATTERN, TOKEN_PATTERN, type ErrorCode, type Snapshot } from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  constructor(message: string, status: number, code: ErrorCode) {
    super(message);
    this.name = 'ApiError'; this.status = status; this.code = code;
  }
}

const MAX_REQUEST = 16 * 1024;
const MAX_RESPONSE = 1024 * 1024;
const PATH = /^\/api\/(?:status|challenges(?:\/[0-9a-f]{32}(?:\/(?:join|terms|invite|accept|decline|withdraw|evidence|result(?:\/respond)?|void(?:\/confirm)?|arbiter\/(?:join|nominate|respond|withdraw|decide)|export))?)?)$(?![\s\S])/;

function invalidRequest(): ApiError {
  return new ApiError('The local challenge request is invalid. Use the current challenge controls and a valid private seat.', 400, 'invalid_request');
}

function invalidResponse(status: number): ApiError {
  return new ApiError('The local service returned an invalid response. Keep your draft and refresh the challenge before trying again.', status, 'internal_error');
}

function aborted(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'name' in error && error.name === 'AbortError';
}

function validText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 127) return false;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

/** JSON.parse validates grammar; this scan rejects duplicate decoded keys/depth. */
function uniqueKeys(text: string): void {
  const stack: ({ keys: Set<string>; expectsKey: boolean } | null)[] = [];
  for (let i = 0; i < text.length;) {
    const token = text[i];
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? { keys: new Set(), expectsKey: true } : null);
      if (stack.length > 32) throw new Error();
      i++;
    } else if (token === '}' || token === ']') { stack.pop(); i++; }
    else if (token === ',') {
      const frame = stack.at(-1);
      if (frame) frame.expectsKey = true;
      i++;
    } else if (token === '"') {
      const start = i++;
      while (text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      const frame = stack.at(-1);
      if (frame?.expectsKey) {
        const key = JSON.parse(text.slice(start, i)) as string;
        if (frame.keys.has(key)) throw new Error();
        frame.keys.add(key); frame.expectsKey = false;
      }
    } else i++;
  }
}

function validateValues(value: unknown): void {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) throw new Error();
  if (typeof value === 'string' && !validText(value)) throw new Error();
  if (Array.isArray(value)) value.forEach(validateValues);
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (!validText(key)) throw new Error();
      validateValues(child);
    }
  }
}

async function readJSON(response: Response): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) throw new Error();
  const reader = response.body?.getReader();
  if (!reader) throw new Error();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let text = '', bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE) { await reader.cancel(); throw new Error(); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const value: unknown = JSON.parse(text);
  uniqueKeys(text); validateValues(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}

/** Single attempt only: consent commands are never replayed after a failure. */
export async function request<T>(method: string, path: string, body?: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  if (!['GET', 'POST'].includes(method) || typeof path !== 'string' || !PATH.test(path)
      || (token !== undefined && (typeof token !== 'string' || !TOKEN_PATTERN.test(token)))
      || (method === 'GET' && body !== undefined)) throw invalidRequest();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  let serialized: string | undefined;
  if (body !== undefined) {
    try { serialized = JSON.stringify(body); } catch { throw invalidRequest(); }
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_REQUEST) throw invalidRequest();
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: serialized, signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  } catch (error) {
    if (aborted(error)) throw error;
    throw new ApiError('Could not connect to the local Friendly Challenges service. Keep your draft and try again.', 0, 'internal_error');
  }
  let parsed: Record<string, unknown>;
  try { parsed = await readJSON(response); }
  catch (error) { if (aborted(error)) throw error; throw invalidResponse(response.status); }
  const envelope = Object.hasOwn(parsed, 'error') || Object.hasOwn(parsed, 'code');
  if (!response.ok || envelope) {
    if (response.ok || Object.keys(parsed).length !== 2 || typeof parsed.error !== 'string'
      || !parsed.error.trim() || /[0-9a-f]{64}/.test(parsed.error)
      || typeof parsed.code !== 'string' || !ERROR_CODES.includes(parsed.code as ErrorCode)) throw invalidResponse(response.status);
    let message = parsed.error.trim().slice(0, 500);
    if (/[\ud800-\udbff]$/.test(message)) message = message.slice(0, -1);
    throw new ApiError(message, response.status, parsed.code as ErrorCode);
  }
  return parsed as T;
}

export interface ImageEvidencePayload { revision: number; text: string; url: string | null }
export interface EvidenceImageDescriptor { mime: 'image/jpeg'; bytes: number; width: number; height: number; sha256: string }

function checkBinaryAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image request cancelled.', 'AbortError');
}
function binaryIdentity(id: string, token: string): void {
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw invalidRequest();
}
function exactData(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidRequest();
  const prototype = Object.getPrototypeOf(input), descriptors = Object.getOwnPropertyDescriptors(input);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(input).length !== keys.length
    || keys.some(key => !descriptors[key] || !('value' in descriptors[key]) || !descriptors[key].enumerable)) throw invalidRequest();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value as unknown]));
}
async function binaryFetch(path: string, token: string, accept: string, body?: Blob, signal?: AbortSignal): Promise<Response> {
  checkBinaryAbort(signal);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: accept };
  if (body) headers['Content-Type'] = 'application/octet-stream';
  try { return await fetch(path, { method: body ? 'POST' : 'GET', headers, body, signal, cache: 'no-store', credentials: 'omit', redirect: 'error' }); }
  catch (error) {
    if (aborted(error)) throw error;
    throw new ApiError('Could not confirm the local image request. Keep your draft and review the record before trying again.', 0, 'internal_error');
  }
}
async function checkedBinaryJSON(response: Response): Promise<Record<string, unknown>> {
  let parsed: Record<string, unknown>;
  try { parsed = await readJSON(response); }
  catch (error) { if (aborted(error)) throw error; throw invalidResponse(response.status); }
  const envelope = Object.hasOwn(parsed, 'error') || Object.hasOwn(parsed, 'code');
  if (!response.ok || envelope) {
    if (response.ok || Object.keys(parsed).length !== 2 || typeof parsed.error !== 'string'
      || !parsed.error.trim() || /[0-9a-f]{64}/.test(parsed.error)
      || typeof parsed.code !== 'string' || !ERROR_CODES.includes(parsed.code as ErrorCode)) throw invalidResponse(response.status);
    let message = parsed.error.trim().slice(0, 500);
    if (/[\ud800-\udbff]$/.test(message)) message = message.slice(0, -1);
    throw new ApiError(message, response.status, parsed.code as ErrorCode);
  }
  return parsed;
}
async function readBinary(response: Response, mime: string, maximum: number, signal?: AbortSignal): Promise<Blob> {
  checkBinaryAbort(signal);
  if (!response.ok) { await checkedBinaryJSON(response); throw invalidResponse(response.status); }
  const contentType = response.headers.get('Content-Type')?.toLowerCase() || '';
  if ((mime === 'image/jpeg' ? contentType !== mime : !/^text\/html(?:\s*;\s*charset=utf-8)?$/.test(contentType))) throw invalidResponse(response.status);
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^(?:0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length)) || Number(length) > maximum)) throw invalidResponse(response.status);
  const reader = response.body?.getReader(); if (!reader) throw invalidResponse(response.status);
  const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  const cancel = (): void => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      checkBinaryAbort(signal);
      const chunk = await reader.read(); checkBinaryAbort(signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw invalidResponse(response.status); }
      chunks.push(chunk.value.slice());
    }
    if (!size || (length !== null && Number(length) !== size)) throw invalidResponse(response.status);
    return new Blob(chunks, { type: mime });
  } catch (error) { if (aborted(error) || error instanceof ApiError) throw error; throw invalidResponse(response.status); }
  finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** One attempted append only; uncertain delivery must be reviewed, never replayed. */
export async function postImageEvidence(id: string, token: string, payload: ImageEvidencePayload, jpeg: Blob, signal?: AbortSignal): Promise<Snapshot> {
  checkBinaryAbort(signal); binaryIdentity(id, token);
  const input = exactData(payload, ['revision', 'text', 'url']);
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 1 || typeof input.text !== 'string'
    || input.text.length > 2000 || !input.text.trim() || !validText(input.text) || [...input.text].length > 1000
    || (input.url !== null && (typeof input.url !== 'string' || input.url.length > 2048 || !input.url.trim() || !validText(input.url) || [...input.url].length > 1024))
    || !(jpeg instanceof Blob) || jpeg.type !== 'image/jpeg' || jpeg.size < 1 || jpeg.size > 524288) throw invalidRequest();
  const metadata = new TextEncoder().encode(JSON.stringify(input)); if (metadata.length > MAX_REQUEST) throw invalidRequest();
  const header = new Uint8Array(16), view = new DataView(header.buffer);
  header.set(new TextEncoder().encode('FCEVID01')); view.setUint32(8, metadata.length, true); view.setUint32(12, jpeg.size, true);
  const body = new Blob([header, metadata, jpeg], { type: 'application/octet-stream' });
  const response = await binaryFetch(`/api/challenges/${id}/evidence/image`, token, 'application/json', body, signal);
  const result = await checkedBinaryJSON(response); checkBinaryAbort(signal); return result as unknown as Snapshot;
}

/** Descriptor belongs to the authenticated snapshot; no unverified bytes are returned. */
export async function fetchEvidenceImage(id: string, evidenceId: string, token: string, descriptor: EvidenceImageDescriptor, signal?: AbortSignal): Promise<Blob> {
  checkBinaryAbort(signal); binaryIdentity(id, token);
  if (typeof evidenceId !== 'string' || !ID_PATTERN.test(evidenceId)) throw invalidRequest();
  const captured = exactData(descriptor, ['mime', 'bytes', 'width', 'height', 'sha256']);
  if (captured.mime !== 'image/jpeg' || !Number.isInteger(captured.bytes) || (captured.bytes as number) < 1 || (captured.bytes as number) > 524288
    || !Number.isInteger(captured.width) || (captured.width as number) < 1 || (captured.width as number) > 1024
    || !Number.isInteger(captured.height) || (captured.height as number) < 1 || (captured.height as number) > 1024
    || typeof captured.sha256 !== 'string' || !TOKEN_PATTERN.test(captured.sha256)) throw invalidRequest();
  const response = await binaryFetch(`/api/challenges/${id}/evidence/${evidenceId}/image`, token, 'image/jpeg', undefined, signal);
  const blob = await readBinary(response, 'image/jpeg', captured.bytes as number, signal);
  if (blob.size !== captured.bytes) throw invalidResponse(response.status);
  const bytes = await blob.arrayBuffer(); checkBinaryAbort(signal);
  const hash = await crypto.subtle.digest('SHA-256', bytes); checkBinaryAbort(signal);
  const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hex !== captured.sha256) throw invalidResponse(response.status);
  return blob;
}
export async function fetchImageExport(id: string, token: string, signal?: AbortSignal): Promise<Blob> {
  checkBinaryAbort(signal); binaryIdentity(id, token);
  const response = await binaryFetch(`/api/challenges/${id}/export/images`, token, 'text/html', undefined, signal);
  return readBinary(response, 'text/html', 12 * 1024 * 1024, signal);
}
