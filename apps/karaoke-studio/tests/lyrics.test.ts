import test from 'node:test';
import assert from 'node:assert/strict';
import { draftCues, validateCues, validateTitle, activeCue, formatTime, type Cue } from '../src/lyrics.ts';

test('draft timing splits nonempty lines over the full duration without invented words', () => {
  assert.deepEqual(draftCues('Hello\n\nSecond line\n', 10), [
    { start: 0, end: 5, text: 'Hello' }, { start: 5, end: 10, text: 'Second line' },
  ]);
  assert.throws(() => draftCues('x\n'.repeat(201), 10));
  assert.throws(() => draftCues('   ', 10));
});

test('complete songs accept 300 seconds and 200 cues while rejecting the next boundary', () => {
  const cues = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 1, text: 'Line' }));
  assert.deepEqual(validateCues(cues, 300), cues);
  assert.throws(() => validateCues([...cues, { start: 200, end: 201, text: 'Extra' }], 300));
  for (const duration of [.999, 300.001, Infinity, NaN]) assert.throws(() => validateCues([], duration));
  assert.equal(draftCues('First\nLast', 300)[1].end, 300);
});

test('cue and combined lyric limits count Unicode code points without splitting astral text', () => {
  const line = '🎵'.repeat(240);
  assert.equal(validateCues([{ start: 0, end: 1, text: line }], 1)[0].text, line);
  assert.throws(() => validateCues([{ start: 0, end: 1, text: line + '🎵' }], 1));
  const cues = Array.from({ length: 200 }, (_, i) => ({ start: i, end: i + 1, text: '🎵'.repeat(100) }));
  assert.deepEqual(validateCues(cues, 300), cues);
  cues[199].text += '🎵';
  assert.throws(() => validateCues(cues, 300));
});

test('cue and raw draft text reject NUL and unmatched surrogates but retain valid pairs', () => {
  for (const text of ['abc\0def', '\ud800', '\udfff', '\ud800x', 'x\udfff']) {
    assert.throws(() => validateCues([{ start: 0, end: 1, text }], 1));
    assert.throws(() => draftCues(text, 1));
  }
  assert.equal(draftCues('A🎵B', 1)[0].text, 'A🎵B');
});

test('pasted text is bounded before whitespace is stripped or empty lines are dropped', () => {
  assert.equal(draftCues(' '.repeat(19999) + 'x', 1)[0].text, 'x');
  assert.throws(() => draftCues(' '.repeat(20000) + 'x', 1));
  assert.throws(() => draftCues('\n'.repeat(20000) + 'x', 1));
});

test('draft lines use Python splitlines and strip semantics including NEL and preserving BOM', () => {
  const lines = draftCues('\u001c\u0085First\u0085Second\rThird\vFourth\fFifth\u2028Sixth\u2029\ufeff\u001f', 7);
  assert.deepEqual(lines.map(cue => cue.text), ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', '\ufeff']);
  assert.throws(() => validateCues([{ start: 0, end: 1, text: '\u0085\u001f' }], 1));
  assert.equal(validateCues([{ start: 0, end: 1, text: '\ufeff' }], 1)[0].text, '\ufeff');
});

test('title validation accepts 100 Unicode code points and rejects unsafe or oversized titles', () => {
  assert.equal(validateTitle('🎵'.repeat(100)), '🎵'.repeat(100));
  assert.equal(validateTitle('\ufeff'), '\ufeff');
  for (const text of ['🎵'.repeat(101), '\u0085\u001f', '', 'a\0b', '\ud800', '\udfff', null]) assert.throws(() => validateTitle(text));
});
test('cue validation rejects nonfinite, overlapping, outside-duration and oversized data', () => {
  const cue: Cue = { start: 0, end: 1, text: 'First' };
  for (const cues of [[{ ...cue, start: NaN }], [{ ...cue, end: 0 }], [{ ...cue, end: 31 }], [cue, { ...cue, start: .5 }], [{ ...cue, text: '' }], [{ ...cue, text: 'x'.repeat(241) }]]) assert.throws(() => validateCues(cues, 30));
  assert.throws(() => validateCues([cue], Infinity));
  assert.deepEqual(validateCues([cue, { start: 2, end: 3, text: '<literal> & lyrics' }], 10), [cue, { start: 2, end: 3, text: '<literal> & lyrics' }]);
});
test('selection uses exclusive end boundaries and preserves instrumental gaps', () => {
  const cues = [{ start: 1, end: 2, text: 'First' }, { start: 3, end: 5, text: 'Next' }];
  assert.equal(activeCue(cues, .5), -1);
  assert.equal(activeCue(cues, 1), 0);
  assert.equal(activeCue(cues, 2), -1);
  assert.equal(activeCue(cues, 3), 1);
  assert.equal(activeCue(cues, 5), -1);
  assert.equal(formatTime(12.34), '0:12.34');
});
