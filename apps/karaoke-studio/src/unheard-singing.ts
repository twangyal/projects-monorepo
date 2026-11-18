// Singing with no words: passages where the melody guide found sung notes in the separated vocals but recognition heard
// no words and the lyrics have no line, so whole missed phrases can be found without listening through the song.
import type { Note } from './melody-guide.ts';

/** Notes with rests shorter than this (seconds) between them are one passage of singing. */
export const PASSAGE_REST = 0.5;
/** A passage needs at least this many seconds of notes to be listed. */
export const PASSAGE_SUNG = 1.2;
/** Notes this close (seconds) to a heard word or a lyric line count as theirs. */
export const HEARD_MARGIN = 0.3;
/** At most this many passages are listed. */
export const MAX_PASSAGES = 12;

export type Span = readonly [number, number];

/** Seconds of notes inside [start, end]. */
function sungWithin(notes: readonly Note[], start: number, end: number): number {
  let sung = 0;
  for (const [a, b] of notes) sung += Math.max(0, Math.min(b, end) - Math.max(a, start));
  return sung;
}

/**
 * The passages of singing that no heard word or lyric line reaches: runs of notes split wherever one comes within
 * HEARD_MARGIN of a heard span, each with at least PASSAGE_SUNG seconds of notes, in time order.
 */
export function unheardSinging(notes: readonly Note[], heard: readonly Span[], duration: number): Span[] {
  const runs: Span[] = [];
  let first: Note | null = null, last: Note | null = null;
  for (const note of notes) {
    if (first && last && note[0] - last[1] >= PASSAGE_REST) { runs.push([first[0], last[1]]); first = null; }
    first ??= note; last = note;
  }
  if (first && last) runs.push([first[0], last[1]]);
  const spans = [...heard].filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a).sort((x, y) => x[0] - y[0]);
  const passages: Span[] = [];
  for (const [a, b] of runs) {
    if (sungWithin(notes, a, b) < PASSAGE_SUNG) continue;
    // The parts of the run clear of every heard span.
    let cursor = a;
    const free: Span[] = [];
    for (const [s, e] of spans) {
      if (e + HEARD_MARGIN <= cursor || s - HEARD_MARGIN >= b) continue;
      if (s - HEARD_MARGIN > cursor) free.push([cursor, s - HEARD_MARGIN]);
      cursor = Math.max(cursor, e + HEARD_MARGIN);
    }
    if (cursor < b) free.push([cursor, b]);
    for (const [s, e] of free) {
      if (sungWithin(notes, s, e) < PASSAGE_SUNG) continue;
      const start = Math.max(0, s), end = Math.min(duration, e);
      if (end > start) passages.push([Math.round(start * 100) / 100, Math.round(end * 100) / 100]);
    }
  }
  return passages;
}

/** The passage to recognize again: a second of context either side, within the clip and the 1–60 s retry limits. */
export function retrySpan(passage: Span, duration: number): Span {
  const middle = (passage[0] + passage[1]) / 2, half = Math.min(30, Math.max(0.5, (passage[1] - passage[0]) / 2 + 1));
  let start = Math.max(0, middle - half), end = Math.min(duration, middle + half);
  // Near an end of the clip, the span widens on the other side to stay at least a second long.
  if (end - start < 1) { start = Math.max(0, end - 1); end = Math.min(duration, start + 1); }
  return [Math.round(start * 100) / 100, Math.round(end * 100) / 100];
}

/** A passage as minutes and seconds to the tenth, such as "1:02.4–1:05.9". */
export function passageLabel(passage: Span): string {
  const clock = (seconds: number) => {
    const tenths = Math.round(seconds * 10), minutes = Math.floor(tenths / 600), rest = (tenths - minutes * 600) / 10;
    return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
  };
  return `${clock(passage[0])}–${clock(passage[1])}`;
}
