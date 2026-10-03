import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { CASES, SUITE_VERSION } from '../src/decision-fixtures.js';
import { summarizeBenchmark, runLocalBenchmark } from '../src/decision-benchmark.js';

const report = (results, extra = {}) => ({
  format: 'gaze-decision-report', version: 1, suite: SUITE_VERSION,
  model: { id: 'Ollama/tev1:0.8b-q8_0', kind: 'local', digest: 'a'.repeat(64) },
  createdAt: '2026-10-03T00:00:00.000Z', cancelled: false, results, ...extra,
});
const abstain = fixture => ({ caseId: fixture.id, decision: { targetId: null, confidence: null }, elapsedMs: 10, error: null });

test('benchmark separates actual model-eligible tasks from deterministic boundary cases', () => {
  const value = summarizeBenchmark(report(CASES.map(abstain)));
  assert.equal(value.overall.total, 14);
  assert.equal(value.overall.correct, 6);
  assert.equal(value.modelEligible.total, 11);
  assert.equal(value.modelEligible.correct, 3);
  assert.equal(value.modelEligible.accuracy, 3 / 11);
  assert.equal(value.policyOnly.total, 3);
  assert.equal(value.policyOnly.correct, 3);
  assert.deepEqual(value.policyOnly.caseIds, ['off-target', 'disabled-target', 'missing-gaze']);
  assert.equal(value.baseline.overall.correct, 9);
  assert.equal(value.baseline.modelEligible.correct, 6);
  assert.deepEqual(value.comparison.improved, ['conflicting-goal']);
  assert.deepEqual(value.comparison.regressed, ['compose-hit', 'search-hit', 'compose-near', 'pause-hit']);
  assert.equal(value.complete, true);
});

test('partial, failed, cancelled, and missing-provenance reports cannot become a complete benchmark', () => {
  const partial = report([
    { caseId: 'compose-hit', decision: null, elapsedMs: 500, error: 'Request failed' },
    abstain(CASES.find(c => c.id === 'off-target')),
  ], { cancelled: true });
  const value = summarizeBenchmark(partial);
  assert.equal(value.overall.correct, 1);
  assert.equal(value.overall.errors, 1);
  assert.equal(value.overall.missing, 12);
  assert.equal(value.overall.accuracy, 1 / 14);
  assert.equal(value.modelEligible.errors, 1);
  assert.equal(value.modelEligible.missing, 10);
  assert.equal(value.modelEligible.accuracy, 0);
  assert.equal(value.policyOnly.accuracy, 1 / 3);
  assert.equal(value.complete, false);
  assert.deepEqual(value.comparison.errors, ['compose-hit']);
  assert.equal(value.comparison.missing.length, 12);
  assert.equal(summarizeBenchmark(report(CASES.map(abstain), {
    model: { id: 'Unverified', kind: 'external', digest: null },
  })).complete, false);
  assert.throws(() => summarizeBenchmark(report([{ ...abstain(CASES[0]), decision: { targetId: 'unknown', confidence: .8 } }])));
});

test('eligible-case timing excludes policy shortcuts and failed requests', () => {
  const value = summarizeBenchmark(report([
    { ...abstain(CASES[0]), elapsedMs: 100 },
    { ...abstain(CASES[1]), elapsedMs: 20 },
    { ...abstain(CASES.find(c => c.id === 'off-target')), elapsedMs: 99999 },
    { caseId: 'compose-near', decision: null, elapsedMs: 90000, error: 'Timeout' },
  ]));
  assert.equal(value.timing.firstSuccessfulEligibleElapsedMs, 100);
  assert.equal(value.timing.eligibleMedianElapsedMs, 60);
  assert.equal(value.timing.eligibleP95ElapsedMs, 100);
  assert.equal(value.modelEligible.meanElapsedMs, 60);
  assert.equal(value.baseline.overall.meanElapsedMs, null);
});

test('real benchmark pipeline uses the existing local adapter and emits a lab-importable report', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const json = value => new Response(JSON.stringify(value));
    if (url.endsWith('/api/status')) return json({ cloud: { disabled: true } });
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'tev1:0.8b-q8_0', digest: 'a'.repeat(64), size: 812000000, details: { format: 'gguf' } }] });
    if (url.endsWith('/api/show')) return json({ details: { format: 'gguf' }, capabilities: ['decision'] });
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'tev1:0.8b-q8_0:local');
    assert.ok(!JSON.stringify(body).includes('expected'));
    const probabilities = Object.fromEntries(Object.keys(body.questions.selection.criteria).map(id => [id, id === 'none' ? 1 : 0]));
    return json({ answers: { selection: { type: 'choice', choice: 'none', confidence: 1, probabilities } } });
  };
  const output = await runLocalBenchmark({ fetchImpl });
  assert.equal(output.format, 'gaze-decision-report');
  assert.equal(output.model.digest, 'a'.repeat(64));
  assert.equal(output.results.length, 14);
  assert.equal(output.benchmark.summary.complete, true);
  assert.equal(output.benchmark.summary.overall.correct, 6);
  assert.equal(calls.filter(c => c.url.endsWith('/v1/systemone')).length, 11);
  assert.ok(calls.every(c => new URL(c.url).origin === 'http://127.0.0.1:11434'));
  let attempted = false;
  await assert.rejects(runLocalBenchmark({ model: 'tev1:cloud', fetchImpl: () => { attempted = true; } }));
  assert.equal(attempted, false);
});

test('whole-run cancellation retains completed rows after an entered uncooperative transport and ignores its late response', async () => {
  const controller = new AbortController();
  let entered, finishLate, inferenceCalls = 0;
  const fetchEntered = new Promise(resolve => { entered = resolve; });
  const json = value => new Response(JSON.stringify(value));
  const fetchImpl = async url => {
    if (url.endsWith('/api/status')) return json({ cloud: { disabled: true } });
    if (url.endsWith('/api/tags')) return json({ models: [{ name: 'tev1:0.8b-q8_0', digest: 'a'.repeat(64), size: 812000000, details: { format: 'gguf' } }] });
    if (url.endsWith('/api/show')) return json({ details: { format: 'gguf' }, capabilities: ['decision'] });
    inferenceCalls++;
    if (inferenceCalls === 1) return json({ answers: { selection: { type: 'choice', choice: 't1', confidence: 1, probabilities: { t1: 1, none: 0 } } } });
    return new Promise(resolve => { finishLate = resolve; entered(); });
  };
  const pending = runLocalBenchmark({ signal: controller.signal, fetchImpl });
  await fetchEntered;
  assert.equal(inferenceCalls, 2);
  controller.abort();
  const output = await pending;
  assert.equal(output.cancelled, true);
  assert.equal(output.results.length, 1);
  assert.equal(output.results[0].caseId, 'compose-hit');
  assert.equal(output.benchmark.summary.complete, false);
  assert.equal(output.benchmark.summary.overall.missing, 13);
  finishLate(json({ answers: { selection: { type: 'choice', choice: 't2', confidence: 1, probabilities: { t2: 1, none: 0 } } } }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(output.results.length, 1);
  assert.equal(inferenceCalls, 2);
});

test('CLI help and invalid/cloud arguments finish without contacting a local server', () => {
  const cli = new URL('../scripts/benchmark-local.js', import.meta.url);
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8', timeout: 3000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /already installed|installed local/i);
  for (const args of [['--endpoint', 'https://example.com'], ['--model'], ['--model', 'tev1:cloud']]) {
    const result = spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /usage|local model|cloud|argument/i);
  }
});
