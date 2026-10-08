import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ApiError, request } from '../src/api.ts';
import { ERROR_CODES, type ErrorCode, type Snapshot, type ChallengeExport } from '../src/types.ts';

const ID = '1'.repeat(32), TOKEN = 'a'.repeat(64);
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}
function snapshot(): Snapshot {
  const terms = { title: 'A friendly challenge', description: 'Count the completed tasks', successCriteria: 'Complete three tasks', evidenceRule: 'Write what happened', stake: 'bragging-rights' as const, deadline: 2000 };
  return { id: ID, revision: 1, status: 'proposed', termsVersion: 1, terms, acceptedAt: null, createdAt: 1000,
    serverTime: 1000, deadlinePassed: false, myRole: 'proposer', profiles: { proposer: { name: 'Host' }, opponent: null, arbiter: null },
    evidence: [], events: [{ seq: 1, at: 1000, actor: 'proposer', kind: 'created', details: { name: 'Host', terms, termsVersion: 1 } }],
    resultProposal: null, voidProposal: null, arbiterNomination: null, resolution: null,
    limitsUsed: { termsEdits: 0, resultProposals: 0, arbiterNominations: 0, opponentInvites: 1, arbiterInvites: 0 } };
}

test('ApiError preserves actionable message, HTTP status and structured conflict code', () => {
  const error = new ApiError('Review the changed terms before consenting.', 409, 'conflict');
  assert.ok(error instanceof Error); assert.equal(error.name, 'ApiError');
  assert.equal(error.status, 409); assert.equal(error.code, 'conflict');
  assert.equal(error.message, 'Review the changed terms before consenting.');
});

test('commands send exact reviewed revision and proposal identities without credentials in URLs or body', async () => {
  let called = 0;
  const abort = new AbortController();
  const body = { revision: 7, proposalId: '2'.repeat(32), accept: true, reason: '' };
  globalThis.fetch = async (url, options) => {
    called++;
    assert.equal(url, `/api/challenges/${ID}/result/respond`);
    assert.equal(options?.method, 'POST'); assert.equal(options?.body, JSON.stringify(body));
    const headers = new Headers(options?.headers);
    assert.ok(headers.get('Authorization') === `Bearer ${TOKEN}`);
    assert.equal(headers.get('Content-Type'), 'application/json'); assert.equal(headers.get('Accept'), 'application/json');
    assert.equal(options?.cache, 'no-store'); assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal); assert.equal(options.signal.aborted, false);
    assert.ok(!String(url).includes(TOKEN)); assert.ok(!String(options?.body).includes(TOKEN));
    return json(snapshot());
  };
  assert.equal((await request<Snapshot>('POST', `/api/challenges/${ID}/result/respond`, body, TOKEN, abort.signal)).revision, 1);
  assert.equal(called, 1);
});

test('explicit creation and seat claims are unauthenticated JSON requests without automatic stored identity', async () => {
  const paths: string[] = [];
  globalThis.fetch = async (url, options) => {
    paths.push(String(url));
    assert.equal(new Headers(options?.headers).has('Authorization'), false);
    assert.equal(options?.method, 'POST');
    return json({ challengeId: ID, token: TOKEN, challenge: snapshot() });
  };
  await request('POST', '/api/challenges', { name: 'Host', terms: snapshot().terms });
  await request('POST', `/api/challenges/${ID}/join`, { name: 'Opponent', inviteToken: 'b'.repeat(64) });
  await request('POST', `/api/challenges/${ID}/arbiter/join`, { name: 'Arbiter', inviteToken: 'c'.repeat(64) });
  assert.equal(paths.length, 3);
});

test('read and export use bearer headers only and preserve token-free recorded data', async () => {
  const challenge = Object.fromEntries(Object.entries(snapshot()).filter(([key]) => key !== 'myRole' && key !== 'serverTime')) as ChallengeExport['challenge'];
  const exported: ChallengeExport = { schemaVersion: 1, exportedAt: 1000, challenge };
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, 'GET'); assert.equal(options?.body, undefined);
    assert.equal(new Headers(options?.headers).has('Content-Type'), false);
    assert.ok(new Headers(options?.headers).get('Authorization') === `Bearer ${TOKEN}`);
    assert.ok(!String(url).includes(TOKEN));
    return json(String(url).endsWith('/export') ? exported : snapshot());
  };
  assert.equal((await request<Snapshot>('GET', `/api/challenges/${ID}`, undefined, TOKEN)).id, ID);
  const data = await request<ChallengeExport>('GET', `/api/challenges/${ID}/export`, undefined, TOKEN);
  assert.deepEqual(data, exported); assert.ok(!JSON.stringify(data).includes(TOKEN));
});

test('all documented structured server codes survive HTTP errors without a mutation retry', async () => {
  for (const code of ERROR_CODES) {
    let calls = 0;
    const status = code === 'too_large' ? 413 : code === 'timeout' ? 408 : code === 'busy' ? 503 : code === 'unauthorized' ? 401 : 409;
    globalThis.fetch = async () => { calls++; return json({ error: 'A safe service explanation.', code }, status); };
    await assert.rejects(request('POST', `/api/challenges/${ID}/accept`, { revision: 1, termsVersion: 1 }, TOKEN), error =>
      error instanceof ApiError && error.status === status && error.code === code && error.message === 'A safe service explanation.');
    assert.equal(calls, 1);
  }
});

test('malformed errors cannot be treated as success or copied verbatim into diagnostics', async () => {
  const cases = [
    { value: { error: 'Bad response', code: 'unknown_server_code' }, status: 409 },
    { value: { error: 42, code: 'conflict' }, status: 409 },
    { value: { error: 'Bad response', code: 'conflict', token: TOKEN }, status: 409 },
    { value: { error: `Reflected private capability ${TOKEN}`, code: 'unauthorized' }, status: 401 },
    { value: { error: 'An error envelope with a successful HTTP status', code: 'conflict' }, status: 200 },
  ];
  for (const { value, status } of cases) {
    globalThis.fetch = async () => json(value, status);
    await assert.rejects(request('GET', `/api/challenges/${ID}`, undefined, TOKEN), error =>
      error instanceof ApiError && error.status === status && error.code === 'internal_error' && !error.message.includes(TOKEN));
  }
});

test('invalid, duplicate, unsafe-number and excessively large JSON responses reject before publication', async () => {
  const cases = ['not JSON', '', 'null', '[]', '{"revision":1,"revision":2}', '{"revision":1,"\\u0072evision":2}',
    '{"serverTime":1e999}', '{"revision":9007199254740993}', '{"name":"\\ud800"}',
    '{"text":"' + 'x'.repeat(1048576) + '"}',
  ];
  for (const body of cases) {
    globalThis.fetch = async () => new Response(body, { headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(request('GET', `/api/challenges/${ID}`, undefined, TOKEN), error => error instanceof ApiError && error.status === 200 && error.code === 'internal_error');
  }
  globalThis.fetch = async () => new Response('<html>wrong endpoint</html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(request('GET', '/api/status'), ApiError);
});

test('unsafe destinations, malformed capabilities and oversized bodies fail before fetch', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json(snapshot()); };
  const badPaths = ['https://outside.example/api/status', '//outside.example/api/status', '/api/status?token=' + TOKEN,
    '/api/status#access=' + TOKEN, '/api/../status', '/api/%2e%2e/status', '/api/status\\other', '/api/status\n'];
  for (const path of badPaths) await assert.rejects(request('GET', path), error => error instanceof ApiError && error.code === 'invalid_request' && !error.message.includes(TOKEN));
  await assert.rejects(request('GET', `/api/challenges/${ID}`, undefined, TOKEN + '\n'), ApiError);
  await assert.rejects(request('GET', '/api/status', { unexpected: true }), ApiError);
  await assert.rejects(request('POST', '/api/challenges', { text: '😀'.repeat(5000) }), ApiError);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  await assert.rejects(request('POST', '/api/challenges', cyclic), ApiError);
  assert.equal(calls, 0);
});

test('network failures get a safe connection message and never replay a mutation', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new TypeError(`Network error for ${TOKEN}`); };
  await assert.rejects(request('POST', `/api/challenges/${ID}/accept`, { revision: 1, termsVersion: 1 }, TOKEN), error =>
    error instanceof ApiError && error.status === 0 && error.code === 'internal_error' && /connect|service/i.test(error.message) && !error.message.includes(TOKEN));
  assert.equal(calls, 1);
});

test('fetch and response-stream aborts retain their original AbortError', async () => {
  const aborted = new DOMException('Aborted', 'AbortError');
  globalThis.fetch = async () => { throw aborted; };
  await assert.rejects(request('GET', '/api/status'), error => error === aborted);
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(aborted); } }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(request('GET', '/api/status'), error => error === aborted);
});

test('an AbortError from another JavaScript realm is preserved during cancellation', async () => {
  const foreign: unknown = runInNewContext('Object.assign(new Error("Aborted"), { name: "AbortError" })');
  assert.equal(foreign instanceof Error, false);
  globalThis.fetch = async () => { throw foreign; };
  await assert.rejects(request('GET', '/api/status'), error => error === foreign);
});

test('valid service explanations stay bounded even when the server supplies long text', async () => {
  const code: ErrorCode = 'conflict';
  globalThis.fetch = async () => json({ error: 'x'.repeat(10000), code }, 409);
  await assert.rejects(request('GET', `/api/challenges/${ID}`, undefined, TOKEN), error =>
    error instanceof ApiError && error.code === code && error.message.length <= 500);
});
