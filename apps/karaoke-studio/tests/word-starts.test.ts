import assert from 'node:assert/strict';
import test from 'node:test';
import { copyCues, mergeCue, replaceCueWords, shiftCues, splitCue } from '../src/cue-edit.ts';
import { fitCues } from '../src/cue-fit.ts';
import { LyricHistory } from '../src/draft-history.ts';
import { validateCues, type Cue } from '../src/lyrics.ts';
import { NUDGE, TAP_GRACE, WordTapping, nudgeWord } from '../src/word-tapping.ts';

const lines = (): Cue[] => [{ start: 1, end: 4, text: 'hello there world', wordStarts: [1.2, 2.25, 3.5] },
  { start: 5, end: 7, text: 'no hand times' }, { start: 8, end: 9, text: 'last line', wordStarts: [8, 8.5] }];
const starts = (cues: Cue[]) => cues.map(cue => cue.wordStarts);

test('hand-set word starts stay with their line while they fit it, follow its edges and go when its words change', () => {
  assert.deepEqual(starts(validateCues(lines(), 10)), [[1.2, 2.25, 3.5], undefined, [8, 8.5]]);
  // A start moved past the words pulls them along, in order; so does an end; times keep to the millisecond.
  const moved = lines(); moved[0] = { ...moved[0]!, start: 2.5, end: 3.2, wordStarts: [1.2, 2.25004, 3.5] };
  assert.deepEqual(validateCues(moved, 10)[0]!.wordStarts, [2.5, 2.5, 3.2]);
  // Another word, or one fewer, drops them; so does anything but a list of numbers.
  for (const text of ['hello there wide world', 'hello world']) assert.equal(validateCues([{ ...lines()[0]!, text }], 10)[0]!.wordStarts, undefined);
  for (const wordStarts of [[1.2, Number.NaN, 3], ['1.2', 2, 3], [{ start: 1.2 }, 2, 3]]) {
    assert.equal(validateCues([{ ...lines()[0]!, wordStarts: wordStarts as number[] }], 10)[0]!.wordStarts, undefined);
  }
  // A typo fixed in a word keeps them.
  assert.deepEqual(replaceCueWords(lines(), 10, 'there', 'their').cues[0]!.wordStarts, [1.2, 2.25, 3.5]);
});

test('splitting, merging, shifting, copying and fitting lines take their hand-set word starts with them', () => {
  // Split between words: each half keeps its own words' starts.
  const split = splitCue(lines(), 0, 'hello there'.length, 3, 10);
  assert.deepEqual(starts(split).slice(0, 2), [[1.2, 2.25], [3.5]]);
  // Merged lines keep them only when both had them.
  assert.deepEqual(mergeCue(lines(), 1, 10)[1]!.wordStarts, undefined);
  const both = lines(); both[1] = { ...both[1]!, wordStarts: [5, 5.5, 6] };
  assert.deepEqual(mergeCue(both, 1, 10)[1]!.wordStarts, [5, 5.5, 6, 8, 8.5]);
  assert.deepEqual(starts(shiftCues(lines(), 10, '0.5')), [[1.7, 2.75, 4], undefined, [8.5, 9]]);
  const copied = copyCues(lines(), 20, '12', { firstIndex: 0, lastIndex: 0 });
  assert.deepEqual(copied.cues[copied.insertIndex]!.wordStarts, [12.2, 13.25, 14.5]);
  // Fitting a passage into a window twice as long spaces its words twice as far apart.
  assert.deepEqual(fitCues([lines()[0]!], 20, '1', '7', { firstIndex: 0, lastIndex: 0 })[0]!.wordStarts, [1.4, 3.5, 6]);
});

test('a change to hand-set word starts alone is an edit that can be saved and undone', () => {
  const draft = { title: 'Words', cues: lines(), pastedText: '', pastedDirty: false };
  const history = new LyricHistory(draft);
  const retimed = structuredClone(draft); retimed.cues[0]!.wordStarts = [1.3, 2.25, 3.5];
  history.record(retimed);
  assert.equal(history.canUndo, true);
  assert.equal(history.dirty, true);
  const cleared = structuredClone(draft); delete cleared.cues[2]!.wordStarts;
  history.record(cleared);
  assert.deepEqual(history.current.cues[2]!.wordStarts, undefined);
});

test('tapping a line’s words marks each start in order, inside the line', () => {
  const tapping = new WordTapping(lines()[0]!);
  assert.deepEqual([tapping.words, tapping.next, tapping.done], [['hello', 'there', 'world'], 'hello', false]);
  assert.throws(() => tapping.result(), /Tap every word: 3 still to time/);
  // A tap before the line counts from its start, one after the next word from where that one started.
  tapping.tap(0.6); tapping.tap(2.31249); tapping.tap(2);
  assert.deepEqual([tapping.done, tapping.result(), tapping.late], [true, [1, 2.312, 2.312], 0]);
  tapping.tap(3);
  assert.deepEqual(tapping.result(), [1, 2.312, 2.312]);
  // Taps after the line ends start at its end and are counted, so the line's end can be moved.
  const late = new WordTapping(lines()[2]!);
  late.tap(8.2); late.tap(9.4);
  assert.deepEqual([late.result(), late.late], [[8.2, 9], 1]);
  // Playback well past the line with words still to tap gives up.
  const short = new WordTapping(lines()[2]!);
  short.tap(8.1);
  assert.deepEqual([short.overdue(9 + TAP_GRACE - 0.01), short.overdue(9 + TAP_GRACE + 0.01)], [false, true]);
  assert.throws(() => short.tap(Number.NaN), /no playback time/);
  assert.throws(() => new WordTapping({ start: 0, end: 1, text: ' ' }), /no words to time/);
});

test('a word nudged moves its start alone, never past its neighbours or out of its line', () => {
  const line = lines()[0]!, starts = line.wordStarts!;
  assert.deepEqual(nudgeWord(starts, 1, NUDGE, line), [1.2, 2.3, 3.5]);
  assert.deepEqual(nudgeWord(starts, 1, -2, line), [1.2, 1.2, 3.5]);
  assert.deepEqual(nudgeWord(starts, 2, 5, line), [1.2, 2.25, 4]);
  assert.deepEqual(nudgeWord(starts, 0, -1, line), [1, 2.25, 3.5]);
  assert.throws(() => nudgeWord(starts, 3, NUDGE, line), /Choose a word/);
});
