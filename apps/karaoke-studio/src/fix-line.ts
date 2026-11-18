import type { Cue } from './lyrics.ts';
import { cueWords, type TimedWord } from './word-timing.ts';

/**
 * Fixing a line while listening: a press (or a click on the preview) pauses the song and opens the line meant, with the
 * word meant selected, so typing replaces it; Enter plays on from just before the line.
 */

/** Seconds of playback a listener takes to hear a wrong word and press: the word they mean was sung this long before. */
export const REACTION = 0.4;
/** How long after a line ends a press still means that line, in seconds. */
export const AFTER_LINE = 1.5;
/** How long before the fixed line playback starts again, in seconds, so its corrected words can be checked. */
export const PLAY_ON_LEAD = 1;

const timed = (cue: Cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end);
const at = (cues: readonly Cue[], time: number) => cues.findIndex(cue => timed(cue) && time >= cue.start && time < cue.end);

/**
 * The line meant by a press at `time` (song seconds), `reaction` seconds of song after the word that prompted it: the
 * line sung then, else the line being sung, else one that ended at most AFTER_LINE before, else the next line to come,
 * else the last line. Null only without lines.
 */
export function lineMeant(cues: readonly Cue[], time: number, reaction: number): number | null {
  if (!cues.length) return null;
  for (const moment of [time - reaction, time]) { const index = at(cues, moment); if (index >= 0) return index; }
  let ended = -1;
  for (const [index, cue] of cues.entries()) if (timed(cue) && cue.end <= time && time - cue.end <= AFTER_LINE && (ended < 0 || cue.end > cues[ended]!.end)) ended = index;
  if (ended >= 0) return ended;
  let next = -1;
  for (const [index, cue] of cues.entries()) if (timed(cue) && cue.start > time && (next < 0 || cue.start < cues[next]!.start)) next = index;
  return next >= 0 ? next : cues.length - 1;
}

/**
 * The word of a line meant by a press at `time`, `reaction` seconds after the word that prompted it: the last word to
 * start by then (the first, if the press came as the line began). Null for a line not yet begun.
 */
export function wordMeant(words: readonly TimedWord[], line: Cue, time: number, reaction: number): number | null {
  if (!words.length || !(time >= line.start)) return null;
  const moment = Math.max(line.start, time - reaction);
  let found = 0;
  for (const [index, word] of words.entries()) if (word.start <= moment) found = index;
  return found;
}

/** Where the `index`th word of `text`, as the studio splits its words (see cueWords), lies: [start, end) in UTF-16 units. */
export function wordSpan(text: string, index: number): [number, number] | null {
  let cursor = 0;
  for (const [k, word] of cueWords(text).entries()) {
    const start = text.indexOf(word, cursor);
    if (start < 0) return null;
    cursor = start + word.length;
    if (k === index) return [start, cursor];
  }
  return null;
}

/** Where playback goes on from once a line is fixed. */
export function playOnFrom(cue: Cue): number {
  return Math.max(0, cue.start - PLAY_ON_LEAD);
}

/** One word of the line being sung as the preview draws it, in canvas pixels. */
export interface WordBox { text: string; x0: number; x1: number; y0: number; y1: number }

/**
 * The boxes of a line's words as drawn, kept only while they follow the line's own words in order (an ellipsis or a
 * different split ends them), so the nth box is the line's nth word.
 */
export function matchedBoxes(text: string, boxes: readonly WordBox[]): WordBox[] {
  const words = cueWords(text), kept: WordBox[] = [];
  for (const [index, box] of boxes.entries()) { if (box.text !== words[index]) break; kept.push(box); }
  return kept;
}

/** The word a click at (x, y) in canvas pixels lands on, allowing a little slack around each word; null for none. */
export function wordAt(boxes: readonly WordBox[], x: number, y: number, slack = 6): number | null {
  let best: number | null = null, distance = Infinity;
  for (const [index, box] of boxes.entries()) {
    if (y < box.y0 - slack || y > box.y1 + slack) continue;
    const away = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0;
    if (away <= slack && away < distance) { best = index; distance = away; }
  }
  return best;
}
