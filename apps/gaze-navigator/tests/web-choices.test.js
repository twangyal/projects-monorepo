import test from 'node:test';
import assert from 'node:assert/strict';
import { meantOptions, nextSize, optionMeanings } from '../src/web/choices.js';
import { interpret } from '../src/web/interpreter.js';
import { HELD_OUT_2_SUITE, HELD_OUT_3_SUITE, HELD_OUT_4_SUITE, HELD_OUT_5_SUITE, HELD_OUT_SUITE, SUITE } from '../src/web/instruction-suite.js';

const select = (id, name, options, value = options[0]) => ({ id, role: 'combobox', name, options, value, distance: id === 1 ? 0 : 10 * id, editable: false });
// A shoe shop, unlike the held-out set's clothes shop: numbered sizes, a two-word colour, shipping speeds and countries.
const shoes = { elements: [select(1, 'Shoe size', ['6', '7', '8', '9', '10'], '8'), select(2, 'Color', ['Black', 'Tan leather', 'Bright white']),
  select(3, 'Shipping method', ['Free standard shipping', 'Next business day', 'Pick up at a store near you']),
  select(4, 'Ship to', ['Canada', 'United States of America', 'United Kingdom of Great Britain and Northern Ireland', 'Mexico']),
  { id: 5, role: 'button', name: 'Add to bag', distance: 50, editable: false }] };
const chosen = (say, context = shoes) => { const { type, targetId, optionIndex } = interpret(say, context); return { type, targetId, optionIndex }; };
const option = (targetId, optionIndex) => ({ type: 'select-option', targetId, optionIndex });

test('options have the names people use for them', () => {
  assert.ok(optionMeanings('M').includes('medium'));
  assert.ok(optionMeanings('XL').includes('extra large'));
  assert.ok(optionMeanings('United States').includes('america'));
  assert.ok(optionMeanings('United Kingdom').includes('uk'));
  assert.ok(optionMeanings('3').includes('three'));
  assert.ok(optionMeanings('Express (next working day)').includes('tomorrow'));
  assert.ok(optionMeanings('Click and collect').includes('pick it up in store'));
  assert.deepEqual(optionMeanings('Forest green'), []);
});

test('a choice is the one option all of whose meaningful words were said; several are asked about, none is no choice', () => {
  const colours = select(1, 'Colour', ['Navy blue', 'Sky blue', 'Charcoal grey']);
  assert.deepEqual(meantOptions('the grey one', [colours]).map(found => found.name), ['Charcoal grey']);
  assert.deepEqual(meantOptions('gray', [colours]).map(found => found.name), ['Charcoal grey']);
  assert.deepEqual(meantOptions('blue', [colours]).map(found => found.name), ['Navy blue', 'Sky blue']);
  assert.deepEqual(meantOptions('pink', [colours]), []);
  // The dropdown's own name is not a word of the choice: "colour navy" is navy.
  assert.deepEqual(meantOptions('colour navy', [colours]).map(found => found.name), ['Navy blue']);
});

test('choices said in other words reach the option they mean, on a shop other than the held-out one', () => {
  for (const [say, expected] of [
    ['in black', option(2, 0)], ['the tan one', option(2, 1)], ['do you have them in white', option(2, 2)],
    ['size nine please', option(1, 3)], ['make it a ten', option(1, 4)],
    ['next day shipping', option(3, 1)], ['I want them tomorrow', option(3, 1)], ["I'll pick them up at a store", option(3, 2)], ['free shipping is fine', option(3, 0)],
    ['ship them to the US', option(4, 1)], ['I live in Britain', option(4, 2)], ["I'm in Mexico", option(4, 3)],
  ]) assert.deepEqual(chosen(say), expected, say);
});

test('a size up or down moves from the current size, and says so at the end of the range', () => {
  assert.equal(nextSize('go one size up'), 1);
  assert.equal(nextSize('a size smaller'), -1);
  assert.equal(nextSize('size nine'), null);
  const sizes = { elements: [select(1, 'Size', ['S', 'M', 'L'], 'M')] };
  assert.deepEqual(chosen('one size down', sizes), option(1, 0));
  assert.deepEqual(chosen('a size bigger', sizes), option(1, 2));
  const largest = { elements: [select(1, 'Size', ['S', 'M', 'L'], 'L')] };
  assert.equal(interpret('go one size up', largest).type, 'unknown');
  assert.match(interpret('go one size up', largest).message, /no size above L/);
});

test('choices the page does not offer, or that two dropdowns share, never act on their own', () => {
  for (const say of ['in pink', 'size twelve', 'ship them to Japan', 'two-day shipping', 'in a wide fit']) assert.equal(interpret(say, shoes).type, 'unknown', say);
  // "Large" in two dropdowns is asked about.
  const two = { elements: [select(1, 'Size', ['S', 'M', 'L']), select(2, 'Pack', ['Small pack', 'Large pack'])] };
  for (const say of ['the large one', 'large please']) {
    assert.equal(interpret(say, two).type, 'clarify', say);
    assert.deepEqual(interpret(say, two).candidates.map(candidate => candidate.label).sort(), ['L', 'Large pack'], say);
  }
  // "That one" names nothing; "just one" is a number of things.
  const quantity = { elements: [select(1, 'Quantity', ['1', '2', '3'])] };
  assert.equal(interpret('I want that one', quantity).type, 'unknown');
  assert.deepEqual(chosen('just one', quantity), option(1, 0));
});

test('held-out set 5 does not repeat earlier instructions', () => {
  const earlier = new Set([...SUITE, ...HELD_OUT_SUITE, ...HELD_OUT_2_SUITE, ...HELD_OUT_3_SUITE, ...HELD_OUT_4_SUITE].map(item => item.say.toLowerCase()));
  assert.equal(HELD_OUT_5_SUITE.length, 32);
  for (const item of HELD_OUT_5_SUITE) assert.equal(earlier.has(item.say.toLowerCase()), false, item.say);
});
