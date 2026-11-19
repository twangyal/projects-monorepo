import test from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_LINE, REACTION, doubtfulWords, lineMeant, matchedBoxes, nextDoubtful, playOnFrom, wordAt, wordMeant, wordSpan, type WordBox } from '../src/fix-line.ts';

const cues = [
  { start: 2, end: 6, text: 'I went down to the shore' },
  { start: 6, end: 9, text: 'and the sea was there' },
  { start: 14, end: 18, text: 'singing back to me' },
];

test('a press means the line sung a moment before it, or the line being sung, or one just ended, or the next to come', () => {
  // Sung a moment before: the reaction reaches back across a line boundary.
  assert.equal(lineMeant(cues, 4, REACTION), 0);
  assert.equal(lineMeant(cues, 6.2, REACTION), 0);
  assert.equal(lineMeant(cues, 6.5, REACTION), 1);
  // Paused (no reaction), the line under the playhead.
  assert.equal(lineMeant(cues, 6.2, 0), 1);
  // Just after a line ends, still that line; later in a break, the next line to come.
  assert.equal(lineMeant(cues, 9 + AFTER_LINE - 0.1, REACTION), 1);
  assert.equal(lineMeant(cues, 12, REACTION), 2);
  assert.equal(lineMeant(cues, 0.5, REACTION), 0);
  // After the last line, the last line; a press as a line begins after a break means that line.
  assert.equal(lineMeant(cues, 30, REACTION), 2);
  assert.equal(lineMeant(cues, 14.1, REACTION), 2);
  assert.equal(lineMeant([], 3, REACTION), null);
  // Lines with unfinished times are passed over.
  assert.equal(lineMeant([{ start: Number.NaN, end: 5, text: 'x' }, ...cues], 4, REACTION), 1);
});

test('the word meant is the last to start a moment before the press, the first as the line begins, none before it', () => {
  const line = cues[0]!;
  const words = ['I', 'went', 'down', 'to', 'the', 'shore'].map((text, index) => ({ text, start: 2 + index * 0.6, heard: true }));
  // "shore" starts at 5.0: pressed 0.3 s later, the reaction still reaches "the".
  assert.equal(wordMeant(words, line, 5.3, REACTION), 4);
  assert.equal(wordMeant(words, line, 5.5, REACTION), 5);
  assert.equal(wordMeant(words, line, 5.3, 0), 5);
  assert.equal(wordMeant(words, line, 2.1, REACTION), 0);
  // After the line ended, its last word; for a line still to come, no word.
  assert.equal(wordMeant(words, line, 7, REACTION), 5);
  assert.equal(wordMeant(words, line, 1, REACTION), null);
  assert.equal(wordMeant([], line, 3, REACTION), null);
});

test('a word is found in its line as the studio splits words: spaces, line breaks, punctuation and characters', () => {
  assert.deepEqual(wordSpan('I went  down', 2), [8, 12]);
  assert.deepEqual(wordSpan('the the\nthe', 2), [8, 11]);
  assert.deepEqual(wordSpan('Hello, world!', 0), [0, 6]);
  assert.deepEqual(wordSpan('我爱你', 1), [1, 2]);
  assert.deepEqual(wordSpan('🎤 sing', 1), [3, 7]);
  assert.equal(wordSpan('one two', 2), null);
});

test('playing on starts a second before the fixed line, never before the song', () => {
  assert.equal(playOnFrom(cues[1]!), 5);
  assert.equal(playOnFrom({ start: 0.4, end: 2, text: 'a' }), 0);
});

test('a click finds the word under it among the boxes that follow the line’s words', () => {
  const box = (text: string, x0: number, x1: number): WordBox => ({ text, x0, x1, y0: 100, y1: 150 });
  const drawn = [box('I', 100, 120), box('went', 130, 200), box('down', 210, 290)];
  assert.equal(matchedBoxes('I went down', drawn).length, 3);
  // A truncated or differently split drawing keeps only the boxes before the difference.
  assert.equal(matchedBoxes('I went downtown', drawn).length, 2);
  assert.equal(wordAt(drawn, 150, 120), 1);
  assert.equal(wordAt(drawn, 123, 120), 0);
  assert.equal(wordAt(drawn, 127, 120), 1);
  assert.equal(wordAt(drawn, 205, 120), 1);
  assert.equal(wordAt(drawn, 150, 300), null);
  assert.equal(wordAt(drawn, 400, 120), null);
});

test('doubtful words are those heard uncertainly in lines still as recognized, in the order they are sung', () => {
  const heard = (start: number, end: number, words: [string, number][]) => ({ start, end, text: words.map(([text]) => text).join(' '), confidence: 0.8,
    words: words.map(([text, confidence], k) => ({ text, start: start + k * 0.5, end: start + k * 0.5 + 0.4, confidence })) });
  const recognized = [heard(2, 6, [['I', 0.9], ['went', 0.4], ['down', 0.95]]), heard(6, 9, [['and', 0.3], ['the', 0.9], ['sea', 0.5]]), heard(14, 18, [['singing', 0.2]])];
  const lines = [{ start: 2, end: 6, text: 'I went down' }, { start: 6.2, end: 9, text: 'and  the sea' }, { start: 14, end: 18, text: 'singing back' }];
  const doubtful = doubtfulWords(lines, recognized, 0.7);
  // Line 3 was corrected, so its word is checked already; spacing alone does not count as a change.
  assert.deepEqual(doubtful.map(item => [item.cue, item.word, item.text]), [[0, 1, 'went'], [1, 0, 'and'], [1, 2, 'sea']]);
  assert.equal(doubtfulWords([{ start: 3, end: 6, text: 'I went down' }], recognized, 0.7).length, 0, 'a line moved by a second is not as heard');
  assert.deepEqual(nextDoubtful(doubtful, 0)?.text, 'went');
  assert.deepEqual(nextDoubtful(doubtful, doubtful[0]!.start)?.text, 'and');
  assert.equal(nextDoubtful(doubtful, 20), null);
});
