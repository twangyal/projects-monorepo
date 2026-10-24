import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
const field = (id, name = 'Quantity') => ({ id, name, role: 'textbox', nativeNumber: true, distance: 0, editable: true });
test('explicit numeric intent preserves exact signed decimal value and separates slider/text commands', () => {
  const context = { elements: [field(1), { id: 2, name: 'Quantity', role: 'slider', distance: 0 }] };
  assert.deepEqual(interpret('set Quantity number field to 3', context), { type: 'number', targetId: 1, value: '3' });
  assert.deepEqual(interpret('change number field to -0.25', context), { type: 'number', targetId: 1, value: '-0.25' });
  assert.deepEqual(interpret('undo Quantity number field', context), { type: 'number', targetId: 1, undo: true });
  assert.equal(interpret('set Quantity slider to 3', context).type, 'range');
  assert.equal(interpret('type 3', context).type, 'edit');
});
test('numeric parsing refuses unsupported units words exponent and custom spinbuttons', () => {
  for (const value of ['three', '3%', 'NaN', 'Infinity', '1e3', '1,000', '']) assert.equal(interpret(`set number field to ${value}`, { elements: [field(1)] }).type, 'unknown', value);
  assert.equal(interpret('set number field to 3', { elements: [{ id: 1, name: 'Quantity', role: 'spinbutton', distance: 0 }] }).type, 'unknown');
});
test('same-name numeric fields retain deliberate selection through clarification', () => {
  const result = interpret('set Quantity number field to 4', { elements: [field(1), field(2)] });
  assert.equal(result.type, 'clarify');
  assert.deepEqual(result.choose(2), { type: 'number', targetId: 2, value: '4' });
});
