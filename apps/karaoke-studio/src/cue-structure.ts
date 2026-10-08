import type { Cue } from './lyrics.ts';
import { splitCue as split, mergeCue as merge } from './cue-edit.ts';

// Preserve the concurrently introduced selection-range API and its independent
// boundary cases while sharing the production CRLF-safe proposal algorithm.
export function splitCue(cues: Cue[], duration: number, index: number, start: number, end: number, time: number): Cue[] {
  if (start !== end) throw new Error('Place a collapsed text caret between the two nonempty lyric halves.');
  return split(cues, index, start, time, duration);
}
export function mergeCue(cues: Cue[], duration: number, index: number): Cue[] {
  return merge(cues, index, duration);
}
