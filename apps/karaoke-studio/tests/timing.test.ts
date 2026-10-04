import assert from 'node:assert/strict';
import test from 'node:test';
import { timingError, proposeBoundary, quantizeBoundaryDelta, timeWindow, timeToPixel, pixelToTime } from '../src/timing.ts';
import type { Cue } from '../src/lyrics.ts';
import { LyricHistory } from '../src/draft-history.ts';

const cues = (): Cue[] => [{ start: 0, end: 1.234567, text: '' }, { start: 1.234567, end: 2.3456789, text: '\0invalid text kept' }];

test('timing-only validity ignores invalid lyric text and permits adjacency and gaps', () => {
  assert.equal(timingError(cues(), 3), null);
  assert.equal(timingError([], 1), null);
  assert.equal(timingError([{ start: 0, end: 300, text: 'x'.repeat(1_000_000) }], 300), null);
  assert.equal(timingError([{ start: 0.25, end: 0.5, text: '' }, { start: 0.75, end: 1, text: '' }], 1), null);
});

test('timing validation rejects nonfinite, reversed, overlapping and out-of-clip intervals', () => {
  for (const duration of [NaN, Infinity, 0, 0.999, 300.001]) assert.ok(timingError([], duration));
  for (const value of [
    [{ start: -0.01, end: 1, text: '' }], [{ start: 1, end: 1, text: '' }],
    [{ start: 1.1, end: 1, text: '' }], [{ start: 0, end: 3.01, text: '' }],
    [{ start: NaN, end: 1, text: '' }], [{ start: 0, end: Infinity, text: '' }],
    [{ start: 0, end: 2, text: '' }, { start: 1, end: 3, text: '' }],
  ]) assert.ok(timingError(value, 3));
  assert.ok(timingError(Array.from({ length: 201 }, (_, i) => ({ start: i, end: i + 1, text: '' })), 300));
  assert.ok(timingError(null as unknown as Cue[], 3));
  assert.ok(timingError([null] as unknown as Cue[], 3));
  assert.ok(timingError(new Array<Cue>(1), 3));
});

test('boundary proposal is detached, changes one number and preserves arbitrary invalid text exactly', () => {
  const original = cues();
  const before = structuredClone(original);
  const next = proposeBoundary(original, 3, 1, 'end', 2.3556789);
  assert.deepEqual(next, [before[0], { ...before[1], end: 2.3556789 }]);
  assert.notEqual(next, original);
  for (let i = 0; i < next.length; i++) assert.notEqual(next[i], original[i]);
  next[0].text = 'changed copy';
  assert.deepEqual(original, before);
});

test('invalid boundary proposals are atomic and do not silently clamp to adjacent cues', () => {
  const original = cues(), before = structuredClone(original);
  for (const [index, boundary, value] of [[0, 'end', 1.24], [1, 'start', 1.23], [1, 'end', 1], [0, 'start', -1], [1, 'end', 3.01], [0, 'end', NaN], [-1, 'end', 1], [0.5, 'end', 1], [2, 'end', 1], [0, 'other', 1]] as const) {
    assert.throws(() => proposeBoundary(original, 3, index, boundary as 'end', value));
    assert.deepEqual(original, before);
  }
  assert.throws(() => proposeBoundary([{ start: 0, end: NaN, text: '' }], 3, 0, 'end', 1));
  assert.deepEqual(proposeBoundary(original, 3, 0, 'end', 1.234567), original);
});

test('relative10ms quantization preserves off-grid fractions and explicitly defines half ties', () => {
  const original = 1.234567;
  for (const ticks of [-100, -10, -1, 0, 1, 10, 100]) {
    assert.equal(quantizeBoundaryDelta(original, ticks / 100, 3), original + ticks / 100);
  }
  assert.equal(quantizeBoundaryDelta(original, .0049, 3), original);
  assert.equal(quantizeBoundaryDelta(original, .005, 3), original + .01);
  assert.equal(quantizeBoundaryDelta(original, -.005, 3), original);
  assert.equal(quantizeBoundaryDelta(original, -.0051, 3), original - .01);
  assert.ok(Object.is(quantizeBoundaryDelta(-0, 0, 3), -0));
});

test('outer boundaries retain exact clip duration even when neither endpoint is10ms aligned', () => {
  const duration = 44101 / 44100;
  assert.equal(quantizeBoundaryDelta(.333333, duration - .333333, duration), duration);
  assert.equal(quantizeBoundaryDelta(.333333, 100, duration), duration);
  assert.equal(quantizeBoundaryDelta(.004567, -.004567, duration), 0);
  assert.equal(quantizeBoundaryDelta(.004567, -100, duration), 0);
  assert.equal(quantizeBoundaryDelta(duration, 0, duration), duration);
  assert.equal(proposeBoundary([{ start: 0, end: 1, text: '' }], duration, 0, 'end', duration)[0].end, duration);
  for (const [original, delta, length] of [[NaN, 0, 3], [-1, 0, 3], [4, 0, 3], [1, Infinity, 3], [1, 0, NaN]]) {
    assert.throws(() => quantizeBoundaryDelta(original, delta, length));
  }
});

test('window placement clips short songs and clamps at both ends without changing the span', () => {
  assert.deepEqual(timeWindow(300, 60, 150), { start: 120, end: 180 });
  assert.deepEqual(timeWindow(300, 15, -10), { start: 0, end: 15 });
  assert.deepEqual(timeWindow(300, 5, 400), { start: 295, end: 300 });
  assert.deepEqual(timeWindow(44101 / 44100, 60, .5), { start: 0, end: 44101 / 44100 });
  assert.throws(() => timeWindow(300, 10 as 5, 20));
  assert.throws(() => timeWindow(300, 5, NaN));
});

test('coordinate helpers clamp and return exact endpoints without snapping cue precision', () => {
  const window = { start: 1.234567, end: 6.234567 };
  assert.equal(timeToPixel(window.start, window, 1000), 0);
  assert.equal(timeToPixel(window.end, window, 1000), 1000);
  assert.equal(timeToPixel(3.734567, window, 1000), 500);
  assert.equal(pixelToTime(500, window, 1000), 3.734567);
  assert.equal(pixelToTime(-1, window, 1000), window.start);
  assert.equal(pixelToTime(1001, window, 1000), window.end);
  assert.equal(timeToPixel(-100, window, 1000), 0);
  assert.equal(timeToPixel(999, window, 1000), 1000);
  for (const width of [0, -1, NaN, Infinity, 8193]) {
    assert.throws(() => timeToPixel(2, window, width));
    assert.throws(() => pixelToTime(20, window, width));
  }
  for (const invalid of [{ start: 2, end: 2 }, { start: -1, end: 3 }, { start: 0, end: 301 }, { start: 0, end: NaN }]) {
    assert.throws(() => pixelToTime(10, invalid, 100));
  }
});


test('one valid boundary proposal integrates with exact undo and invalid attempts preserve redo', () => {
  const initial = { title: '', cues: cues(), pastedText: ' kept raw\n', pastedDirty: true };
  const history = new LyricHistory(initial);
  const next = { ...initial, cues: proposeBoundary(initial.cues, 3, 1, 'end', quantizeBoundaryDelta(initial.cues[1].end, .01, 3)) };
  history.record(next);
  assert.deepEqual(history.undo(), initial);
  assert.equal(history.canUndo, false);
  assert.throws(() => proposeBoundary(initial.cues, 3, 0, 'end', 2));
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), next);
  assert.equal(history.current.cues[0].end, 1.234567);
});
