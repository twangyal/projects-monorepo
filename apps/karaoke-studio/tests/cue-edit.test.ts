import assert from 'node:assert/strict';
import test from 'node:test';
import { splitCue, mergeCue } from '../src/cue-edit.ts';
import type { Cue } from '../src/lyrics.ts';

const fixture = (): Cue[] => [{ start: .25, end: 4, text: 'First 🌓 phrase' },
  { start: 5, end: 8, text: 'Next\nline 🎵' }, { start: 9, end: 10, text: 'Last' }];

test('split preserves literal Unicode halves, original outer times and every other cue', () => {
  const source = fixture(), before = structuredClone(source);
  const result = splitCue(source, 0, 8, 2.125, 10);
  assert.deepEqual(result, [{ start: .25, end: 2.125, text: 'First 🌓' },
    { start: 2.125, end: 4, text: ' phrase' }, ...before.slice(1)]);
  assert.deepEqual(source, before);
  result[2].text = 'changed'; assert.deepEqual(source, before);
});
test('merge preserves newline text and explicitly includes the intervening instrumental gap', () => {
  const source = fixture(), before = structuredClone(source);
  const result = mergeCue(source, 0, 10);
  assert.deepEqual(result, [{ start: .25, end: 8, text: 'First 🌓 phrase\nNext\nline 🎵' }, before[2]]);
  assert.deepEqual(source, before);
  result[1].text = 'changed'; assert.deepEqual(source, before);
});
test('textarea caret coordinates preserve literal CRLF and complete astral code points', () => {
  for (const [text, caret, left, right] of [['a\r\nbc', 3, 'a\r\nb', 'c'],
    ['a\r\n🌓b', 4, 'a\r\n🌓', 'b'], ['a\rb c', 3, 'a\rb', ' c']] as const) {
    assert.deepEqual(splitCue([{ start: 0, end: 2, text }], 0, caret, 1, 2),
      [{ start: 0, end: 1, text: left }, { start: 1, end: 2, text: right }]);
  }
});
test('split rejects UTF-16 half-surrogates and whitespace-only halves without mutation', () => {
  const source = fixture(), before = structuredClone(source);
  for (const caret of [0, 7, source[0].text.length, -1, .5, NaN]) {
    assert.throws(() => splitCue(source, 0, caret, 2, 10));
  }
  assert.throws(() => splitCue([{ start: 0, end: 2, text: '  words' }], 0, 1, 1, 2));
  assert.deepEqual(source, before);
});
test('split time must be finite and strictly inside the original interval', () => {
  for (const time of [.25, 4, 0, 5, NaN, Infinity]) assert.throws(() => splitCue(fixture(), 0, 8, time, 10));
});
test('structural actions reject invalid indices and the last cue cannot merge', () => {
  for (const index of [-1, .5, NaN, 3]) {
    assert.throws(() => splitCue(fixture(), index, 8, 2, 10));
    assert.throws(() => mergeCue(fixture(), index, 10));
  }
  assert.throws(() => mergeCue(fixture(), 2, 10));
});
test('a proposal validates all other cue timings before replacing any text', () => {
  const source = fixture(); source[2].start = NaN;
  assert.throws(() => splitCue(source, 0, 8, 2, 10));
  assert.throws(() => mergeCue(source, 0, 10));
  assert.ok(Number.isNaN(source[2].start)); assert.equal(source[0].text, 'First 🌓 phrase');
});
test('split obeys the complete 200-cue bound and merge can reduce it', () => {
  const source = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 1, text: 'a b' }));
  assert.throws(() => splitCue(source, 0, 1, .5, 200), /200/);
  assert.equal(mergeCue(source, 0, 200).length, 199);
});
test('merged literal newline counts toward the 240-code-point line limit', () => {
  const source = [{ start: 0, end: 1, text: '🌓'.repeat(120) }, { start: 1, end: 2, text: 'x'.repeat(120) }];
  assert.throws(() => mergeCue(source, 0, 2), /240/);
  source[1].text = 'x'.repeat(119);
  assert.equal(Array.from(mergeCue(source, 0, 2)[0].text).length, 240);
});
test('split retains the 20,000-character maximum while merge charges its new separator', () => {
  const source = Array.from({ length: 100 }, (_, i) => ({ start: i, end: i + 1, text: '🌓'.repeat(100) + 'x'.repeat(100) }));
  assert.equal(splitCue(source, 0, 200, .5, 100).length, 101);
  const shorter = source.map(cue => ({ ...cue, text: 'x'.repeat(100) }));
  // The two merged lines fit, but the total including the new newline must not.
  const full = [...shorter, ...shorter.map((cue, i) => ({ ...cue, start: i + 100, end: i + 101 }))];
  assert.throws(() => mergeCue(full, 0, 200), /20,000/);
});
