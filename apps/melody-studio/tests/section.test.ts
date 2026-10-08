import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionWindow, cropSection } from '../src/section.ts';
import { renderComposition } from '../src/audio.ts';
import { createDemoComposition } from '../src/model.ts';

test('one-based exclusive beats round to native frames at fractional tempo', () => {
  const w = sectionWindow('2.25', '5.5', 137, 8, 22050);
  assert.equal(w.startFrame, Math.round(1.25 * 60 / 137 * 22050));
  assert.equal(w.endFrame, Math.round(4.5 * 60 / 137 * 22050));
});
test('rejects blank, invalid, reversed, out-of-song and subframe ranges', () => {
  for (const [start, end] of [['', '2'], ['1', ' '], ['NaN', '2'], ['1', 'Infinity'], ['0','2'], ['2','2'], ['3','2'], ['1','9.01'], ['1','1.000000001']]) {
    assert.throws(() => sectionWindow(start, end, 120, 8, 22050));
  }
  assert.throws(() => sectionWindow('1','2', 0, 8, 22050));
  assert.throws(() => sectionWindow('1','2',120, 8, NaN));
  assert.throws(() => sectionWindow('1','2',120, 0, 22050));
  assert.equal(sectionWindow('1', '9', 120, 8, 22050).endFrame, 88200);
});
test('crop preserves crossing-note PCM and whole-mix normalization exactly', () => {
  const p = createDemoComposition();
  p.tracks[0].notes[0].duration = 4;
  const samples = renderComposition(p, 22050);
  const w = sectionWindow('2', '4', p.tempo, 8, 22050);
  const before = samples.slice();
  const cropped = cropSection(samples, w);
  assert.deepEqual(cropped, samples.slice(w.startFrame, w.endFrame));
  assert.equal(cropped.length, w.endFrame - w.startFrame);
  cropped[0] = 99;
  assert.deepEqual(samples, before);
});
test('refuses invalid frame bounds rather than silently padding or truncating', () => {
  const samples = new Float32Array(10);
  for (const w of [{startFrame: -1,endFrame: 4}, {startFrame: 3,endFrame: 3}, {startFrame: 0,endFrame: 11}, {startFrame: .5,endFrame: 4}]) assert.throws(() => cropSection(samples,w));
});
