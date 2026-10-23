import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewedCues, reviewedRange, type ReviewedCue } from '../src/automatic-review.ts';
const fixture = (): ReviewedCue[] => [{ start: '.8500', end: '2.75', text: 'Keep café 🎵' }, { start: '', end: 'bad', text: '' }, { start: '8.8', end: '11.75', text: 'Keep last' }];
test('explicit exclusion omits only chosen row while preserving literal reviewed and raw source data', () => {
  const rows = fixture(); Object.assign(rows[1], { excluded: true }); const before = structuredClone(rows);
  assert.deepEqual(reviewedCues(rows, 16), [{ start: .85, end: 2.75, text: 'Keep café 🎵' }, { start: 8.8, end: 11.75, text: 'Keep last' }]); assert.deepEqual(rows, before);
  Object.assign(rows[1], { excluded: false }); assert.throws(() => reviewedCues(rows, 16), /Line 2/);
});
test('included hidden errors retain original row numbers after omitted rows', () => {
  const rows = fixture(); Object.assign(rows[1], { excluded: true }); rows[2].text = '';
  assert.throws(() => reviewedCues(rows, 16), /Line 3/); rows[2].text = 'Keep last'; rows[2].start = '2';
  assert.throws(() => reviewedCues(rows, 16), /Line 3/);
});
test('all excluded is an explicit empty edit while audition remains independent', () => {
  const rows = fixture(); rows[1] = { start: '4', end: '5', text: 'Ignore' }; rows.forEach(row => Object.assign(row, { excluded: true }));
  const before = structuredClone(rows); assert.deepEqual(reviewedCues(rows, 16), []); assert.equal(reviewedRange(rows, 16, 1).start, 4); assert.deepEqual(rows, before);
  assert.throws(() => reviewedCues(rows, NaN));
});
test('nonboolean exclusion and over-limit source arrays refuse without bypassing admission', () => {
  for (const excluded of ['true', 1, null]) { const rows = fixture(); Object.assign(rows[1], { excluded }); assert.throws(() => reviewedCues(rows, 16), /exclu|boolean/i); }
  const rows = Array.from({ length: 201 }, () => ({ start: '0', end: '1', text: '', excluded: true })); assert.throws(() => reviewedCues(rows, 16), /200/);
});
