import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { CONTEXTS } from '../src/web/instruction-suite.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });
const offer = (say, context) => interpret(say, context).alike;

test('a request not understood as a command offers the one control its words point to, for a yes', () => {
  const { navigation, product, form, shop, basket, addresses } = CONTEXTS;
  const got = interpret('I have an account already', navigation);
  assert.equal(got.type, 'unknown');
  assert.deepEqual(got.alike, { type: 'activate', targetId: 4, heardAs: 'Sign in' });
  // By a word of the control's name, or a word for what it does or is about.
  assert.deepEqual(offer('can I email you', navigation), { type: 'activate', targetId: 3, heardAs: 'Contact us' });
  assert.deepEqual(offer('what are your plans and costs', navigation), { type: 'activate', targetId: 2, heardAs: 'Pricing' });
  assert.deepEqual(offer('any good ratings', product), { type: 'activate', targetId: 4, heardAs: 'Reviews' });
  // A dropdown's choice, with the list's own name counting for it; a box to tick.
  assert.deepEqual(offer('bigger print please', product), { type: 'select-option', targetId: 1, optionIndex: 2, optionName: 'Large print', heardAs: 'Large print' });
  assert.deepEqual(offer('the largest size', shop), { type: 'select-option', targetId: 1, optionIndex: 4, optionName: 'XL', heardAs: 'XL' });
  assert.deepEqual(offer('I want a copy too', form), { type: 'check', targetId: 4, checked: true, heardAs: 'Send me a copy' });
  // A control repeated on each row is offered on the row the words name.
  assert.deepEqual(offer('move the socks to my saved items', basket), { type: 'activate', targetId: 3, heardAs: 'Save for later' });
  assert.deepEqual(offer('I need another address', addresses), { type: 'activate', targetId: 7, heardAs: 'Add a new address' });
});

test('nothing is offered when the words say not to, ask for another action, point two ways or name nothing here', () => {
  const { navigation, basket } = CONTEXTS;
  for (const [say, context] of [['I do not want to sign in', navigation], ['delete my account', navigation], ['tell me a joke', navigation],
    ['remove the scarf', basket], ['save it for later', basket]]) {
    assert.equal(offer(say, context), undefined, say);
  }
  // Two controls covered alike, or only a text field: no offer.
  const two = { elements: [el(1, 'link', 'Order history'), el(2, 'link', 'Order status')] };
  assert.equal(offer('something about my order', two), undefined);
  assert.equal(offer('my email is wrong', { elements: [el(1, 'textbox', 'Email address', { editable: true, value: '' })] }), undefined);
  // A box already ticked is not offered.
  assert.equal(offer('I want a copy too', { elements: [el(4, 'checkbox', 'Send me a copy', { checked: true })] }), undefined);
  // Offers come last: a misheard command word is still put right first.
  assert.equal(interpret('chews hardcover', CONTEXTS.product).alike.heardAs, 'choose hardcover');
});

test('a loose match that would do more than was asked is offered, and a password is never typed from speech', () => {
  const { product, navigation } = CONTEXTS;
  // "Open the basket" is not "Add to cart": asked first.
  const got = interpret('open the basket', product);
  assert.equal(got.type, 'unknown');
  assert.deepEqual(got.alike, { type: 'activate', targetId: 2, heardAs: 'Add to cart' });
  assert.deepEqual(interpret('open the cart', product).alike, { type: 'activate', targetId: 2, heardAs: 'Add to cart' });
  // Said in full, it is done.
  assert.deepEqual(interpret('add it to my cart', product), { type: 'activate', targetId: 2 });
  for (const say of ['enter my password', 'type my password', 'put in my pin']) {
    const answer = interpret(say, { elements: [...navigation.elements, el(6, 'textbox', 'Password', { editable: true, value: '' })] });
    assert.equal(answer.type, 'unknown', say);
    assert.match(answer.message, /Passwords are not typed by voice/);
  }
});
