import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, normalize } from '../src/web/interpreter.js';
import { everydayCommand } from '../src/web/everyday.js';
import { meantOptions, rankSaid } from '../src/web/choices.js';
import { CONTEXTS } from '../src/web/instruction-suite.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });
const picked = (action, targetId, optionIndex) => assert.deepEqual([action.type, action.targetId, action.optionIndex], ['select-option', targetId, optionIndex]);

test('a choice said as a preference reaches the option meant, in the words people use for it', () => {
  const { product, form, shop } = CONTEXTS;
  // "Softback" is a Paperback, "hardback" a Hardcover; "a small would be better" agrees to S, not XS.
  picked(interpret('softback is fine', product), 1, 0);
  picked(interpret('a small would be better', shop), 1, 1);
  // What a message is about, said as having one: a complaint is an Order problem, an idea a Book suggestion.
  picked(interpret('I have a complaint about my order', form), 5, 1);
  picked(interpret("I've got an idea for a book", form), 5, 2);
  // A way of getting it, with the place said: picking it up from the shop is Click and collect.
  picked(interpret("I'll pick it up from the shop", shop), 4, 2);
  assert.deepEqual(meantOptions('pick up from the shop', [{ name: 'Delivery', options: ['Standard', 'Next day', 'Collect in store'] }]).map(option => option.name), ['Collect in store']);
  // Words that name no option choose nothing.
  assert.notEqual(interpret('I have a coupon', form).type, 'select-option');
});

test('a rank is said with what usually follows it: the one you have, the way to get it', () => {
  const { shop } = CONTEXTS;
  assert.deepEqual(rankSaid('the biggest one you have'), { by: 'size', end: 1, noun: null });
  assert.deepEqual(rankSaid('the fastest way to get it'), { by: 'speed', end: -1, noun: 'delivery' });
  assert.deepEqual(rankSaid("the cheapest way to send it to me"), { by: 'price', end: -1, noun: 'delivery' });
  picked(interpret('the biggest one you have', shop), 1, 4);
  picked(interpret("the smallest they've got", shop), 1, 0);
  picked(interpret('the fastest way to get it', shop), 4, 1);
});

test('radio buttons are chosen by a preference too, in the circle or just outside it', () => {
  const formats = { elements: [el(1, 'radio', 'Paperback'), el(2, 'button', 'Add to basket')], nearby: [el(3, 'radio', 'Hardback'), el(4, 'radio', 'Ebook')] };
  assert.deepEqual(interpret('the hardback is fine', formats), { type: 'select-radio', targetId: 3 });
  assert.deepEqual(interpret('softback please', formats), { type: 'select-radio', targetId: 1 });
  // Two options a preference fits are asked about.
  const two = { elements: [el(1, 'radio', 'Large print paperback'), el(2, 'radio', 'Large print hardback'), el(3, 'radio', 'Audiobook')] };
  assert.equal(interpret('large print please', two).type, 'clarify');
});

test('a number of a row’s item sets that row’s quantity; one no row mentions is left to other rules', () => {
  const { basket } = CONTEXTS;
  picked(interpret('three hats please', basket), 4, 2);
  picked(interpret('make it two mugs', basket), 7, 1);
  assert.notEqual(interpret('three scarves please', basket).type, 'select-option');
});

test('adding another, and a wish that names a checkbox, act on the one control meant', () => {
  const { addresses, form } = CONTEXTS;
  assert.deepEqual(interpret('add another one', addresses), { type: 'activate', targetId: 7 });
  assert.deepEqual(interpret('update the address at work', addresses), { type: 'activate', targetId: 3 });
  assert.deepEqual(interpret("I'd like a copy of this sent to me", form), { type: 'check', targetId: 4, checked: true });
  // A box named without "click" is ticked, so one already ticked stays ticked; "click" still clicks it.
  const ticked = { elements: [el(1, 'checkbox', 'Send me a copy', { checked: true }), el(2, 'button', 'Send message', { submits: true })] };
  assert.deepEqual(interpret('send me a copy too', ticked), { type: 'check', targetId: 1, checked: true });
  assert.deepEqual(interpret('click send me a copy', ticked), { type: 'activate', targetId: 1 });
  // Two adding controls are asked about; a wish matching no box ticks nothing.
  const adders = { elements: [el(1, 'button', 'Add item'), el(2, 'button', 'Add note')] };
  assert.equal(interpret('add another one', adders).type, 'clarify');
  assert.notEqual(interpret("I'd like to hear about offers", form).type, 'check');
});

test('prices, a number to ring, reviews and sending are asked for in everyday words', () => {
  const said = text => everydayCommand(text, normalize);
  assert.equal(said('how much will it set me back'), 'open pricing');
  assert.equal(said('how expensive is it'), 'open pricing');
  assert.equal(said('who can I ring about this'), 'open contact');
  assert.equal(said('is there a phone number'), 'open contact');
  assert.equal(said('any reviews worth reading'), 'open reviews');
  assert.equal(said('fire it off'), 'send it');
  const { navigation, form, product } = CONTEXTS;
  assert.deepEqual(interpret('how much will it set me back', navigation), { type: 'activate', targetId: 2 });
  assert.deepEqual(interpret('who can I ring about this', navigation), { type: 'activate', targetId: 3 });
  assert.deepEqual(interpret('any reviews worth reading', product), { type: 'activate', targetId: 4 });
  assert.deepEqual(interpret('fire it off', form), { type: 'activate', targetId: 6 });
});
