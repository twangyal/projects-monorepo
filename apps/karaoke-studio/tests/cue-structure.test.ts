import test from 'node:test';
import assert from 'node:assert/strict';
import * as structure from '../src/cue-structure.ts';
import type { Cue } from '../src/lyrics.ts';

const cues: Cue[] = [
  { start: .125, end: 2.875, text: '  Café 🌓 chorus  ' },
  { start: 3.5, end: 5.75, text: 'Next\nliteral line' },
];
test('split retains literal Unicode halves, exact source endpoints and unrelated cues without mutation', () => {
  const before = structuredClone(cues);
  const result = structure.splitCue(cues, 6, 0, 10, 10, 1.123456);
  assert.deepEqual(result, [
    { start: .125, end: 1.123456, text: '  Café 🌓 ' },
    { start: 1.123456, end: 2.875, text: 'chorus  ' }, cues[1],
  ]);
  result[2].text = 'independent'; assert.deepEqual(cues, before);
});
test('merge spans the existing gap and inserts exactly one literal newline', () => {
  const before = structuredClone(cues);
  assert.deepEqual(structure.mergeCue(cues, 6, 0), [{ start: .125, end: 5.75, text: '  Café 🌓 chorus  \nNext\nliteral line' }]);
  assert.deepEqual(cues, before);
});
test('split refuses ranges, surrogate interiors, invalid indices and empty halves without changing sources', () => {
  for (const [start, end] of [[0, 0], [18, 18], [8, 8], [2, 3], [2.5, 2.5], [1, 1], [-1, -1]]) {
    assert.throws(() => structure.splitCue(cues, 6, 0, start, end, 1.5));
  }
  for (const index of [-1, .5, 2, NaN]) assert.throws(() => structure.splitCue(cues, 6, index, 10, 10, 1.5));
  assert.deepEqual(cues[0], { start: .125, end: 2.875, text: '  Café 🌓 chorus  ' });
});
test('split refuses endpoints and nonfinite/outside playheads', () => {
  for (const time of [.125, 2.875, -1, 3, NaN, Infinity]) assert.throws(() => structure.splitCue(cues, 6, 0, 10, 10, time));
});
test('entire invalid timing or text graph prevents both structure actions', () => {
  for (const invalid of [
    [cues[0], { ...cues[1], start: 2 }], [cues[0], { ...cues[1], end: NaN }],
    [cues[0], { ...cues[1], text: '' }], [cues[0], { ...cues[1], text: '\ud800' }],
  ]) {
    assert.throws(() => structure.splitCue(invalid, 6, 0, 10, 10, 1.5));
    assert.throws(() => structure.mergeCue(invalid, 6, 0));
  }
});
test('cue-count boundary permits 199 to 200, refuses 200 to 201 and permits merge reduction', () => {
  const maximum = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 1, text: 'ab' }));
  assert.equal(structure.splitCue(maximum.slice(0, 199), 300, 0, 1, 1, .5).length, 200);
  assert.throws(() => structure.splitCue(maximum, 300, 0, 1, 1, .5));
  assert.equal(structure.mergeCue(maximum, 300, 0).length, 199);
});
test('merge enforces Unicode per-cue and total-text limits including its new separator', () => {
  const source = [{ start: 0, end: 1, text: '🌓'.repeat(120) }, { start: 2, end: 3, text: 'Ω'.repeat(119) }];
  assert.equal(Array.from(structure.mergeCue(source, 6, 0)[0].text).length, 240);
  assert.throws(() => structure.mergeCue([{ ...source[0], text: '🌓'.repeat(121) }, source[1]], 6, 0));
  const total = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 1, text: 'x'.repeat(100) }));
  assert.throws(() => structure.mergeCue(total, 300, 0));
  total[199].text = 'x'.repeat(99); assert.equal(structure.mergeCue(total, 300, 0).reduce((n, c) => n + c.text.length, 0), 20000);
  for (const i of [-1, .5, 1, NaN]) assert.throws(() => structure.mergeCue(cues, 6, i));
});
