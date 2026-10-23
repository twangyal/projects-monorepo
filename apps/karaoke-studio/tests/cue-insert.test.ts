import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../src/cue-edit.ts';

test('insert a literal missed line between existing cues without altering their timing or words', () => {
  assert.equal(typeof edits.insertCue, 'function');
  const cues = [{ start: 0, end: 1, text: 'First' }, { start: 3, end: 4, text: 'Last' }];
  const before = structuredClone(cues);
  const result = edits.insertCue(cues, 5, '  missed 🌓\r\nline ', '1.25', '2.75');
  assert.deepEqual(result, { insertIndex: 1, cues: [before[0], { start: 1.25, end: 2.75, text: '  missed 🌓\r\nline ' }, before[1]] });
  result.cues[0].text = 'Changed'; assert.deepEqual(cues, before);
});
test('insert works for empty clips and exact adjacent boundaries and refuses invalid whole proposals', () => {
  assert.equal(typeof edits.insertCue, 'function');
  assert.deepEqual(edits.insertCue([], 5, 'Start', '0', '5'), { insertIndex: 0, cues: [{ start: 0, end: 5, text: 'Start' }] });
  const source = [{ start: 1, end: 2, text: 'Middle' }];
  assert.equal(edits.insertCue(source, 5, 'Before', '0', '1').insertIndex, 0);
  assert.equal(edits.insertCue(source, 5, 'After', '2', '5').insertIndex, 1);
  for (const [text, start, end] of [['x', '', '1'], ['x', '0', ' '], ['x', 'NaN', '1'], ['x', '-1', '1'], ['x', '0', '6'], ['x', '1.5', '3'], ['x', '2', '2'], [' ', '2', '3'], ['x'.repeat(241), '2', '3']]) assert.throws(() => edits.insertCue(source, 5, text, start, end));
  assert.throws(() => edits.insertCue([{ start: NaN, end: 2, text: 'Bad' }], 5, 'x', '3', '4'));
  assert.deepEqual(source, [{ start: 1, end: 2, text: 'Middle' }]);
});
test('insertion enforces complete cue and Unicode text budgets', () => {
  assert.equal(typeof edits.insertCue, 'function');
  const cues = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + .5, text: 'a' }));
  assert.throws(() => edits.insertCue(cues, 201, 'x', '200', '201'), /200/);
  const full = Array.from({ length: 100 }, (_, i) => ({ start: i, end: i + .5, text: '🌓'.repeat(200) }));
  assert.throws(() => edits.insertCue(full, 101, 'x', '100', '101'), /20,000/);
});
