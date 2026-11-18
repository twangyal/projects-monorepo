import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyReviewedLine, applyReviewedMerge, applyReviewedPassage } from '../src/automatic-review.ts';
import { copyCues, keepSingers, mergeCue, replaceCueWords, shiftCues, splitCue } from '../src/cue-edit.ts';
import { fitCues } from '../src/cue-fit.ts';
import { validateCues, type Cue, type Singer } from '../src/lyrics.ts';
import { mix, nextLabel, partLook, type PartStyle } from '../src/parts.ts';

// What the video gives for each style and singer (karaoke/video.py writes the same; see test_parts.py).
const fixture = JSON.parse(readFileSync(new URL('./part-colours.json', import.meta.url), 'utf8')) as Record<string, Record<string, { main: string; accent: string }>> & { next: Record<string, string> };
const singers: [string, Singer | undefined][] = [['anyone', undefined], ['1', 1], ['2', 2], ['both', 'both']];

test('each singer’s colours and the next line’s label are the video’s', () => {
  for (const style of ['classic', 'contrast', 'large', 'light'] as PartStyle[]) {
    const own = fixture[style]!.anyone!;
    for (const [key, singer] of singers) assert.deepEqual(partLook(style, own, singer), fixture[style]![key], `${style} ${key}`);
  }
  for (const [key, singer] of singers) assert.equal(nextLabel(singer), fixture.next[key]);
  // Singer 1 keeps the style's accent; the others differ from it and from each other.
  assert.equal(partLook('classic', fixture.classic!.anyone!, 1).accent, fixture.classic!.anyone!.accent);
  assert.equal(new Set(singers.slice(1).map(([, singer]) => partLook('classic', fixture.classic!.anyone!, singer).accent)).size, 3);
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('lines keep their singer through validation and every edit; lines for different singers merge into one for both', () => {
  const cues: Cue[] = [{ start: 0, end: 2, text: 'I sing this', singer: 1 }, { start: 2, end: 4, text: 'and I sing that', singer: 2 }, { start: 4, end: 6, text: 'anyone' }];
  assert.deepEqual(validateCues(cues, 10).map(cue => cue.singer), [1, 2, undefined]);
  assert.throws(() => validateCues([{ start: 0, end: 1, text: 'x', singer: 3 as unknown as Singer }], 10), /Line 1: choose singer 1, singer 2 or both/);
  const split = splitCue(cues, 0, 2, 1, 10);
  assert.deepEqual(split.slice(0, 2).map(cue => cue.singer), [1, 1]);
  assert.equal(mergeCue(cues, 0, 10)[0]!.singer, 'both');
  assert.equal(mergeCue([...cues.slice(0, 1), { ...cues[1]!, singer: 1 }], 0, 10)[0]!.singer, 1);
  assert.equal(mergeCue(cues, 1, 10)[1]!.singer, 2, 'a line for anyone takes on the other’s singer');
  assert.deepEqual(shiftCues(cues, 10, '0.5').map(cue => cue.singer), [1, 2, undefined]);
  assert.deepEqual(copyCues(cues, 10, '7', { firstIndex: 1, lastIndex: 1 }).cues.map(cue => cue.singer), [1, 2, undefined, 2]);
  assert.deepEqual(replaceCueWords(cues, 10, 'sing', 'hum').cues.map(cue => cue.singer), [1, 2, undefined]);
  assert.deepEqual(fitCues(cues, 10, '0', '3.5', { firstIndex: 0, lastIndex: 1 }).map(cue => cue.singer), [1, 2, undefined]);
});

test('lines that take the place of others keep who sings there', () => {
  const duet: Cue[] = [{ start: 0, end: 2, text: 'one', singer: 1 }, { start: 2, end: 4, text: 'two', singer: 2 }, { start: 4, end: 6, text: 'three' }];
  // Lines timed a little differently find their own; one covering two singers' lines is for both; part of a line is its singer's.
  assert.deepEqual(keepSingers(duet, [{ start: 0.2, end: 2.3, text: 'won' }, { start: 2.3, end: 4, text: 'too' }]).map(cue => cue.singer), [1, 2]);
  assert.equal(keepSingers(duet, [{ start: 0, end: 4, text: 'one two' }])[0]!.singer, 'both');
  assert.equal(keepSingers(duet, [{ start: 2.5, end: 3, text: 'tw' }])[0]!.singer, 2);
  assert.equal(keepSingers(duet, [{ start: 4, end: 6, text: 'THREE' }])[0]!.singer, undefined, 'over a line for anyone, still anyone');
  assert.equal(keepSingers(duet, [{ start: 0, end: 2, text: 'own', singer: 2 }])[0]!.singer, 2, 'a line with its own singer keeps it');
  // Reviewed lines and passages applied again keep the parts, as reviewed lines merged into one become both singers'.
  const row = (start: number, end: number, text: string) => ({ start: String(start), end: String(end), text });
  assert.equal(applyReviewedLine(duet, [row(2.1, 3.9, 'TWO')], 0, 10).cues[1]!.singer, 2);
  assert.deepEqual(applyReviewedPassage(duet, [row(0, 1.9, 'ONE'), row(2, 4, 'TWO')], 0, 1, 10).cues.map(cue => cue.singer), [1, 2, undefined]);
  assert.equal(applyReviewedMerge(duet, [row(0, 2, 'one'), row(2, 4, 'two')], 0, 10).cues[0]!.singer, 'both');
});
