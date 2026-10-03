import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDecisionModel } from '../src/local-decision-model.js';
import { CASES } from '../src/decision-fixtures.js';

const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
function service(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/status')) return json(overrides.status ?? { cloud: { disabled: true } });
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'tev1:0.8b', digest: 'a'.repeat(64), size: 812000000, details: { format: 'gguf' }, ...overrides.tag }] });
    if (url.endsWith('/api/show')) return json(overrides.show ?? { details: { format: 'gguf' }, capabilities: ['decision'] });
    if (url.endsWith('/v1/systemone')) {
      const request = JSON.parse(options.body);
      const names = Object.keys(request.questions.selection.criteria);
      const probabilities = Object.fromEntries(names.map(name => [name, name === 't1' ? .9 : .1 / (names.length - 1)]));
      return json(overrides.result ?? { answers: { selection: { type: 'choice', choice: 't1', confidence: .8, probabilities } } });
    }
    throw new Error('Unexpected endpoint');
  };
  return { calls, fetchImpl };
}
test('local model preflight and choice use only fixed loopback and force local source, without credentials', async () => {
  const mock = service();
  const model = createLocalDecisionModel({ fetchImpl: mock.fetchImpl });
  assert.deepEqual(await model.decide(CASES[0].task), { targetId: 't1', confidence: .8 });
  assert.equal(model.digest, 'a'.repeat(64));
  assert.deepEqual(mock.calls.map(c => new URL(c.url).pathname), ['/api/status', '/api/tags', '/api/show', '/v1/systemone']);
  for (const call of mock.calls) {
    assert.equal(new URL(call.url).origin, 'http://127.0.0.1:11434');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.redirect, 'error');
    assert.ok(!Object.keys(call.options.headers ?? {}).some(name => name.toLowerCase() === 'authorization'));
    if (call.options.body) assert.ok(!JSON.parse(call.options.body).model || JSON.parse(call.options.body).model.endsWith(':local'));
  }
  assert.equal(model.kind, 'local');
});

test('cloud names are rejected before any network operation', () => {
  for (const model of ['tev1:cloud', 'tev1:4b-cloud', 'https://host/model', 'tev1:0.8b:cloud', 'tev1:0.8b:local', '../model']) {
    assert.throws(() => createLocalDecisionModel({ model }));
  }
});

test('cloud-enabled/unknown servers and remote or non-decision models cannot reach inference', async () => {
  for (const overrides of [
    { status: { cloud: { disabled: false } } },
    { status: {} },
    { tag: { remote_host: 'https://example.com', remote_model: 'hosted' } },
    { show: { remote_host: 'https://example.com', details: { format: 'gguf' }, capabilities: ['decision'] } },
    { show: { details: { format: 'gguf' }, capabilities: ['completion'] } },
    { show: { details: { format: 'safetensors' }, capabilities: ['decision'] } },
  ]) {
    const mock = service(overrides);
    await assert.rejects(createLocalDecisionModel({ fetchImpl: mock.fetchImpl }).decide(CASES[0].task));
    assert.ok(!mock.calls.some(call => call.url.endsWith('/v1/systemone')));
  }
});

test('no eligible target abstains without any model request', async () => {
  const mock = service();
  const fixture = CASES.find(c => c.task.gaze === null);
  assert.deepEqual(await createLocalDecisionModel({ fetchImpl: mock.fetchImpl }).decide(fixture.task), { targetId: null, confidence: null });
  assert.equal(mock.calls.length, 0);
});

test('invalid local choice and oversized metadata responses fail closed', async () => {
  const mock = service({ result: { answers: { selection: { type: 'choice', choice: 'unknown', confidence: .9, probabilities: { unknown: 1 } } } } });
  await assert.rejects(createLocalDecisionModel({ fetchImpl: mock.fetchImpl }).decide(CASES[0].task));
  await assert.rejects(createLocalDecisionModel({ fetchImpl: async () => new Response('x'.repeat(300000)), timeoutMs: 1000 }).decide(CASES[0].task), /large|limit|size/i);
});

test('request timeout and cancellation settle even when the transport ignores the signal', async () => {
  const pending = () => new Promise(() => {});
  await assert.rejects(createLocalDecisionModel({ fetchImpl: pending, timeoutMs: 5 }).decide(CASES[0].task), /timed out|timeout/i);
  const controller = new AbortController();
  const result = createLocalDecisionModel({ fetchImpl: pending }).decide(CASES[0].task, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
});
