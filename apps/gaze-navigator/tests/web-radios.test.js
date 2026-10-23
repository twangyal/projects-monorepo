import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
const context = { elements: [
  { id: 1, role: 'radio', name: 'Standard', distance: 20 },
  { id: 2, role: 'radio', name: 'Express', distance: 0 },
  { id: 3, role: 'button', name: 'Express', distance: 0 },
] };
test('explicit radio phrases select only radios with named deictic and ordinal resolution', () => {
  for (const said of ['select Express radio button', 'choose the Express radio', 'pick radio button Express', 'select that radio button', 'select second radio button']) {
    assert.deepEqual(interpret(said, context), { type: 'select-radio', targetId: 2 }, said);
  }
  assert.deepEqual(interpret('select Standard radio button', context), { type: 'select-radio', targetId: 1 });
  assert.deepEqual(interpret('click Express button', context), { type: 'activate', targetId: 3 });
  assert.equal(interpret('uncheck Express radio button', context).type, 'unknown');
});
test('radio ambiguity preserves selection intent and absent targets never fall through to other roles', () => {
  const question = interpret('select Express radio button', { elements: [context.elements[1], { ...context.elements[1], id: 4 }] });
  assert.equal(question.type, 'clarify');
  assert.deepEqual(question.choose(4), { type: 'select-radio', targetId: 4 });
  assert.equal(interpret('select Express radio button', { elements: [context.elements[2]] }).type, 'unknown');
});
