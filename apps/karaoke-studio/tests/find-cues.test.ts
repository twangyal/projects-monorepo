import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCueIndices, nextCueMatch } from '../src/find-cues.ts';
const cues = [{ start: 0, end: 1, text: 'CAFÉ 🌓 [chorus]' }, { start: 2, end: 3, text: 'Other words' }, { start: 4, end: 5, text: 'café 🌓 repeated' }];
test('find matches Unicode text case-insensitively and treats punctuation literally', () => {
  assert.deepEqual(findCueIndices(cues, 'café 🌓'), [0, 2]);
  assert.deepEqual(findCueIndices(cues, '[chorus]'), [0]);
  assert.deepEqual(findCueIndices(cues, '.*'), []);
  assert.deepEqual(findCueIndices(cues, '  '), []);
  assert.deepEqual(findCueIndices(cues, ' café'), []);
});
test('find does not require valid timing or mutate current corrections', () => {
  const broken = [{ start: NaN, end: 1, text: 'Correct me' }];
  assert.deepEqual(findCueIndices(broken, 'correct'), [0]); assert.ok(Number.isNaN(broken[0].start));
});
test('next/previous wrap and a retired or missing choice starts at the proper edge', () => {
  assert.equal(nextCueMatch([1, 4, 9], null, 1), 1);
  assert.equal(nextCueMatch([1, 4, 9], null, -1), 9);
  assert.equal(nextCueMatch([1, 4, 9], 9, 1), 1);
  assert.equal(nextCueMatch([1, 4, 9], 1, -1), 9);
  assert.equal(nextCueMatch([1, 4, 9], 3, 1), 1);
  assert.equal(nextCueMatch([], 3, 1), null);
});
