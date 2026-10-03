import assert from 'node:assert/strict';
import test from 'node:test';
import { readLink, loadSessions, saveSession, removeSession } from '../src/session.ts';

const KEY = 'friendly-challenges.sessions.v1';
const TOKEN = 'a'.repeat(64), OTHER = 'b'.repeat(64);
const id = (value = 1) => value.toString(16).padStart(32, '0');

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  failRead = false;
  failWrite = false;
  get length(): number { return this.values.size; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key: string): string | null {
    if (this.failRead) throw new DOMException('Unavailable', 'SecurityError');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new DOMException('Full', 'QuotaExceededError');
    this.values.set(key, String(value));
  }
  removeItem(key: string): void {
    if (this.failWrite) throw new DOMException('Unavailable', 'SecurityError');
    this.values.delete(key);
  }
  clear(): void { this.values.clear(); }
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let storage: MemoryStorage;
test.beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
});
test.afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('exact opponent, arbiter and private-access fragments parse without claiming or persisting a seat', () => {
  for (const kind of ['invite', 'arbiter', 'access'] as const) {
    const location = { search: `?challenge=${id()}`, hash: `#${kind}=${TOKEN}` };
    const parsed = readLink(location);
    assert.equal(parsed?.challengeId, id()); assert.equal(parsed?.kind, kind);
    assert.ok(parsed?.token === TOKEN);
    assert.ok(location.hash === `#${kind}=${TOKEN}`, 'UI owns immediate fragment removal');
  }
  assert.equal(storage.length, 0);
});

test('links reject duplicates, extras, encodings and malformed capability syntax as a whole', () => {
  const valid = { search: `?challenge=${id()}`, hash: `#access=${TOKEN}` };
  const cases = [
    { ...valid, search: '' }, { ...valid, hash: '' },
    { ...valid, search: `${valid.search}&challenge=${id(2)}` },
    { ...valid, search: `${valid.search}&extra=x` },
    { ...valid, search: `?token=${TOKEN}&challenge=${id()}` },
    { ...valid, search: `?challenge=%30${id().slice(1)}` },
    { ...valid, search: `${valid.search}\n` },
    { ...valid, search: `?challenge=${'A'.repeat(32)}` },
    { ...valid, hash: `#access=${TOKEN}&invite=${OTHER}` },
    { ...valid, hash: `#access=${TOKEN}&extra=x` },
    { ...valid, hash: `#access=%61${TOKEN.slice(1)}` },
    { ...valid, hash: `#access=${TOKEN}\n` },
    { ...valid, hash: `#access=${TOKEN.slice(1)}` },
    { ...valid, hash: `#access=${TOKEN}0` },
    { ...valid, hash: `#opponent=${TOKEN}` },
    { ...valid, hash: `#access=${TOKEN.toUpperCase()}` },
  ];
  for (const location of cases) assert.equal(readLink(location), null);
  assert.equal(storage.length, 0);
});

test('private recovery credentials stay in the fragment rather than query parameters', () => {
  const recovery = new URL(`http://127.0.0.1:8767/?challenge=${id()}#access=${TOKEN}`);
  assert.ok(!recovery.search.includes(TOKEN));
  assert.ok(!new URL(recovery.pathname + recovery.search, recovery.origin).href.includes(TOKEN));
  assert.ok(readLink(recovery)?.token === TOKEN);
});

test('absent sessions load as an independent empty map without a storage write', () => {
  assert.deepEqual(loadSessions(), {});
  assert.equal(storage.getItem(KEY), null);
});

test('saving and removing preserve other challenge memberships and return detached maps', () => {
  saveSession(id(), TOKEN); saveSession(id(2), OTHER);
  const loaded = loadSessions(); loaded[id()] = OTHER; delete loaded[id(2)];
  assert.ok(loadSessions()[id()] === TOKEN); assert.ok(loadSessions()[id(2)] === OTHER);
  saveSession(id(), OTHER); // Only explicit UI intent may call replacement.
  assert.equal(Object.keys(loadSessions()).length, 2);
  removeSession(id());
  assert.deepEqual(Object.keys(loadSessions()), [id(2)]);
  assert.ok(loadSessions()[id(2)] === OTHER);
});

test('the twenty-seat map rejects a new membership without evicting or blocking replacement', () => {
  for (let n = 1; n <= 20; n++) saveSession(id(n), TOKEN);
  const before = storage.getItem(KEY);
  assert.throws(() => saveSession(id(21), OTHER), /twenty|20|limit/i);
  assert.equal(storage.getItem(KEY), before);
  saveSession(id(1), OTHER);
  assert.equal(Object.keys(loadSessions()).length, 20);
  assert.ok(loadSessions()[id(1)] === OTHER);
});

test('invalid IDs and capabilities never change stored membership or expose supplied values', () => {
  saveSession(id(), TOKEN);
  const before = storage.getItem(KEY);
  for (const [challengeId, token] of [[id() + '\n', TOKEN], ['A'.repeat(32), TOKEN], [id(), TOKEN + '\n'], [id(), 'x'.repeat(64)]]) {
    assert.throws(() => saveSession(challengeId, token), error => error instanceof Error && /valid|capability|challenge/i.test(error.message) && !error.message.includes(token));
    assert.equal(storage.getItem(KEY), before);
  }
  assert.throws(() => removeSession('invalid'), /valid|challenge/i);
  assert.equal(storage.getItem(KEY), before);
});

test('malformed, oversized and duplicate-key stored maps surface corruption and stay unchanged', () => {
  const escapedId = '\\u0030' + id().slice(1);
  const cases = ['not JSON', 'null', '[]', '42', JSON.stringify({ invalid: TOKEN }),
    JSON.stringify({ [id()]: TOKEN + '\n' }),
    JSON.stringify(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [id(i + 1), TOKEN]))),
    `{"${id()}":"${TOKEN}","${escapedId}":"${OTHER}"}`,
    `{"${id()}":null,"${id()}":"${TOKEN}"}`,
    ' '.repeat(17000) + '{}',
  ];
  for (const value of cases) {
    storage.setItem(KEY, value);
    assert.throws(loadSessions, /saved|invalid|corrupt/i);
    assert.throws(() => saveSession(id(2), OTHER), /saved|invalid|corrupt/i);
    assert.throws(() => removeSession(id()), /saved|invalid|corrupt/i);
    assert.ok(storage.getItem(KEY) === value);
  }
});

test('private-context and quota failures provide private-link guidance without hiding persistence failure', () => {
  storage.failRead = true;
  assert.throws(loadSessions, /storage|private|access link/i);
  storage.failRead = false; storage.failWrite = true;
  assert.throws(() => saveSession(id(), TOKEN), /private.*link|keep.*open|memory/i);
  storage.failWrite = false; saveSession(id(), TOKEN); storage.failWrite = true;
  assert.throws(() => removeSession(id()), /private.*link|keep.*open|memory/i);
});

test('failure when reading the browser storage getter is handled without touching a current credential', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
  assert.throws(loadSessions, /storage|private.*link|keep.*open/i);
  assert.throws(() => saveSession(id(), TOKEN), /storage|private.*link|keep.*open/i);
});
