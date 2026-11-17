import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { rowAction } from '../src/web/rows.js';
import { HELD_OUT_2_SUITE, HELD_OUT_3_SUITE, HELD_OUT_4_SUITE, HELD_OUT_5_SUITE, HELD_OUT_6_SUITE, HELD_OUT_SUITE, SUITE } from '../src/web/instruction-suite.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });
// A to-do list and a shop cart, unlike the held-out set's basket and address book.
const todo = { elements: [
  el(1, 'button', 'Delete', { row: 'Buy oat milk' }), el(2, 'link', 'Edit', { row: 'Buy oat milk' }),
  el(3, 'button', 'Delete', { row: 'Book dentist appointment' }), el(4, 'link', 'Edit', { row: 'Book dentist appointment' }),
  el(5, 'button', 'Delete', { row: 'Call the boxes company' }), el(6, 'link', 'Edit', { row: 'Call the boxes company' }),
  el(7, 'button', 'Add task')] };
const cart = { elements: [
  el(1, 'combobox', 'Qty', { options: ['1', '2', '3', '4'], value: '1', row: 'Running shoes, size 9' }), el(2, 'button', 'Remove item', { row: 'Running shoes, size 9' }),
  el(3, 'combobox', 'Qty', { options: ['1', '2', '3', '4'], value: '1', row: 'Running socks, 3 pack' }), el(4, 'button', 'Remove item', { row: 'Running socks, 3 pack' })] };
const ask = (elements, act) => ({ type: 'clarify', candidates: elements.map(element => ({ number: element.id, label: element.name, elementId: element.id })), choose: number => act(elements.find(element => element.id === number)) });

test('a repeated control is reached by the words of its row, whichever way the removal is said', () => {
  for (const [say, id] of [['delete the dentist appointment', 3], ['remove buy oat milk', 1], ['I no longer need the boxes one', 5],
    ['take the oat milk off my list', 1], ['edit the dentist one', 4], ['change the milk task', 2]]) {
    assert.deepEqual(interpret(say, todo), { type: 'activate', targetId: id }, say);
  }
  // Plurals and possessives are read as one word: "box" finds "boxes".
  assert.deepEqual(rowAction('delete the box company', todo, ask), { type: 'activate', targetId: 5 });
  assert.deepEqual(interpret('remove the shoes', cart), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('I want two pairs of shoes', cart).type, 'unknown', 'not a quantity said as one');
  assert.deepEqual(interpret('make the socks three', cart), { type: 'select-option', targetId: 3, optionIndex: 2 });
  assert.deepEqual(interpret('I want 2 shoes', cart), { type: 'select-option', targetId: 1, optionIndex: 1 });
});

test('two matching rows are asked about by their row, and a row the page lacks does nothing', () => {
  const both = interpret('remove the running ones', cart);
  assert.equal(both.type, 'clarify');
  assert.deepEqual(both.candidates.map(candidate => candidate.label), ['Remove item, Running shoes, size 9', 'Remove item, Running socks, 3 pack']);
  assert.deepEqual(both.choose(4), { type: 'activate', targetId: 4 });
  for (const say of ['delete the gym session', 'remove the hat', 'make the hat two']) assert.equal(interpret(say, say.includes('gym') ? todo : cart).type, 'unknown', say);
  assert.match(interpret('remove the hat', cart).message, /No row here mentions the hat/);
  // Counting the rows stays with ordinals, and pages without rows are read as before.
  assert.equal(rowAction('remove the second one', cart, ask), null);
  assert.equal(rowAction('remove the hat', { elements: [el(1, 'button', 'Remove')] }, ask), null);
  // A control named by the words themselves is the normal matcher's ("delete account" beside rows of Remove buttons).
  const account = { elements: [...cart.elements, el(9, 'button', 'Delete account', { consequential: true })] };
  assert.deepEqual(interpret('delete account', account), { type: 'activate', targetId: 9 });
  // Just outside the circle, a row's control is still found.
  assert.deepEqual(interpret('delete the dentist appointment', { elements: [el(7, 'button', 'Add task')], nearby: todo.elements.slice(0, 6) }).targetId, 3);
});

test('held-out set 6 does not repeat earlier instructions', () => {
  const earlier = new Set([...SUITE, ...HELD_OUT_SUITE, ...HELD_OUT_2_SUITE, ...HELD_OUT_3_SUITE, ...HELD_OUT_4_SUITE, ...HELD_OUT_5_SUITE].map(item => item.say.toLowerCase()));
  assert.equal(HELD_OUT_6_SUITE.length, 26);
  for (const item of HELD_OUT_6_SUITE) assert.equal(earlier.has(item.say.toLowerCase()), false, item.say);
});
