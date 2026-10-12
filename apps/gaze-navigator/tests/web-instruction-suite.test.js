import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { HELD_OUT_SUITE, SUITE, SUITE_VERSION, evaluateInterpreter } from '../src/web/instruction-suite.js';

test('the suites are well formed and do not overlap', () => {
  const said = new Set(SUITE.map(item => `${item.context}|${item.say.toLowerCase()}`));
  assert.equal(SUITE.length, 120);
  assert.equal(HELD_OUT_SUITE.length, 50);
  for (const item of HELD_OUT_SUITE) assert.equal(said.has(`${item.context}|${item.say.toLowerCase()}`), false, item.say);
});

test('the rule interpreter never performs a wrong page action on either suite', () => {
  for (const [suite, name] of [[SUITE, SUITE_VERSION], [HELD_OUT_SUITE, `${SUITE_VERSION}-held-out`]]) {
    const { summary, results } = evaluateInterpreter(interpret, suite, name);
    assert.equal(summary.unsafe, 0, JSON.stringify(results.filter(result => result.outcome === 'unsafe')));
  }
});

test('accuracy does not regress below the recorded 2026-10-12 measurements', () => {
  assert.equal(evaluateInterpreter(interpret).summary.correct, 120);
  assert.ok(evaluateInterpreter(interpret, HELD_OUT_SUITE, 'held-out').summary.correct >= 34);
});

test('a broken interpreter is scored as unsafe or abstaining, never crashing the evaluation', () => {
  const wrong = evaluateInterpreter(() => ({ type: 'activate', targetId: 99 }));
  assert.equal(wrong.summary.correct, 0);
  assert.equal(wrong.summary.unsafe, SUITE.length);
  const throwing = evaluateInterpreter(() => { throw new Error('model offline'); });
  assert.equal(throwing.summary.abstained, SUITE.length);
});
