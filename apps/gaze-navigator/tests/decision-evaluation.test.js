import test from 'node:test';
import assert from 'node:assert/strict';
import { runSuite, summarize, validateReport } from '../src/decision-evaluation.js';
import { CASES, SUITE_VERSION } from '../src/decision-fixtures.js';
import { geometricDecision } from '../src/decision-contract.js';

const adapter = { id: 'Geometry', kind: 'baseline', digest: null, decide: async task => geometricDecision(task) };
test('a complete geometric run reports real mismatches, abstentions, and unexpected selections', async () => {
  const report = await runSuite(CASES, adapter);
  assert.equal(report.suite, SUITE_VERSION);
  assert.equal(report.results.length, 14);
  const summary = summarize(CASES, report.results);
  assert.equal(summary.correct, 9);
  assert.equal(summary.total, 14);
  assert.equal(summary.valid, 14);
  assert.equal(summary.errors, 0);
  assert.equal(summary.unexpectedSelections, 1);
  assert.equal(summary.accuracy, 9 / 14);
  assert.deepEqual(validateReport(JSON.parse(JSON.stringify(report)), CASES), report);
});

test('errors and missing rows never count as correct abstentions or inflate overall accuracy', () => {
  const missing = CASES.find(c => c.expected === null);
  const first = CASES[0];
  const summary = summarize(CASES, [
    { caseId: first.id, decision: { targetId: first.expected, confidence: null }, elapsedMs: 10, error: null },
    { caseId: missing.id, decision: null, elapsedMs: 20, error: 'Invalid response' },
  ]);
  assert.equal(summary.correct, 1);
  assert.equal(summary.valid, 1);
  assert.equal(summary.errors, 1);
  assert.equal(summary.missing, 12);
  assert.equal(summary.accuracy, 1 / 14);
  assert.equal(summary.coverage, 1 / 14);
});

test('import validation rejects suite changes, duplicates, unknown cases, and impossible decisions', async () => {
  const report = await runSuite(CASES, adapter);
  assert.throws(() => validateReport({ ...report, suite: 'another-suite' }, CASES));
  assert.throws(() => validateReport({ ...report, results: [report.results[0], report.results[0]] }, CASES));
  assert.throws(() => validateReport({ ...report, results: [{ ...report.results[0], caseId: 'invented' }] }, CASES));
  assert.throws(() => validateReport({ ...report, results: [{ ...report.results[0], decision: { targetId: 'invented', confidence: .9 } }] }, CASES));
  assert.throws(() => validateReport({ ...report, results: [{ ...report.results[0], elapsedMs: Infinity }] }, CASES));
  assert.throws(() => validateReport({ ...report, results: [{ ...report.results[0], error: 'failed', decision: { targetId: null, confidence: null } }] }, CASES));
});

test('bad model output becomes an error row, while later cases still run', async () => {
  let count = 0;
  const bad = { ...adapter, id: 'Broken model', decide: async task => ++count === 1 ? { targetId: 'invented', confidence: .9 } : geometricDecision(task) };
  const report = await runSuite(CASES.slice(0, 2), bad);
  assert.equal(report.results[0].decision, null);
  assert.ok(report.results[0].error);
  assert.equal(report.results[1].decision.targetId, CASES[1].expected);
});

test('cancel settles a run even when an adapter ignores AbortSignal, preserving only completed rows', async () => {
  const controller = new AbortController();
  let calls = 0;
  let release;
  const blocked = { ...adapter, decide: async task => ++calls === 1 ? geometricDecision(task) : new Promise(resolve => { release = resolve; }) };
  const running = runSuite(CASES, blocked, { signal: controller.signal, onProgress: () => {} });
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  const report = await running;
  assert.equal(report.cancelled, true);
  assert.equal(report.results.length, 1);
  release({ targetId: null, confidence: null });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(report.results.length, 1);
});
