import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyCues } from '../src/cue-edit.ts';
const cues = [{ start: 1, end: 1.5, text: 'Literal 🌓\r\nwords' }, { start: 2, end: 2.5, text: 'Chorus' }, { start: 5, end: 6, text: 'Final' }];
test('copy preserves originals literal words lengths gaps and returns insertion index', () => {
  const original = structuredClone(cues), result = copyCues(cues, 10, '3', { firstIndex: 0, lastIndex: 1 });
  assert.equal(result.insertIndex, 2); assert.deepEqual(result.cues, [...cues.slice(0, 2), { ...cues[0], start: 3, end: 3.5 }, { ...cues[1], start: 4, end: 4.5 }, cues[2]]);
  assert.deepEqual(cues, original); assert.notEqual(result.cues[0], cues[0]);
  assert.equal(copyCues(cues, 10, '0', { firstIndex: 0, lastIndex: 0 }).insertIndex, 0);
});
test('invalid destinations ranges and invalid full graph refuse without mutation', () => {
  const original = structuredClone(cues);
  for (const raw of ['', 'NaN', 'Infinity', '0x2', '-1', '1', '4', '9']) assert.throws(() => copyCues(cues, 10, raw, { firstIndex: 0, lastIndex: 1 }));
  for (const range of [{ firstIndex: -1, lastIndex: 1 }, { firstIndex: 1, lastIndex: 0 }, { firstIndex: 0, lastIndex: 3 }, { firstIndex: .5, lastIndex: 1 }]) assert.throws(() => copyCues(cues, 10, '3', range));
  assert.throws(() => copyCues([...cues, { start: 7, end: 8, text: '' }], 10, '3', { firstIndex: 0, lastIndex: 1 }));
  const sparse = cues.slice(); delete sparse[1]; assert.throws(() => copyCues(sparse, 10, '3', { firstIndex: 0, lastIndex: 0 }));
  assert.deepEqual(cues, original);
});
test('copy permits touching endpoints but enforces whole-project cue and text limits', () => {
  assert.equal(copyCues(cues, 10, '2.5', { firstIndex: 0, lastIndex: 1 }).cues[2].start, 2.5);
  const many = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + .5, text: 'x' }));
  assert.throws(() => copyCues(many, 600, '300', { firstIndex: 0, lastIndex: 0 }));
  const long = Array.from({ length: 100 }, (_, i) => ({ start: i, end: i + .5, text: 'x'.repeat(200) }));
  assert.throws(() => copyCues(long, 600, '300', { firstIndex: 0, lastIndex: 0 }));
});
