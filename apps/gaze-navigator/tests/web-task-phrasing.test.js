import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { HELD_OUT_2_SUITE, HELD_OUT_3_SUITE, HELD_OUT_4_SUITE, HELD_OUT_SUITE, SUITE } from '../src/web/instruction-suite.js';

const control = (id, role, name, extra = {}) => ({ id, role, name, distance: id === 1 ? 0 : 10 * id, editable: false, ...extra });
const field = (id, name, extra = {}) => control(id, 'textbox', name, { editable: true, value: '', ...extra });
// A shop page named the way many sites name things, not the way the instruction suite does.
const shop = { elements: [control(1, 'button', 'Add to basket'), control(2, 'button', 'Checkout', { consequential: true }), control(3, 'link', 'Customer reviews'),
  control(4, 'link', 'Prices'), control(5, 'link', 'Get in touch'), control(6, 'link', 'Log in'), field(7, 'Search the shop', { role: 'searchbox' })] };

test('tasks said as what is wanted reach the control that does them, as different sites name it', () => {
  for (const [say, expected] of [
    ['put it in my basket', 1], ['pop this in the cart', 1], ['add this item to my bag', 1],
    ['finish my order', 2], ['proceed to checkout', 2], ['go ahead and order it', 2],
    ['what do customers say about it', 3], ['any reviews', 3],
    ['how much does it cost', 4], ['what are your fees', 4],
    ['how do I contact you', 5], ['I want to get in touch', 5],
    ['let me sign in', 6], ['log into my account', 6],
  ]) assert.deepEqual(interpret(say, shop), { type: 'activate', targetId: expected }, say);
  assert.deepEqual(interpret("I'm looking for garden tools", shop), { type: 'search', targetId: 7, text: 'garden tools' });
  assert.deepEqual(interpret('have you got anything on bird feeders', shop), { type: 'search', targetId: 7, text: 'bird feeders' });
});

test('a task with no control for it is not acted on', () => {
  const plain = { elements: [control(1, 'link', 'Home'), control(2, 'link', 'Blog')] };
  for (const say of ['put it in my basket', 'finish my order', 'how much does it cost', 'any reviews']) assert.equal(interpret(say, plain).type, 'unknown', say);
  // "Looking for the contact page" names a page, not something to search for.
  assert.notEqual(interpret("I'm looking for the contact page", shop).type, 'search');
});

test('choices and form answers said as statements', () => {
  const product = { elements: [control(1, 'combobox', 'Format', { options: ['Paperback', 'Hardcover', 'Audiobook'], value: 'Paperback' })] };
  for (const [say, index] of [["I'd like the hardcover", 1], ['could I get it in audiobook', 2], ['hardcover please', 1], ['the paperback is fine', 0]]) {
    const { type, targetId, optionIndex } = interpret(say, product);
    assert.deepEqual({ type, targetId, optionIndex }, { type: 'select-option', targetId: 1, optionIndex: index }, say);
  }
  const form = { elements: [field(1, 'Full name'), field(2, 'Email'), control(3, 'combobox', 'Subject', { options: ['Billing', 'Delivery problem'], value: 'Billing' }),
    control(4, 'button', 'Send', { submits: true, consequential: true })] };
  assert.deepEqual(interpret("it's about a delivery problem", form), { type: 'select-option', targetId: 3, optionIndex: 1, optionName: 'Delivery problem' });
  assert.deepEqual(interpret('my name is Grace Hopper', form), { type: 'edit', targetId: 1, edit: { kind: 'append', text: 'Grace Hopper' } });
  assert.deepEqual(interpret('my email is grace@example.com', form), { type: 'edit', targetId: 2, edit: { kind: 'append', text: 'grace@example.com' } });
  // "Remember my ..." still saves the detail rather than typing it.
  assert.equal(interpret('remember my name is Grace Hopper', form).type, 'details');
  // "Send it" presses the send button, unless a field is being typed in, which submits its form as before.
  assert.deepEqual(interpret('send it', form), { type: 'activate', targetId: 4 });
  assert.deepEqual(interpret('send it', { ...form, focusedId: 2 }), { type: 'submit', targetId: 2 });
});

test('items in a list are removed or opened by their place, however it is said', () => {
  const list = { elements: [control(1, 'link', 'Read more'), control(2, 'link', 'Read more'), control(3, 'button', 'Remove', { consequential: true }), control(4, 'button', 'Remove', { consequential: true })] };
  assert.deepEqual(interpret('take the second one out', list), { type: 'activate', targetId: 4 });
  assert.deepEqual(interpret('bin the first one', list), { type: 'activate', targetId: 3 });
  assert.deepEqual(interpret('tell me more about the second one', list), { type: 'activate', targetId: 2 });
  assert.equal(interpret('get rid of it', list).type, 'clarify');
});

test('held-out set 4 does not repeat earlier instructions', () => {
  const earlier = new Set([...SUITE, ...HELD_OUT_SUITE, ...HELD_OUT_2_SUITE, ...HELD_OUT_3_SUITE].map(item => item.say.toLowerCase()));
  assert.equal(HELD_OUT_4_SUITE.length, 36);
  for (const item of HELD_OUT_4_SUITE) assert.equal(earlier.has(item.say.toLowerCase()), false, item.say);
});
