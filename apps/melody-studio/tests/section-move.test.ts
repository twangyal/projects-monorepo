import test from 'node:test';
import assert from 'node:assert/strict';
import * as arrangement from '../src/section-arrangement.ts';
import type { Composition, Note } from '../src/types.ts';
const note = (id: string, start: number, duration = .5): Note => ({ id, start, duration, pitch: 60, velocity: .7 });
const fixture = (): Composition => ({ version: 1, title: 'Relocate phrase', tempo: 120, tracks: [
  { id: 'lead', name: 'Lead', instrument: 'sine', volume: .4, muted: false, notes: [note('left', 0), note('phrase', 1.25, .75), note('edge', 2.5, .5), note('later', 4)] },
  { id: 'bass', name: 'Muted bass', instrument: 'triangle', volume: .3, muted: true, notes: [note('bass-note', 1.5), note('far', 9)] },
] });
const range = { start: '2', end: '4' };
test('relocates every whole selected note with literal offsets and intact independent metadata', () => {
  const input = fixture(); input.tracks[0].volumeRamp = { start: 1, end: 8, from: .2, to: .8 }; input.tracks[1].envelope = { attack: .2, decay: .1, sustain: .6, release: .4 };
  const before = structuredClone(input), expected = structuredClone(input);
  expected.tracks[0].notes[1].start = 6.25; expected.tracks[0].notes[2].start = 7.5; expected.tracks[1].notes[0].start = 6.5;
  const output = arrangement.moveSection(input, range, '7');
  assert.deepEqual(output, expected); assert.deepEqual(input, before);
  assert.deepEqual(arrangement.moveSection(output, { start: '7', end: '9' }, '2'), before, 'backward relocation restores the exact original graph');
  output.tracks[0].notes[0].pitch = 72; assert.deepEqual(input, before);
});
test('fractional move permits overlap with vacated notes, exact contact and unchanged position', () => {
  const input = fixture(); input.tracks[0].notes = [note('fractional', 1.125, .75), note('right', 4, .5)]; input.tracks[1].notes = [];
  const before = structuredClone(input);
  const output = arrangement.moveSection(input, { start: '2.125', end: '3.375' }, '3.75');
  assert.deepEqual(output.tracks[0].notes.map(n => [n.id, n.start, n.duration]), [['fractional', 2.75, .75], ['right', 4, .5]]);
  assert.deepEqual(arrangement.moveSection(input, { start: '2.125', end: '3.375' }, '2.125'), before);
  assert.equal(arrangement.moveSection(input, { start: '2.125', end: '3.375' }, '2.25').tracks[0].notes[0].start, 1.25);
  assert.deepEqual(input, before);
});
test('unselected destination intersections including silent gaps and muted tracks refuse atomically', () => {
  for (const occupied of [note('collision', 5.75), note('collision', 7.75), note('collision', 5, 4), note('collision', 6, .25)]) {
    const input = fixture(); input.tracks[1].notes.push(occupied); const before = structuredClone(input);
    assert.throws(() => arrangement.moveSection(input, range, '7'), /destination.*(occupied|note)|note.*destination/i); assert.deepEqual(input, before);
  }
});
test('source splits, empty source and malformed or over-capacity destinations retain input', () => {
  for (const crossing of [note('cross', .75, .5), note('cross', 2.75, .5), note('cross', 0, 4)]) {
    const p = fixture(); p.tracks[1].notes.push(crossing); const before = structuredClone(p);
    assert.throws(() => arrangement.moveSection(p, range, '20'), /crosses/); assert.deepEqual(p, before);
  }
  const p = fixture(), before = structuredClone(p);
  assert.throws(() => arrangement.moveSection(p, { start: '6', end: '7' }, '20'), /no notes/);
  for (const value of ['', ' ', '-', 'NaN', 'Infinity', '0', '-1', '512', '1e100']) assert.throws(() => arrangement.moveSection(p, range, value));
  assert.deepEqual(p, before);
});
test('exact timeline capacity and destination adjacency retain all note identities', () => {
  const p = fixture(); p.tracks[1].notes = [note('left-contact', 5, 1), note('right-contact', 8)];
  assert.deepEqual(arrangement.moveSection(p, range, '7').tracks[1].notes, p.tracks[1].notes);
  const end = arrangement.moveSection(fixture(), range, '511');
  assert.equal(end.tracks[0].notes.find(n => n.id === 'edge')!.start + .5, 512);
});
