import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret } from '../src/web/interpreter.js';
const list = (id = 1, name = 'Genres', extra = {}) => ({ id, name, role: 'combobox', distance: 0, options: ['Rock', 'Jazz', 'Classical'], selectSnapshot: { multiple: true }, ...extra });
const context = (...elements) => ({ elements });
test('explicit add and remove option commands preserve desired-state intent and target', () => {
  for (const [utterance, selected] of [['add option Jazz to Genres', true], ['remove option Jazz from Genres', false], ['please add option Jazz', true], ['remove option Jazz', false]]) {
    assert.deepEqual(interpret(utterance, context(list())), { type: 'select-option', targetId: 1, optionIndex: 1, optionName: 'Jazz', selected });
  }
});
test('explicit multi-select commands clarify duplicate lists and duplicate options', () => {
  const q = interpret('add option Jazz to Genres', context(list(1), list(2)));
  assert.equal(q.type, 'clarify'); const choice = q.choose(q.candidates[1].number);
  assert.deepEqual(choice, { type: 'select-option', targetId: 2, optionIndex: 1, optionName: 'Jazz', selected: true });
  const duplicates = interpret('remove option Jazz', context(list(1, 'Genres', { options: ['Jazz', 'Jazz'] })));
  assert.equal(duplicates.type, 'clarify'); assert.equal(duplicates.choose(2).optionIndex, 1);
});
test('explicit multi-select intent does not fall through into another action', () => {
  for (const page of [context(), context(list(1, 'Genres', { selectSnapshot: { multiple: false } }))]) {
    assert.equal(interpret('add option Jazz to Genres', page).type, 'unknown');
  }
  assert.equal(interpret('add option Missing to Genres', context(list())).type, 'unknown');
  // Choosing in a list that takes several adds; in a list of one choice it replaces, as ever.
  assert.equal(interpret('choose Jazz from Genres', context(list())).selected, true);
  assert.equal(interpret('choose Jazz from Genres', context(list(1, 'Genres', { selectSnapshot: { multiple: false } }))).selected, undefined);
});
test('everyday words add to and take off a native list that takes several, one or several at once', () => {
  const genres = context(list());
  for (const [said, selected] of [['choose jazz', true], ['select jazz too', true], ['add jazz to genres', true], ['also pick jazz', true],
    ['remove jazz', false], ['deselect jazz', false], ['unselect jazz from genres', false], ['take jazz off', false], ['take jazz out of genres', false]]) {
    assert.deepEqual(interpret(said, genres), { type: 'select-option', targetId: 1, optionIndex: 1, optionName: 'Jazz', selected }, said);
  }
  assert.deepEqual(interpret('choose rock, jazz and classical', genres),
    { type: 'select-option', targetId: 1, optionIndex: 0, optionIndexes: [0, 1, 2], optionName: 'Rock, Jazz and Classical', selected: true });
  assert.deepEqual(interpret('remove rock and jazz from genres', genres).optionIndexes, [0, 1]);
  // A name that is itself a choice is not split.
  assert.deepEqual(interpret('choose rock and roll', context(list(1, 'Genres', { options: ['Rock', 'Rock and roll'] }))).optionIndex, 1);
  // A part that names no choice, or two, leaves the words to other commands.
  assert.notEqual(interpret('choose rock and polka', genres).optionIndexes?.length, 2);
});
test('options of a listbox that takes several are added and taken off by name, never clicked', () => {
  const option = (id, name, chosen = false) => ({ id, name, role: 'option', distance: id, multiChoice: true, chosen, listName: 'Upgrades' });
  const upgrades = context(option(1, 'Leather seats'), option(2, 'Front seat warmers', true), option(3, 'Rear bucket seats'));
  assert.deepEqual(interpret('choose leather seats', upgrades), { type: 'choose-option', targetId: 1, optionName: 'Leather seats' });
  assert.deepEqual(interpret('select front seat warmers', upgrades), { type: 'choose-option', targetId: 2, optionName: 'Front seat warmers' });
  assert.deepEqual(interpret('deselect front seat warmers', upgrades), { type: 'choose-option', targetId: 2, optionName: 'Front seat warmers', selected: false });
  assert.deepEqual(interpret('add leather seats and rear bucket seats to upgrades', upgrades),
    { type: 'choose-option', targetId: 1, optionName: 'Leather seats and Rear bucket seats', optionNames: ['Leather seats', 'Rear bucket seats'] });
  // A checkbox of the name is still ticked and unticked as a checkbox.
  const box = { id: 9, name: 'Leather seats', role: 'checkbox', distance: 0, checked: true };
  assert.equal(interpret('untick leather seats', context(box, option(1, 'Leather seats', true))).type, 'check');
});
test('a combobox showing its choices as chips has one taken off by name, and is added to', () => {
  const films = { id: 1, name: 'Favorites', role: 'combobox', distance: 0, customList: true, editable: true, chosenNames: ['Inception', 'The Godfather'] };
  const chip = { id: 2, name: 'Inception', role: 'button', distance: 5 };
  const page = context(films, chip, { id: 3, name: 'Add to basket', role: 'button', distance: 40 });
  assert.deepEqual(interpret('remove inception', page), { type: 'choose-option', targetId: 1, optionName: 'inception', selected: false });
  assert.deepEqual(interpret('take the godfather off favorites', page), { type: 'choose-option', targetId: 1, optionName: 'the godfather', selected: false });
  // The chip's own button is the list's, so choosing what it names goes to the list, which says it is chosen already.
  // The list itself is not named: outside the circle it would only be offered.
  assert.deepEqual(interpret('choose inception', page), { type: 'choose-option', targetId: 1, optionName: 'inception', related: true });
  assert.deepEqual(interpret('add pulp fiction', page), { type: 'choose-option', targetId: 1, optionName: 'pulp fiction', related: true });
  assert.deepEqual(interpret('add pulp fiction to favorites', page), { type: 'choose-option', targetId: 1, optionName: 'pulp fiction' });
  const outside = { elements: [], nearby: [{ ...films, id: 101, distance: 150 }] };
  assert.equal(interpret('add pulp fiction', outside).far, true, 'an unnamed list just outside the circle is offered, not used');
  assert.equal(interpret('add pulp fiction to favorites', outside).far, undefined);
  // A control named by everything said is pressed, and a choice not made is not taken off a list: other rules read the words.
  assert.equal(interpret('add to basket', page).targetId, 3);
  assert.notEqual(interpret('remove the socks', page).type, 'choose-option');
  // Two lists here holding the choice are asked about, however near the gaze each is; named, the one named is meant.
  const tags = { ...films, id: 4, name: 'Tags', distance: 60 };
  const asked = interpret('remove inception', context(films, tags));
  assert.equal(asked.type, 'clarify');
  assert.deepEqual(asked.choose(4), { type: 'choose-option', targetId: 4, optionName: 'inception', selected: false });
  assert.equal(interpret('remove inception from tags', context(films, tags)).targetId, 4);
  // A combobox without chips is added to only with "add", or when it is named.
  const plain = context({ ...films, chosenNames: undefined });
  assert.equal(interpret('add pulp fiction', plain).type, 'choose-option');
  assert.notEqual(interpret('choose pulp fiction', plain).type, 'choose-option');
});
test('quoted option labels keep to and from inside their literal names', () => {
  for (const [said, name, selected] of [['add option "Road to Jazz" to Genres', 'Road to Jazz', true], ['remove option “Songs from home” from Genres', 'Songs from home', false]]) {
    const result = interpret(said, context(list(1, 'Genres', { options: ['Other', name] })));
    assert.deepEqual(result, { type: 'select-option', targetId: 1, optionIndex: 1, optionName: name, selected });
  }
});
