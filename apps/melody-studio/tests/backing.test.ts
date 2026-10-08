import assert from 'node:assert/strict';
import test from 'node:test';
import { backingComposition, backedFramePlan } from '../src/backing.ts';
import type { Composition } from '../src/types.ts';

function composition(): Composition {
  return { version: 1, title: 'Backing boundary', tempo: 120, tracks: [
    { id: 'destination', name: 'Replace me', instrument: 'sawtooth', volume: 1, muted: false,
      notes: [{ id: 'old-target', pitch: 96, start: 0, duration: 16, velocity: 1 }] },
    { id: 'quiet', name: 'Muted but retained', instrument: 'triangle', volume: .3, muted: true,
      notes: [{ id: 'quiet-note', pitch: 48, start: .137, duration: .333, velocity: .21 }] },
    { id: 'backing', name: 'Actual accompaniment', instrument: 'sine', volume: .7, muted: false,
      notes: [{ id: 'early', pitch: 60, start: .25, duration: .75, velocity: .4 },
        { id: 'late', pitch: 72, start: 100, duration: 16, velocity: 1 }] },
  ] };
}

test('backing removes the complete target and retains a detached full mix including late and muted notes', () => {
  const source = composition(), before = structuredClone(source);
  const result = backingComposition(source, 'destination');
  assert.deepEqual(result, { ...before, tracks: before.tracks.slice(1) });
  assert.deepEqual(source, before);
  result.tracks[1].notes[0].pitch = 36;
  result.tracks[0].volume = 0;
  assert.deepEqual(source, before);
});

test('audible eligibility excludes target, mute, zero volume/velocity and starts at or after twenty seconds', () => {
  for (const change of ['mute', 'volume', 'velocity', 'late', 'empty'] as const) {
    const source = composition(), track = source.tracks[2];
    if (change === 'mute') track.muted = true;
    if (change === 'volume') track.volume = 0;
    if (change === 'velocity') track.notes[0].velocity = 0;
    if (change === 'late') track.notes[0].start = 40;
    if (change === 'empty') track.notes = [];
    const before = structuredClone(source);
    assert.throws(() => backingComposition(source, 'destination'), /backing/i);
    assert.deepEqual(source, before);
  }
  const source = composition();
  source.tracks[2].notes[0].start = 39.999;
  assert.equal(backingComposition(source, 'destination').tracks.length, 2);
  source.tempo = 60;
  assert.throws(() => backingComposition(source, 'destination'));
  source.tempo = 240;
  assert.equal(backingComposition(source, 'destination').tempo, 240);
});

test('target and complete composition validation precede any backing publication', () => {
  assert.throws(() => backingComposition(composition(), 'missing'));
  assert.throws(() => backingComposition(composition(), '' as string));
  const only = composition(); only.tracks = [only.tracks[0]];
  assert.throws(() => backingComposition(only, 'destination'));
  const invalid = composition(); invalid.tracks[0].notes[0].pitch = 97;
  assert.throws(() => backingComposition(invalid, 'destination'));
});

test('frame plans use absolute independently rounded click positions and exclude one four-beat count-in', () => {
  assert.deepEqual(backedFramePlan(48000, 120, 0), {
    sampleRate: 48000, countInFrame: 4800, clickFrames: [4800, 28800, 52800, 76800],
    startFrame: 100800, limitFrame: 1060800, maxFrames: 960000,
  });
  assert.deepEqual(backedFramePlan(192000, 40, 0), {
    sampleRate: 192000, countInFrame: 19200, clickFrames: [19200, 307200, 595200, 883200],
    startFrame: 1171200, limitFrame: 5011200, maxFrames: 3840000,
  });
  const plan = backedFramePlan(44100, 137, .00001);
  assert.deepEqual(plan.clickFrames, [4411, 23725, 43039, 62353]);
  assert.equal(plan.startFrame, 81666);
  assert.equal(plan.limitFrame, 963666);
  const another = backedFramePlan(44100, 137, .00001);
  assert.notEqual(plan.clickFrames, another.clickFrames);
});

test('invalid clock/rate/tempo or unsafe integer-frame sums refuse instead of rounding or clamping', () => {
  for (const rate of [7999, 192001, 44100.5, NaN, Infinity]) assert.throws(() => backedFramePlan(rate, 120, 0));
  for (const tempo of [39, 241, NaN, Infinity]) assert.throws(() => backedFramePlan(48000, tempo, 0));
  for (const now of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => backedFramePlan(48000, 120, now));
  assert.equal(backedFramePlan(8000, 240, .125).countInFrame, 1800);
});
