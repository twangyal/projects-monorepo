import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
import { rankSaid, rankValue, rankedOption } from '../src/web/choices.js';
import { CONTEXTS } from '../src/web/instruction-suite.js';

const el = (id, role, name, extra = {}) => ({ id, role, name, distance: 10 * id, editable: false, ...extra });
const select = (targetId, optionIndex, optionName) => ({ type: 'select-option', targetId, optionIndex, optionName });

test('a choice is said by its rank among a dropdown’s options: sizes, delivery times and prices', () => {
  const { shop } = CONTEXTS;
  assert.deepEqual(interpret('the largest size', shop), select(1, 4, 'XL'));
  assert.deepEqual(interpret('biggest size please', shop), select(1, 4, 'XL'));
  assert.deepEqual(interpret('the smallest one', shop), select(1, 0, 'XS'));
  assert.deepEqual(interpret('quickest delivery', shop), select(4, 1, 'Express (next working day)'));
  assert.deepEqual(interpret('I would like the fastest shipping', shop), select(4, 1, 'Express (next working day)'));
  const priced = { elements: [
    el(1, 'combobox', 'Delivery', { options: ['Choose delivery', 'Standard, 3-5 days, £3.99', 'Next day, £6.99', 'Collect in store, free'], value: 'Choose delivery' }),
    el(2, 'combobox', 'Edition', { options: ['Paperback £8.99', 'Hardcover £16.50', 'Audiobook $12'], value: 'Paperback £8.99' })] };
  // The delivery dropdown is named for speed; prices are in both, so a price alone is asked by the dropdown's name.
  assert.deepEqual(interpret('the quickest one', priced), select(1, 2, 'Next day, £6.99'));
  assert.deepEqual(interpret('the cheapest delivery', priced), select(1, 3, 'Collect in store, free'));
  assert.deepEqual(interpret('the most expensive edition', priced), select(2, 1, 'Hardcover £16.50'));
  assert.notEqual(interpret('the cheapest', priced).type, 'select-option');
  // The first or last option of the only dropdown in the circle, past a prompt such as "Choose a size".
  const sizes = { elements: [el(1, 'combobox', 'Size', { options: ['Choose a size', '8', '10', '12', '14'], value: 'Choose a size' })] };
  assert.deepEqual(interpret('the first option', sizes), select(1, 1, '8'));
  assert.deepEqual(interpret('the smallest size', sizes), select(1, 1, '8'));
  assert.deepEqual(interpret('the biggest', sizes), select(1, 4, '14'));
});

test('radio buttons are ranked too, and a rank that fits two lists or none is not guessed', () => {
  const radios = { elements: [el(1, 'radio', 'Standard delivery (3 to 5 working days)'), el(2, 'radio', 'Express delivery (1-2 working days)'),
    el(3, 'radio', 'Same day courier'), el(4, 'button', 'Continue')] };
  assert.deepEqual(interpret('the fastest delivery', radios), { type: 'select-radio', targetId: 3 });
  const twoSizes = { elements: [el(1, 'combobox', 'Top size', { options: ['S', 'M', 'L'], value: 'M' }), el(2, 'combobox', 'Bottom size', { options: ['S', 'M', 'L'], value: 'M' })] };
  assert.notEqual(interpret('the largest size', twoSizes).type, 'select-option');
  assert.deepEqual(interpret('the largest top size', twoSizes), select(1, 2, 'L'));
  // Colours have no size or speed.
  assert.notEqual(interpret('the quickest one', { elements: [CONTEXTS.shop.elements[1]] }).type, 'select-option');
});

test('ranks and values are read from the words people use', () => {
  for (const said of ["I'd like the cheapest one please", 'I’d like the cheapest one please']) assert.deepEqual(rankSaid(said), { by: 'price', end: -1, noun: null });
  assert.deepEqual(rankSaid('the last size option'), { by: 'order', end: 1, noun: 'size' });
  assert.equal(rankSaid('the largest of them all'), null);
  assert.equal(rankValue('Extra large', 'size'), 6);
  assert.equal(rankValue('UK 12', 'size'), 112);
  assert.equal(rankValue('Free returns', 'price'), 0);
  assert.equal(rankValue('Express £4.99', 'price'), 4.99);
  assert.equal(rankValue('2-3 working days', 'speed'), 2.5);
  assert.equal(rankValue('Next working day', 'speed'), 1);
  assert.equal(rankValue('Click and collect', 'speed'), null);
  assert.equal(rankValue('Select a size', 'order'), null);
  assert.equal(rankedOption({ by: 'size', end: 1, noun: null }, [{ name: 'Colour', options: ['Red', 'Blue'] }]), null);
});
