import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
const context = { elements: [
  { id: 1, role: 'tab', name: 'Overview', distance: 20 },
  { id: 2, role: 'tab', name: 'Details', distance: 0 },
  { id: 3, role: 'button', name: 'Details', distance: 0 },
] };
test('explicit website tab selection keeps role and selection intent across supported targeting', () => {
  for (const said of ['select Details tab', 'choose the Details tab', 'pick tab Details', 'select that tab', 'select second tab']) {
    assert.deepEqual(interpret(said, context), { type: 'select-tab', targetId: 2 }, said);
  }
  assert.deepEqual(interpret('select Overview tab', context), { type: 'select-tab', targetId: 1 });
  assert.deepEqual(interpret('click Details button', context), { type: 'activate', targetId: 3 });
});
test('tab ambiguity retains exact choice action and cannot fall through to other roles', () => {
  const result = interpret('select Details tab', { elements: [context.elements[1], { ...context.elements[1], id: 4 }] });
  assert.equal(result.type, 'clarify'); assert.deepEqual(result.choose(4), { type: 'select-tab', targetId: 4 });
  assert.equal(interpret('select Details tab', { elements: [context.elements[2]] }).type, 'unknown');
});

test('tabs and other controls can be named after their kind ("the tab for Ida", "the link to pricing")', () => {
  const el = (id, role, name) => ({ id, role, name, distance: id === 1 ? 0 : 10 * id, editable: false });
  const context = { elements: [el(1, 'tab', 'Maria Ahlefeldt'), el(2, 'tab', 'Ida da Fonseca'), el(3, 'link', 'Pricing'), el(4, 'button', 'Checkout'), el(5, 'link', 'Checkout help')] };
  for (const said of ['show the tab for Ida da Fonseca', 'open the tab called Ida da Fonseca', 'switch to the Ida da Fonseca tab']) {
    assert.deepEqual(interpret(said, context), { type: 'select-tab', targetId: 2 }, said);
  }
  assert.deepEqual(interpret('open the link to pricing', context), { type: 'activate', targetId: 3 });
  // The kind named first prefers that kind of control.
  assert.deepEqual(interpret('click the button for checkout', context), { type: 'activate', targetId: 4 });
  // A tab named this way never falls back to another kind of control.
  assert.equal(interpret('show the tab for pricing', context).type, 'unknown');
});
