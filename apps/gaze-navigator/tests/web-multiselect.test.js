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
  assert.equal(interpret('choose Jazz from Genres', context(list())).selected, undefined);
});
test('quoted option labels keep to and from inside their literal names', () => {
  for (const [said, name, selected] of [['add option "Road to Jazz" to Genres', 'Road to Jazz', true], ['remove option “Songs from home” from Genres', 'Songs from home', false]]) {
    const result = interpret(said, context(list(1, 'Genres', { options: ['Other', name] })));
    assert.deepEqual(result, { type: 'select-option', targetId: 1, optionIndex: 1, optionName: name, selected });
  }
});
