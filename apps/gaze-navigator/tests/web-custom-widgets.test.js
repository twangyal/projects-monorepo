import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const spin = { id: 1, name: 'Guests', role: 'spinbutton', customRange: true, value: '2', distance: 0 };
const size = { id: 2, name: 'Size', role: 'combobox', customList: true, value: 'Medium', distance: 10 };
const country = { id: 3, name: 'Country', role: 'combobox', customList: true, editable: true, value: '', distance: 20 };

test('custom spinbuttons take spoken numbers', () => {
  assert.deepEqual(interpret('set guests to four', { elements: [spin] }), { type: 'range', targetId: 1, value: 4 });
  assert.equal(interpret('set guests to lots', { elements: [spin] }).type, 'unknown');
});

test('custom comboboxes are chosen from by name, before their text is rewritten', () => {
  assert.deepEqual(interpret('set size to large', { elements: [size, country] }), { type: 'choose-option', targetId: 2, optionName: 'large' });
  // An editable combobox is a list to choose from, not a field to overwrite.
  assert.deepEqual(interpret('set country to "Côte d’Ivoire"', { elements: [size, country] }), { type: 'choose-option', targetId: 3, optionName: 'Côte d’Ivoire' });
  assert.deepEqual(interpret('choose extra large from the size', { elements: [size, country] }), { type: 'choose-option', targetId: 2, optionName: 'extra large' });
  const twice = interpret('set size to small', { elements: [size, { ...size, id: 4 }] });
  assert.equal(twice.type, 'clarify');
  const second = twice.candidates.find(candidate => candidate.elementId === 4);
  assert.deepEqual(twice.choose(second.number), { type: 'choose-option', targetId: 4, optionName: 'small' });
});

test('a consequential custom option is confirmed before the list is touched', async () => {
  const calls = [];
  const element = { isConnected: true };
  const actions = { chooseListOption: (target, name) => { calls.push(name); return { ok: true, message: `${name} chosen in Size.` }; } };
  const controller = createController({ window: {}, actions });
  const context = { elements: [{ ...size, element }] };
  assert.equal(controller.handle('set size to delete account', context).tone, 'question');
  assert.deepEqual(calls, []);
  assert.equal(controller.handle('confirm', context).message, 'delete account chosen in Size.');
  assert.equal(controller.handle('set size to large', context).tone, 'success');
  assert.deepEqual(calls, ['delete account', 'large']);
});
