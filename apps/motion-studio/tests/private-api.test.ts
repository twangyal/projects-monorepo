import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, webcrypto } from 'node:crypto';
import { createProject, MAX_JSON_BYTES } from '../src/model.ts';
import { fetchSnapshot, getPrivateStatus, parsePrivateFragment, PrivateApiError, publishSnapshot, revokeSnapshot } from '../src/private-api.ts';
const id = '12345678-1234-4123-8123-123456789abc', read = 'a'.repeat(64), revoke = 'b'.repeat(64), setup = 'c'.repeat(64);
const originalFetch = globalThis.fetch;
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
test.afterEach(() => { globalThis.fetch = originalFetch; });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const bytes = new TextEncoder().encode(JSON.stringify(createProject()));
const hash = createHash('sha256').update(bytes).digest('hex');
function projectResponse(body: BodyInit = bytes): Response { return new Response(body, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(bytes.length), 'X-Project-SHA256': hash } }); }

test('private fragments require exactly one canonical snapshot and one separate authority', () => {
  assert.equal(parsePrivateFragment(''), null);
  assert.deepEqual(parsePrivateFragment(`#snapshot=${id}&read=${read}`), { id, kind: 'read', token: read });
  assert.deepEqual(parsePrivateFragment(`#revoke=${revoke}&snapshot=${id}`), { id, kind: 'revoke', token: revoke });
  for (const fragment of [`#snapshot=${id}&read=${read}&revoke=${revoke}`, `#snapshot=${id}&read=${read}&read=${read}`, `#snapshot=${id}&read=${read}&unknown=1`, `#snapshot=${id}`, '#snapshot=bad&read='+read, '#snapshot='+id+'&read='+read+'%0a']) {
    assert.throws(() => parsePrivateFragment(fragment), error => error instanceof PrivateApiError && !error.message.includes(read));
  }
});

test('static service status is bounded and admits only the exact frozen transport envelope', async () => {
  const value = { schemaVersion: 1, transport: { mode: 'http-loopback', origin: 'http://127.0.0.1:8770', setupRequired: true }, maxPublications: 8, maxProjectBytes: MAX_JSON_BYTES };
  globalThis.fetch = async (path, options) => { assert.equal(path, '/api/status'); assert.equal(options?.credentials, 'omit'); assert.equal(new Headers(options?.headers).has('Authorization'), false); return json(value); };
  assert.deepEqual(await getPrivateStatus(), value);
  globalThis.fetch = async () => json({ ...value, transport: { ...value.transport, setupRequired: false } });
  await assert.rejects(getPrivateStatus(), PrivateApiError);
});

test('publish detaches committed JSON at invocation and sends setup only on one creation request', async () => {
  const project = createProject(); let calls = 0;
  globalThis.fetch = async (path, options) => {
    calls++; assert.equal(path, '/api/snapshots'); assert.equal(options?.method, 'POST');
    assert.equal(new Headers(options?.headers).get('X-Motion-Setup-Key'), setup);
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    assert.deepEqual(JSON.parse(String(options?.body)), project); assert.equal(options?.redirect, 'error');
    return json({ id, createdAt: '2026-10-04T00:00:00.000Z', projectSha256: createHash('sha256').update(String(options?.body)).digest('hex'), projectBytes: new TextEncoder().encode(String(options?.body)).length, readToken: read, revokeToken: revoke }, 201);
  };
  assert.equal((await publishSnapshot(project, setup)).id, id); assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; throw new Error(); };
  await assert.rejects(publishSnapshot(project, setup), PrivateApiError); assert.equal(calls, 2);
});

test('fetch verifies exact streamed bytes and authenticated descriptor without tokens in URLs', async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, `/api/snapshots/${id}`); assert.equal(options?.method, 'GET');
    assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${read}`);
    assert.equal(new Headers(options?.headers).has('X-Motion-Setup-Key'), false); return projectResponse();
  };
  const receipt = await fetchSnapshot(id, read);
  assert.deepEqual(receipt.project, JSON.parse(new TextDecoder().decode(bytes))); assert.deepEqual(receipt.json, bytes); assert.equal(receipt.sha256, hash);
  for (const response of [projectResponse(bytes.slice(1)), new Response(bytes, { headers: { 'Content-Type': 'application/json', 'Content-Length': String(bytes.length), 'X-Project-SHA256': 'd'.repeat(64) } }), new Response(bytes, { headers: { 'Content-Type': 'application/json' } })]) {
    globalThis.fetch = async () => response; await assert.rejects(fetchSnapshot(id, read), PrivateApiError);
  }
});

test('revoke uses separate Bearer authority and an empty body with no automatic command retry', async () => {
  let calls = 0;
  globalThis.fetch = async (path, options) => { calls++; assert.equal(path, `/api/snapshots/${id}/revoke`); assert.equal(options?.method, 'POST'); assert.equal(options?.body, undefined); assert.equal(new Headers(options?.headers).get('Authorization'), `Bearer ${revoke}`); assert.equal(new Headers(options?.headers).has('X-Motion-Setup-Key'), false); return json({ revoked: true }); };
  await revokeSnapshot(id, revoke); assert.equal(calls, 1);
});

test('invalid identities, private syntax, body limits and malformed responses fail closed', async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return json({}); };
  await assert.rejects(fetchSnapshot('../outside', read), PrivateApiError);
  await assert.rejects(revokeSnapshot(id, read+'\n'), PrivateApiError);
  await assert.rejects(publishSnapshot(createProject(), setup.toUpperCase()), PrivateApiError); assert.equal(calls, 0);
  for (const body of ['{"schemaVersion":1,"schemaVersion":1}', '['.repeat(33)+'0'+']'.repeat(33), '<html>offline</html>', '"'+ 'x'.repeat(8192)+'"']) {
    globalThis.fetch = async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }); await assert.rejects(getPrivateStatus(), PrivateApiError);
  }
  const controller = new AbortController(), abort = new DOMException('Cancelled', 'AbortError'); controller.abort();
  globalThis.fetch = async () => { throw abort; };
  await assert.rejects(fetchSnapshot(id, read, controller.signal), error => (error as Error).name === 'AbortError');
});

test('publication replies must identify the exact captured canonical body', async () => {
  globalThis.fetch = async () => json({ id, createdAt: '2026-10-04T00:00:00.000Z', projectSha256: 'd'.repeat(64), projectBytes: 1, readToken: read, revokeToken: revoke },201);
  await assert.rejects(publishSnapshot(createProject(),setup),PrivateApiError);
});

test('actual Motion capacity refusal gives explicit revoke-one recovery without reflected private data', async () => {
  globalThis.fetch = async () => json({ error: setup, code: 'capacity' },409);
  await assert.rejects(publishSnapshot(createProject(),setup),error=>error instanceof PrivateApiError && error.code === 'capacity' && /revoke one/i.test(error.message) && !error.message.includes(setup));
});

test('actual Motion not-found viewing response gives the same unavailable-link guidance', async () => {
  globalThis.fetch = async () => json({ error: read, code: 'not-found' },404);
  await assert.rejects(fetchSnapshot(id,read),error=>error instanceof PrivateApiError && error.code === 'not-found' && /private link.*unavailable/i.test(error.message) && !error.message.includes(read));
});

test('actual Motion forbidden creation response directs deliberate setup re-entry', async () => {
  globalThis.fetch = async () => json({ error: setup, code: 'forbidden' },403);
  await assert.rejects(publishSnapshot(createProject(),setup),error=>error instanceof PrivateApiError && error.code === 'forbidden' && /setup key/i.test(error.message) && !error.message.includes(setup));
});

test('all remaining Motion wire codes retain identity with bounded fixed recovery messages', async () => {
  for (const code of ['invalid','busy','cancelled','timeout','storage','unavailable','durability']) {
    globalThis.fetch = async () => json({ error: read, code },503);
    await assert.rejects(getPrivateStatus(),error=>error instanceof PrivateApiError && error.code === code && error.message.length < 500 && !error.message.includes(read));
  }
});

test('canonical HTTP port eighty is omitted and both transport modes match the actual page origin', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis,'location');
  const status = (origin: string, mode = 'http-loopback') => ({schemaVersion:1,transport:{mode,origin,setupRequired:true},maxPublications:8,maxProjectBytes:MAX_JSON_BYTES});
  try {
    Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'http://127.0.0.1'}});
    globalThis.fetch = async () => json(status('http://127.0.0.1'));
    assert.equal((await getPrivateStatus()).transport.origin,'http://127.0.0.1');
    for (const origin of ['http://127.0.0.1:80','http://127.0.0.1:8770','http://127.0.0.1:0','http://127.0.0.1:65536','http://127.0.0.1:08770','http://127.1','http://localhost']) {
      globalThis.fetch = async () => json(status(origin)); await assert.rejects(getPrivateStatus(),PrivateApiError);
    }
    Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://motion.example:9443'}});
    globalThis.fetch = async () => json(status('https://motion.example:9443','https-lan')); assert.equal((await getPrivateStatus()).transport.mode,'https-lan');
    globalThis.fetch = async () => json(status('https://other.example:9443','https-lan')); await assert.rejects(getPrivateStatus(),PrivateApiError);
  } finally { if(previous) Object.defineProperty(globalThis,'location',previous); else Reflect.deleteProperty(globalThis,'location'); }
});

test('publication completion has an eighty-second aggregate deadline without expiring the caller owner', async context => {
  context.mock.timers.enable({apis:['setTimeout']}); let calls = 0, sentSignal: AbortSignal | undefined, failure: unknown;
  const caller = new AbortController();
  globalThis.fetch = (_path,options) => { calls++; sentSignal = options?.signal ?? undefined; return new Promise<Response>(()=>{}); };
  void publishSnapshot(createProject(),setup,caller.signal).catch(error=> {failure=error;});
  context.mock.timers.tick(80000); await new Promise<void>(resolve=>setImmediate(resolve));
  assert.ok(failure instanceof PrivateApiError && failure.code === 'timeout' && /may have arrived|may be complete/i.test(failure.message));
  assert.equal(caller.signal.aborted,false); assert.equal(sentSignal?.aborted,true); assert.equal(calls,1);
});

test('revocation deadline includes stalled response body and never retries after expiry', async context => {
  context.mock.timers.enable({apis:['setTimeout']}); let calls = 0, cancelled = false, failure: unknown;
  globalThis.fetch = async () => { calls++; return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}}); };
  void revokeSnapshot(id,revoke).catch(error=> {failure=error;});
  await new Promise<void>(resolve=>setImmediate(resolve)); context.mock.timers.tick(80000); await new Promise<void>(resolve=>setImmediate(resolve));
  assert.ok(failure instanceof PrivateApiError && failure.code === 'timeout'); assert.equal(cancelled,true); assert.equal(calls,1);
});
