import { ERROR_CODES, TOKEN_PATTERN, type ErrorCode } from './types.ts';

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
