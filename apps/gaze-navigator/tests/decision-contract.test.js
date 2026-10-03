import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTask, eligibleTargets, validateDecision, geometricDecision, buildChoiceRequest, parseChoiceResponse } from '../src/decision-contract.js';
import { CASES } from '../src/decision-fixtures.js';

const target = (id, x, disabled = false) => ({ id, label: id === 't1' ? 'Compose' : 'Search', description: 'A practice control', disabled, rect: { x, y: 100, width: 200, height: 100 } });
const task = (gaze = { x: 180, y: 150 }) => ({ goal: 'Write a draft', gaze, viewport: { width: 1000, height: 600 }, targets: [target('t1', 100), target('t2', 340)] });

test('tasks require finite bounded coordinates and unique opaque target IDs', () => {
  const input = task();
  const valid = validateTask(input);
  assert.deepEqual(valid, input);
  assert.notEqual(valid, input);
  assert.notEqual(valid.targets[0].rect, input.targets[0].rect);
  for (const gaze of [{ x: NaN, y: 1 }, { x: Infinity, y: 1 }, { x: -1, y: 1 }, { x: 1001, y: 1 }]) {
    assert.throws(() => validateTask(task(gaze)));
  }
  assert.throws(() => validateTask({ ...input, targets: [target('t1', 100), target('t1', 340)] }));
  assert.throws(() => validateTask({ ...input, targets: [target('none', 100)] }));
  assert.throws(() => validateTask({ ...input, goal: 'a'.repeat(501) }));
  assert.throws(() => validateTask({ ...input, viewport: { width: 0, height: 600 } }));
  assert.throws(() => validateTask({ ...input, targets: [{ ...target('t1', 100), disabled: 'false' }] }));
  assert.throws(() => validateTask({ ...input, targets: [target('t1', 950)] }));
});

test('eligible targets are nearby and enabled; missing gaze cannot choose a target', () => {
  assert.deepEqual(eligibleTargets(task()).map(t => t.id), ['t1']);
  assert.deepEqual(eligibleTargets(task({ x: 320, y: 150 })).map(t => t.id), ['t1', 't2']);
  assert.deepEqual(eligibleTargets({ ...task(), targets: [target('t1', 100, true), target('t2', 340)] }), []);
  assert.deepEqual(eligibleTargets(task(null)), []);
});

test('baseline chooses a unique nearby target and abstains on a tie independent of order', () => {
  assert.deepEqual(geometricDecision(task()), { targetId: 't1', confidence: null });
  const gap = task({ x: 320, y: 150 });
  assert.deepEqual(geometricDecision(gap), { targetId: null, confidence: null });
  assert.deepEqual(geometricDecision({ ...gap, targets: gap.targets.toReversed() }), { targetId: null, confidence: null });
  assert.deepEqual(geometricDecision(task(null)), { targetId: null, confidence: null });
});

test('closed decisions reject disabled, distant, invented IDs and malformed confidence', () => {
  assert.deepEqual(validateDecision(task(), { targetId: null, confidence: .5 }), { targetId: null, confidence: .5 });
  for (const value of [{ targetId: 't2', confidence: .9 }, { targetId: 'send-email', confidence: .9 }, { targetId: 't1', confidence: NaN }, { targetId: 't1', confidence: 2 }, { targetId: 't1', confidence: '0.9' }, {}, null]) {
    assert.throws(() => validateDecision(task(), value));
  }
  assert.throws(() => validateDecision({ ...task(), targets: [target('t1', 100, true)] }, { targetId: 't1', confidence: .9 }));
});

test('model input contains the goal and eligible controls, without answer labels or fixture metadata', () => {
  const fixture = CASES[0];
  const request = buildChoiceRequest({ ...fixture.task, expected: fixture.expected, title: 'ANSWER LEAK', caseId: 'LEAK-ID' }, 'tev1:0.8b:local');
  assert.equal(request.model, 'tev1:0.8b:local');
  assert.equal(request.questions.selection.type, 'choice');
  assert.equal(request.state.goal, fixture.task.goal);
  assert.ok(Object.hasOwn(request.questions.selection.criteria, 'none'));
  assert.ok(!JSON.stringify(request).includes('ANSWER LEAK'));
  assert.ok(!JSON.stringify(request).includes('LEAK-ID'));
  assert.ok(!Object.hasOwn(request.state, 'expected'));
  assert.deepEqual(request.state.targets.map(t => t.id), eligibleTargets(fixture.task).map(t => t.id));
});

test('typed choice responses validate probabilities and cannot turn invalid output into abstention', () => {
  const response = { answers: { selection: { type: 'choice', choice: 't1', confidence: .8, probabilities: { t1: .9, none: .1 } } } };
  assert.deepEqual(parseChoiceResponse(task(), response), { targetId: 't1', confidence: .8 });
  assert.deepEqual(parseChoiceResponse(task(), { answers: { selection: { type: 'choice', choice: 'none', confidence: .8, probabilities: { t1: .1, none: .9 } } } }), { targetId: null, confidence: .8 });
  for (const selection of [
    { type: 'choice', choice: 't2', confidence: .8, probabilities: { t2: .9, none: .1 } },
    { type: 'score', choice: 't1', confidence: .8, probabilities: { t1: .9, none: .1 } },
    { type: 'choice', choice: 't1', confidence: .8, probabilities: { t1: .9 } },
    { type: 'choice', choice: 't1', confidence: .8, probabilities: { t1: .9, none: .9 } },
  ]) assert.throws(() => parseChoiceResponse(task(), { answers: { selection } }));
});

test('versioned synthetic cases are valid, frozen, and cover context plus abstention', () => {
  assert.equal(CASES.length, 14);
  assert.equal(new Set(CASES.map(c => c.id)).size, 14);
  for (const fixture of CASES) {
    validateTask(fixture.task);
    validateDecision(fixture.task, { targetId: fixture.expected, confidence: null });
    assert.ok(Object.isFrozen(fixture));
    assert.ok(Object.isFrozen(fixture.task.targets));
  }
  assert.ok(CASES.some(c => c.expected !== null && geometricDecision(c.task).targetId !== c.expected));
  assert.ok(CASES.some(c => c.expected === null));
});
