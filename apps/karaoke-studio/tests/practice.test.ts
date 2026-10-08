import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeRange, practiceBoundary, type PracticeMode, type PracticeRange } from '../src/practice.ts';
import type { Cue } from '../src/lyrics.ts';

const supplied = (): Cue[] => [
  { start: .123456789, end: 1.987654321, text: '  Café 🎵\n first  ' },
  { start: 3.123456789, end: 4.987654321, text: '\ufeffSecond\r\nline' },
  { start: 6.123456789, end: 7.987654321, text: 'Last' },
];

test('a single-line practice range retains exact fractional endpoints', () => {
  assert.deepEqual(createPracticeRange(supplied(), 10, 1, 1), {
    firstIndex: 1, lastIndex: 1, start: 3.123456789, end: 4.987654321, clipDuration: 10,
  });
});

test('inclusive cue selection spans its complete instrumental gaps', () => {
  const range = createPracticeRange(supplied(), 10, 0, 2);
  assert.deepEqual(range, { firstIndex: 0, lastIndex: 2, start: .123456789, end: 7.987654321, clipDuration: 10 });
  assert.equal(practiceBoundary(range, 'once', 2.5), 'continue');
  assert.equal(practiceBoundary(range, 'repeat', 5.5), 'continue');
});

test('practice snapshots are frozen and detached while all literal cue text stays untouched', () => {
  const cues = supplied(), original = structuredClone(cues);
  cues.forEach(Object.freeze); Object.freeze(cues);
  const range = createPracticeRange(cues, 10, 0, 2);
  assert.equal(Object.isFrozen(range), true);
  assert.deepEqual(cues, original);
  assert.throws(() => { (range as { start: number }).start = 0; }, TypeError);
  const mutable = supplied(), detached = createPracticeRange(mutable, 10, 0, 2);
  mutable[0].start = 0; mutable[2].end = 9; mutable.splice(1, 1);
  assert.deepEqual(detached, range);
});

test('empty or incomplete cue graphs cannot create a practice range', () => {
  assert.throws(() => createPracticeRange([], 10, 0, 0));
  const sparse = supplied(); delete sparse[1];
  assert.throws(() => createPracticeRange(sparse, 10, 0, 0));
  for (const cues of [null, undefined, {}, 'lyrics']) {
    assert.throws(() => createPracticeRange(cues as unknown as Cue[], 10, 0, 0));
  }
});

test('selection rejects reversed, fractional, nonfinite, missing and outside cue indices', () => {
  for (const index of [-1, .5, 3, NaN, Infinity, -Infinity, undefined, '1', null]) {
    assert.throws(() => createPracticeRange(supplied(), 10, index as number, 2));
    assert.throws(() => createPracticeRange(supplied(), 10, 0, index as number));
  }
  assert.throws(() => createPracticeRange(supplied(), 10, 2, 1));
});

test('invalid timing or text outside the selected line still prevents practice', () => {
  for (const patch of [
    { start: 4 }, { start: NaN }, { end: 11 }, { end: Infinity }, { end: 6 },
    { text: '' }, { text: '\u0085\u001f' }, { text: 'x\0y' }, { text: '\ud800' }, { text: '🎵'.repeat(241) },
  ]) {
    const cues = supplied(); Object.assign(cues[2], patch);
    const before = structuredClone(cues);
    assert.throws(() => createPracticeRange(cues, 10, 0, 0));
    assert.deepEqual(cues, before);
  }
});

test('clip duration accepts its existing exact bounds and rejects values beyond them', () => {
  const cue = [{ start: 0, end: 1, text: 'One' }];
  assert.equal(createPracticeRange(cue, 1, 0, 0).clipDuration, 1);
  assert.equal(createPracticeRange(cue, 300, 0, 0).clipDuration, 300);
  for (const duration of [.999999, 300.000001, -1, 0, NaN, Infinity, '10', null]) {
    assert.throws(() => createPracticeRange(cue, duration as number, 0, 0));
  }
});

test('all 200 cues and 20000 Unicode code points are admitted before choosing the final line', () => {
  const cues = Array.from({ length: 200 }, (_, index) => ({
    start: index * 1.5, end: (index + 1) * 1.5, text: '🎵'.repeat(100),
  }));
  assert.deepEqual(createPracticeRange(cues, 300, 199, 199), {
    firstIndex: 199, lastIndex: 199, start: 298.5, end: 300, clipDuration: 300,
  });
  assert.deepEqual(createPracticeRange(cues, 300, 0, 199), {
    firstIndex: 0, lastIndex: 199, start: 0, end: 300, clipDuration: 300,
  });
  cues[0].text += '🎵';
  assert.throws(() => createPracticeRange(cues, 300, 199, 199));
  const tooMany = Array.from({ length: 201 }, (_, index) => ({ start: index, end: index + 1, text: 'x' }));
  assert.throws(() => createPracticeRange(tooMany, 300, 0, 0));
});

test('boundary decisions use the exact half-open interval without rounding or tolerance', () => {
  const range: PracticeRange = { firstIndex: 0, lastIndex: 1, start: .123456789, end: 4.987654321, clipDuration: 10 };
  for (const mode of ['once', 'repeat'] as const) {
    assert.equal(practiceBoundary(range, mode, range.start), 'continue');
    assert.equal(practiceBoundary(range, mode, range.end - 1e-12), 'continue');
    assert.equal(practiceBoundary(range, mode, range.end), mode === 'once' ? 'finish' : 'repeat');
    assert.equal(practiceBoundary(range, mode, range.end + 1e-12), mode === 'once' ? 'finish' : 'repeat');
    assert.equal(practiceBoundary(range, mode, 10), mode === 'once' ? 'finish' : 'repeat');
    assert.throws(() => practiceBoundary(range, mode, range.start - 1e-12));
  }
});

test('exact natural clip end finishes once or requests a repeat', () => {
  const range = createPracticeRange([{ start: 0, end: 300, text: 'Whole song' }], 300, 0, 0);
  assert.equal(practiceBoundary(range, 'once', 0), 'continue');
  assert.equal(practiceBoundary(range, 'once', 300), 'finish');
  assert.equal(practiceBoundary(range, 'repeat', 300), 'repeat');
});

test('boundary rejects external positions, nonfinite times and values outside the clip', () => {
  const range = createPracticeRange(supplied(), 10, 1, 1);
  for (const time of [0, -1, 3, 10.000001, NaN, Infinity, -Infinity, '4', null, undefined]) {
    assert.throws(() => practiceBoundary(range, 'once', time as number));
  }
});

test('boundary refuses unknown playback modes without mutating the range', () => {
  const range = createPracticeRange(supplied(), 10, 1, 1), before = { ...range };
  for (const mode of ['', 'loop', 'ONCE', null, undefined, 1]) {
    assert.throws(() => practiceBoundary(range, mode as PracticeMode, range.start));
  }
  assert.deepEqual(range, before);
});

test('boundary validates complete scalar range invariants before deciding', () => {
  const range = { firstIndex: 1, lastIndex: 2, start: 3, end: 8, clipDuration: 10 };
  for (const patch of [
    { firstIndex: -1 }, { firstIndex: .5 }, { firstIndex: 3 }, { firstIndex: NaN },
    { lastIndex: 0 }, { lastIndex: 200 }, { lastIndex: Infinity },
    { start: -1 }, { start: NaN }, { start: 8 }, { start: 9 },
    { end: 11 }, { end: Infinity }, { clipDuration: .5 }, { clipDuration: 301 },
    { clipDuration: NaN }, { start: '3' },
  ]) {
    assert.throws(() => practiceBoundary({ ...range, ...patch } as PracticeRange, 'once', 5));
  }
  for (const invalid of [null, undefined, {}, [], 'range']) {
    assert.throws(() => practiceBoundary(invalid as unknown as PracticeRange, 'once', 5));
  }
});
