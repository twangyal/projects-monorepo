import test from 'node:test';
import assert from 'node:assert/strict';
import { draftCues, validateCues, activeCue, formatTime, type Cue } from '../src/lyrics.ts';

test('draft timing splits nonempty lines over the full duration without invented words', () => {
  assert.deepEqual(draftCues('Hello\n\nSecond line\n', 10), [
    { start: 0, end: 5, text: 'Hello' }, { start: 5, end: 10, text: 'Second line' },
  ]);
  assert.throws(() => draftCues('x\n'.repeat(41), 10));
  assert.throws(() => draftCues('   ', 10));
});
test('cue validation rejects nonfinite, overlapping, outside-duration and oversized data', () => {
  const cue: Cue = { start: 0, end: 1, text: 'First' };
  for (const cues of [[{ ...cue, start: NaN }], [{ ...cue, end: 0 }], [{ ...cue, end: 31 }], [cue, { ...cue, start: .5 }], [{ ...cue, text: '' }], [{ ...cue, text: 'x'.repeat(241) }]]) assert.throws(() => validateCues(cues, 30));
  assert.throws(() => validateCues([cue], Infinity));
  assert.deepEqual(validateCues([cue, { start: 2, end: 3, text: '<literal> & lyrics' }], 10), [cue, { start: 2, end: 3, text: '<literal> & lyrics' }]);
});
test('selection uses exclusive end boundaries and preserves instrumental gaps', () => {
  const cues = [{ start: 1, end: 2, text: 'First' }, { start: 3, end: 5, text: 'Next' }];
  assert.equal(activeCue(cues, .5), -1);
  assert.equal(activeCue(cues, 1), 0);
  assert.equal(activeCue(cues, 2), -1);
  assert.equal(activeCue(cues, 3), 1);
  assert.equal(activeCue(cues, 5), -1);
  assert.equal(formatTime(12.34), '0:12.34');
});
