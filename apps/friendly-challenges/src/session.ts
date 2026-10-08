import { ID_PATTERN, TOKEN_PATTERN } from './types.ts';

export interface PrivateLink { challengeId: string; kind: 'invite' | 'arbiter' | 'access'; token: string }

const KEY = 'friendly-challenges.sessions.v1';
const MAX_SESSIONS = 20;
const MAX_MAP_BYTES = 16 * 1024;

function storageError(): Error {
  return new Error('Private challenge browser storage is unavailable. Keep this page open and copy My private access link to recover your current seat. In-memory access can continue, but it was not saved.');
}

function corruptError(): Error {
  return new Error('Saved private challenges are invalid or corrupt. Existing browser data was preserved. Keep this page open and copy My private access link; use a saved private access link to recover a seat.');
}

function browserStorage(): Storage {
  try {
    const storage = globalThis.localStorage;
    if (!storage) throw new Error();
    return storage;
  } catch { throw storageError(); }
}

/** Parsing has no side effects. The UI must remove every fragment immediately. */
export function readLink(location: { search: string; hash: string }): PrivateLink | null {
  if (!location || typeof location.search !== 'string' || typeof location.hash !== 'string') return null;
  const prefix = '?challenge=';
  if (!location.search.startsWith(prefix)) return null;
  const challengeId = location.search.slice(prefix.length);
  if (!ID_PATTERN.test(challengeId)) return null;
  const match = /^#(invite|arbiter|access)=([0-9a-f]{64})$(?![\s\S])/.exec(location.hash);
  if (!match) return null;
  return { challengeId, kind: match[1] as PrivateLink['kind'], token: match[2] };
}

export function loadSessions(): Record<string, string> {
  let raw: string | null;
  try { raw = browserStorage().getItem(KEY); }
  catch { throw storageError(); }
  if (raw === null) return {};
  if (raw.length > MAX_MAP_BYTES || new TextEncoder().encode(raw).byteLength > MAX_MAP_BYTES) throw corruptError();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw corruptError(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw corruptError();
  const entries = Object.entries(parsed);
  if (entries.length > MAX_SESSIONS || entries.some(([id, token]) => !ID_PATTERN.test(id) || typeof token !== 'string' || !TOKEN_PATTERN.test(token))) throw corruptError();
  // A validated map has only string values. Counting all JSON key tokens also
  // detects overwritten duplicates, including escaped spellings/nonstring values.
  const keys = Array.from(raw.matchAll(/"(?:[^"\\]|\\.)*"\s*:/g));
  if (keys.length !== entries.length) throw corruptError();
  return Object.fromEntries(entries) as Record<string, string>;
}

export function saveSession(challengeId: string, token: string): void {
  if (typeof challengeId !== 'string' || !ID_PATTERN.test(challengeId) || typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw new Error('A valid challenge ID and private seat capability are required.');
  }
  const sessions = loadSessions();
  if (!Object.hasOwn(sessions, challengeId) && Object.keys(sessions).length >= MAX_SESSIONS) {
    throw new Error('This browser already has twenty (20) saved challenge seats. Keep this page open and copy My private access link, or forget another saved seat first.');
  }
  sessions[challengeId] = token;
  try { browserStorage().setItem(KEY, JSON.stringify(sessions)); }
  catch { throw storageError(); }
}

export function removeSession(challengeId: string): void {
  if (typeof challengeId !== 'string' || !ID_PATTERN.test(challengeId)) throw new Error('A valid challenge ID is required.');
  const sessions = loadSessions();
  if (!Object.hasOwn(sessions, challengeId)) return;
  delete sessions[challengeId];
  try {
    const storage = browserStorage();
    if (Object.keys(sessions).length) storage.setItem(KEY, JSON.stringify(sessions));
    else storage.removeItem(KEY);
  } catch { throw storageError(); }
}
