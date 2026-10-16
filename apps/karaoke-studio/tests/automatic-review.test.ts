import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewedCues, reviewedRange } from '../src/automatic-review.ts';

const draft = () => [{ start: '0.8500', end: '2.75', text: 'Hello 🎵\nworld' }, { start: '4.', end: '5.95e0', text: 'Chorus' }];
test('review converts literal numeric drafts without mutating text or raw spellings', () => {
  const rows = draft(), before = structuredClone(rows);
  assert.deepEqual(reviewedCues(rows, 16), [{ start: .85, end: 2.75, text: 'Hello 🎵\nworld' }, { start: 4, end: 5.95, text: 'Chorus' }]);
  assert.deepEqual(rows, before);
});
test('complete review refuses empty nondecimal nonfinite overlapping and out-of-clip timings', () => {
  for (const value of ['', ' ', '0x1', 'Infinity', 'NaN', '-1', '16']) {
    const rows = draft(); rows[0].start = value;
    assert.throws(() => reviewedCues(rows, 16), /Line 1/);
  }
  for (const [start, end] of [['2.5', '5.95'], ['4', '4'], ['4', '16.01']]) {
    const rows = draft(); rows[1] = { start, end, text: 'Chorus' };
    assert.throws(() => reviewedCues(rows, 16), /Line 2/);
  }
  const rows = draft(); rows[1].text = ''; assert.throws(() => reviewedCues(rows, 16), /Line 2/);
});
test('audition admits only the chosen staged interval even with other invalid drafts or empty text', () => {
  const rows = draft(); rows[0].start = ''; rows[1] = { start: '6.125', end: '7.875', text: '' };
  const range = reviewedRange(rows, 16, 1);
  assert.equal(range.start, 6.125); assert.equal(range.end, 7.875); assert.equal(range.clipDuration, 16);
  assert.throws(() => reviewedRange(rows, 16, 0), /Line 1/);
  assert.throws(() => reviewedRange(rows, 16, 2), /existing/);
  rows[1].end = '6'; assert.throws(() => reviewedRange(rows, 16, 1), /Line 2/);
});
