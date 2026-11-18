import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import {
  CONTEXTS, HELD_OUT_2_SUITE, HELD_OUT_3_SUITE, HELD_OUT_4_SUITE, HELD_OUT_5_SUITE, HELD_OUT_6_SUITE, HELD_OUT_7_SUITE, HELD_OUT_8_SUITE,
  HELD_OUT_9_SUITE, HELD_OUT_10_SUITE, HELD_OUT_11_SUITE, HELD_OUT_12_SUITE, HELD_OUT_13_SUITE, HELD_OUT_SUITE, SUITE, evaluateInterpreter,
} from '../src/web/instruction-suite.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });

test('held-out sets 7 to 13 do not repeat earlier instructions', () => {
  const earlier = new Set([...SUITE, ...HELD_OUT_SUITE, ...HELD_OUT_2_SUITE, ...HELD_OUT_3_SUITE, ...HELD_OUT_4_SUITE, ...HELD_OUT_5_SUITE, ...HELD_OUT_6_SUITE]
    .map(item => item.say.toLowerCase()));
  assert.equal(HELD_OUT_7_SUITE.length, 42);
  for (const item of HELD_OUT_7_SUITE) assert.equal(earlier.has(item.say.toLowerCase()), false, item.say);
  for (const item of HELD_OUT_7_SUITE) earlier.add(item.say.toLowerCase());
  for (const [suite, length] of [[HELD_OUT_8_SUITE, 37], [HELD_OUT_9_SUITE, 43], [HELD_OUT_10_SUITE, 31], [HELD_OUT_11_SUITE, 32], [HELD_OUT_12_SUITE, 32], [HELD_OUT_13_SUITE, 32]]) {
    assert.equal(suite.length, length);
    for (const item of suite) assert.equal(earlier.has(item.say.toLowerCase()), false, item.say);
    for (const item of suite) earlier.add(item.say.toLowerCase());
  }
});

test('every held-out set keeps its score, and none is acted on wrongly', () => {
  // Scores recorded 2026-11-18: how many requests are understood, and how many reach the control meant, understood or
  // offered for a yes. Set 8 was scored once, after the rules for set 7; set 11 once, after offers were scored by how
  // well a request's words point to a control; set 12 once, after choices could be said by their rank; set 13 once, after
  // choices could be said as a preference (15 understood and 8 offered, as before those rules; its wrong offer is fixed).
  const floors = [[HELD_OUT_SUITE, 49, 49], [HELD_OUT_2_SUITE, 50, 50], [HELD_OUT_3_SUITE, 54, 54], [HELD_OUT_4_SUITE, 35, 36], [HELD_OUT_5_SUITE, 32, 32],
    [HELD_OUT_6_SUITE, 26, 26], [HELD_OUT_7_SUITE, 41, 41], [HELD_OUT_8_SUITE, 26, 31], [HELD_OUT_9_SUITE, 28, 40], [HELD_OUT_10_SUITE, 17, 28],
    [HELD_OUT_11_SUITE, 16, 24], [HELD_OUT_12_SUITE, 32, 32], [HELD_OUT_13_SUITE, 17, 24]];
  for (const [suite, floor, reached] of floors) {
    const { summary, results } = evaluateInterpreter(interpret, suite);
    assert.equal(summary.unsafe, 0, JSON.stringify(results.filter(result => result.outcome === 'unsafe')));
    assert.ok(summary.correct >= floor, `${summary.correct} of ${suite.length}, below ${floor}`);
    assert.ok(summary.correct + summary.offered >= reached, `${summary.correct + summary.offered} reach the control meant, below ${reached}`);
    // An offer is never of something else.
    assert.equal(summary.misoffered, 0, JSON.stringify(results.filter(result => result.offer === 'wrong')));
  }
});

test('requests said politely or as the goal reach the control', () => {
  const { navigation, product, basket, form, shop } = CONTEXTS;
  assert.deepEqual(interpret('would you take me home', navigation), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('read the reviews', product), { type: 'activate', targetId: 4 });
  // Paying is placing the order, or going to the checkout where that is the control.
  assert.deepEqual(interpret('buy it now', product), { type: 'activate', targetId: 3 });
  assert.deepEqual(interpret('time to pay', basket), { type: 'activate', targetId: 10 });
  // "Get rid of" clears a text field called that, and removes anything else.
  assert.deepEqual(interpret('get rid of the message', form), { type: 'edit', targetId: 3, edit: { kind: 'clear' } });
  assert.equal(interpret('get rid of the second one', CONTEXTS.list).targetId, 5);
  // An option or a field named in other words.
  assert.deepEqual(interpret('pick the hardback', product).optionIndex, 1);
  assert.equal(interpret('set the subject to book suggestion', form).optionIndex, 2);
  assert.equal(interpret("I'll collect it myself", shop).optionIndex, 2);
  assert.deepEqual(interpret('go back to where I was', CONTEXTS.empty), { type: 'back' });
});

test('a control named only by its kind is the one of that kind in the circle, or asked about', () => {
  assert.deepEqual(interpret('click the button', CONTEXTS.navigation), { type: 'activate', targetId: 4 });
  const two = { elements: [el(1, 'button', 'Save'), el(2, 'button', 'Cancel'), el(3, 'link', 'Help')] };
  const asked = interpret('press the button', two);
  assert.equal(asked.type, 'clarify');
  assert.deepEqual(asked.candidates.map(candidate => candidate.elementId), [1, 2]);
  assert.deepEqual(interpret('open the link', two), { type: 'activate', targetId: 3 });
  assert.equal(interpret('click the button', { elements: [el(1, 'link', 'Help')] }).type, 'unknown');
});

test('a control named for its kind ("Menu") is the one meant before any control of that kind', () => {
  const page = { elements: [el(1, 'button', 'Menu'), el(2, 'combobox', 'Sort by', { options: ['Newest', 'Oldest'], value: 'Newest' })] };
  assert.deepEqual(interpret('open the menu', page), { type: 'activate', targetId: 1 });
  assert.deepEqual(interpret('open the menu', { elements: [page.elements[1]] }), { type: 'activate', targetId: 2 });
});
