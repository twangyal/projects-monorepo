import test from 'node:test';
import assert from 'node:assert/strict';
import { assignSingers } from '../src/cue-edit.ts';
import type { Cue } from '../src/lyrics.ts';

const fixture = (): Cue[] => [{ start: 1, end: 3, text: 'First 🌓', singer: 1, wordStarts: [1.1, 1.5] }, { start: 4, end: 6, text: 'Second\r\nline', singer: 2 }, { start: 8, end: 11, text: 'Together', singer: 'both' }];
test('assign a passage or all lines without changing words, timing, outside parts or source', () => {
  const source = fixture(), before = structuredClone(source);
  const result = assignSingers(source, 1, { firstIndex: 1, lastIndex: 2 });
  assert.equal(result.changed, 2);
  assert.deepEqual(result.cues, [before[0], { ...before[1], singer: 1 }, { ...before[2], singer: 1 }]);
  assert.deepEqual(source, before);
  assert.deepEqual(assignSingers(source, 'both').cues.map(cue => cue.singer), ['both', 'both', 'both']);
  assert.deepEqual(assignSingers(source, 2, { firstIndex: 0, lastIndex: 0 }).cues, [{ ...before[0], singer: 2 }, ...before.slice(1)]);
});
test('Anyone removes the field, and identical assignment is an explicit no-op', () => {
  const source = fixture(), result = assignSingers(source, undefined);
  assert.equal(result.changed, 3);
  assert.ok(result.cues.every(cue => !Object.hasOwn(cue, 'singer')));
  const same = assignSingers(result.cues, undefined);
  assert.equal(same.changed, 0); assert.equal(same.cues, result.cues);
  assert.equal(assignSingers(source, 2, { firstIndex: 1, lastIndex: 1 }).changed, 0);
});
test('invalid choices and stale, reversed, fractional or empty ranges refuse without mutation', () => {
  const source = fixture(), before = structuredClone(source);
  for (const singer of [null, false, '1', 'anyone', 0, 3, NaN]) assert.throws(() => assignSingers(source, singer), /singer/i);
  for (const range of [{ firstIndex: -1, lastIndex: 1 }, { firstIndex: 1, lastIndex: 0 }, { firstIndex: 0, lastIndex: 3 }, { firstIndex: .5, lastIndex: 1 }, { firstIndex: NaN, lastIndex: 1 }]) assert.throws(() => assignSingers(source, 1, range), /line|passage/i);
  assert.throws(() => assignSingers([], 1), /line/i);
  assert.throws(() => assignSingers(source, 1, {} as { firstIndex: number; lastIndex: number }), /line/i);
  assert.deepEqual(source, before);
});
test('role editing keeps invalid text and timing drafts literal for later correction', () => {
  const source = fixture(); source[0].start = NaN; source[1].text = '';
  const result = assignSingers(source, 'both');
  assert.ok(Number.isNaN(result.cues[0].start)); assert.equal(result.cues[1].text, '');
  assert.deepEqual(result.cues.map(cue => [cue.start, cue.end, cue.text]), source.map(cue => [cue.start, cue.end, cue.text]));
});
