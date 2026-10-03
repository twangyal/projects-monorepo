import test from 'node:test';
import assert from 'node:assert/strict';
import { editText } from '../src/text-entry.js';

test('inserts at the caret and replaces selected text', () => {
  assert.deepEqual(editText('hello', 2, 2, 'X', 100), { value: 'heXllo', caret: 3 });
  assert.deepEqual(editText('hello', 1, 4, 'a', 100), { value: 'hao', caret: 2 });
});

test('backspace removes a selection or previous Unicode code point', () => {
  assert.deepEqual(editText('a😀b', 3, 3, 'Backspace', 100), { value: 'ab', caret: 1 });
  assert.deepEqual(editText('hello', 1, 4, 'Backspace', 100), { value: 'ho', caret: 1 });
  assert.deepEqual(editText('hello', 0, 0, 'Backspace', 100), { value: 'hello', caret: 0 });
});

test('respects field limits without splitting a surrogate pair', () => {
  assert.deepEqual(editText('abc', 3, 3, 'd', 3), { value: 'abc', caret: 3 });
  assert.deepEqual(editText('a', 1, 1, '😀', 2), { value: 'a', caret: 1 });
});
