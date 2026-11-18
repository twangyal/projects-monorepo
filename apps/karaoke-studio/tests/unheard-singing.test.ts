import test from 'node:test';
import assert from 'node:assert/strict';
import { HEARD_MARGIN, PASSAGE_REST, passageLabel, retrySpan, unheardSinging } from '../src/unheard-singing.ts';
import type { Note } from '../src/melody-guide.ts';

// A phrase sung from 10 to 14 s in four notes, with short rests between them.
const phrase: Note[] = [[10, 10.9, 60], [11, 11.9, 62], [12.1, 13, 64], [13.1, 14, 62]];

test('a phrase sung where nothing was heard is listed whole, and words or lines anywhere near it take it off the list', () => {
  assert.deepEqual(unheardSinging(phrase, [], 30), [[10, 14]]);
  // Words before and after it, clear of it, leave it listed.
  assert.deepEqual(unheardSinging(phrase, [[5, 9.5], [14.5, 16]], 30), [[10, 14]]);
  // A word heard in the middle splits it; each half is long enough to list.
  assert.deepEqual(unheardSinging([[10, 12, 60], [12.2, 15, 62]], [[12, 12.4]], 30), [[10, 11.7], [12.7, 15]]);
  // A lyric line (or recognized words) over most of it leaves too little unheard singing.
  assert.deepEqual(unheardSinging(phrase, [[10.5, 13.5]], 30), []);
  // Words just short of its edges, within HEARD_MARGIN, count as its own.
  assert.deepEqual(unheardSinging(phrase, [[9.8, 9.9], [14.1, 14.2]], 30).map(([a, b]) => [a, b]), [[10.2, 13.8]]);
  assert.ok(HEARD_MARGIN > 0 && HEARD_MARGIN < 0.5);
});

test('short or scattered notes are not listed as singing', () => {
  // Under 1.2 s of notes in all.
  assert.deepEqual(unheardSinging([[3, 3.5, 60], [3.6, 4, 61]], [], 30), []);
  // Notes a rest of PASSAGE_REST or more apart are separate passages, each too short here.
  const apart: Note[] = [[1, 1.8, 60], [1.81 + PASSAGE_REST, 2.61 + PASSAGE_REST, 60]];
  assert.deepEqual(unheardSinging(apart, [], 30), []);
  assert.deepEqual(unheardSinging([[1, 1.8, 60], [2.1, 2.9, 60]], [], 30), [[1, 2.9]]);
  // Kept inside the clip, with odd spans ignored.
  assert.deepEqual(unheardSinging([[28, 31, 60]], [[Number.NaN, 2], [5, 4]], 30), [[28, 30]]);
});

test('a passage is recognized again with a second of context, within the clip and the retry limits', () => {
  assert.deepEqual(retrySpan([10, 14], 30), [9, 15]);
  assert.deepEqual(retrySpan([0.2, 2], 30), [0, 3]);
  assert.deepEqual(retrySpan([28, 30], 30), [27, 30]);
  // At most a minute.
  const [start, end] = retrySpan([10, 100], 200);
  assert.equal(end - start, 60);
  // A second of context before a sliver at the end of a clip, and at least a second in all.
  assert.deepEqual(retrySpan([4.9, 5], 5), [3.9, 5]);
  assert.deepEqual(retrySpan([0, 0.1], 0.6), [0, 0.6]);
});

test('passages are labelled in minutes and seconds', () => {
  assert.equal(passageLabel([62.44, 65.96]), '1:02.4–1:06.0');
  assert.equal(passageLabel([5, 9.5]), '0:05.0–0:09.5');
  assert.equal(passageLabel([599.96, 600]), '10:00.0–10:00.0');
});
