import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, request } from '../src/api.ts';

const setup = 'b'.repeat(64), token = 'a'.repeat(64), id = '1'.repeat(32);
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
function response(): Response { return new Response('{"schemaVersion":1}', { headers: { 'Content-Type': 'application/json' } }); }

test('creation sends setup authority only in its dedicated header with unchanged request bounds', async () => {
  const controller = new AbortController(), payload = { name: 'Proposer', terms: { title: 'Literal agreement' } };
  let calls = 0;
  globalThis.fetch = async (path, options) => {
    calls++;
    assert.equal(path, '/api/challenges');
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('X-Friendly-Setup-Key'), setup);
    assert.equal(headers.has('Authorization'), false);
    assert.equal(options?.body, JSON.stringify(payload));
    assert.ok(options?.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
    assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); assert.equal(options?.cache, 'no-store');
    assert.ok(!String(options?.body).includes(setup));
    return response();
  };
  await request('POST', '/api/challenges', payload, undefined, controller.signal, setup);
  assert.equal(calls, 1);
});

test('setup authority rejects every noncreation destination and seat-token combination before fetch', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(); };
  for (const [method, path, seat] of [
    ['GET', '/api/status', undefined], ['POST', `/api/challenges/${id}/join`, undefined],
    ['POST', `/api/challenges/${id}/accept`, token], ['POST', '/api/challenges', token],
    ['POST', `/api/challenges/${id}/arbiter/join`, undefined], ['GET', `/api/challenges/${id}/export`, token],
  ] as const) await assert.rejects(request(method, path, undefined, seat, undefined, setup), ApiError);
  assert.equal(calls, 0);
});

test('invalid setup syntax and oversized creation fail locally without reflecting private values', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(); };
  for (const key of ['', setup.toUpperCase(), setup + '\n', setup.slice(1), 'g'.repeat(64)]) {
    await assert.rejects(request('POST', '/api/challenges', {}, undefined, undefined, key), error =>
      error instanceof ApiError && error.code === 'invalid_request' && (!key || !error.message.includes(key)));
  }
  await assert.rejects(request('POST', '/api/challenges', { text: 'x'.repeat(16384) }, undefined, undefined, setup), ApiError);
  assert.equal(calls, 0);
});

test('legacy creation and all subsequent requests never inherit a previously used setup key', async () => {
  const headers: Headers[] = [];
  globalThis.fetch = async (_path, options) => { headers.push(new Headers(options?.headers)); return response(); };
  await request('POST', '/api/challenges', {}, undefined, undefined, setup);
  await request('POST', '/api/challenges', {});
  await request('GET', '/api/status');
  await request('POST', `/api/challenges/${id}/join`, {});
  await request('GET', `/api/challenges/${id}`, undefined, token);
  assert.equal(headers[0]!.get('X-Friendly-Setup-Key'), setup);
  assert.ok(headers.slice(1).every(value => !value.has('X-Friendly-Setup-Key')));
  assert.equal(headers.at(-1)!.get('Authorization'), `Bearer ${token}`);
});

test('lost creation response is one attempt and never retries or exposes setup authority', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError(setup); };
  await assert.rejects(request('POST', '/api/challenges', {}, undefined, undefined, setup), error =>
    error instanceof ApiError && error.status === 0 && !error.message.includes(setup));
  assert.equal(calls, 1);
});
