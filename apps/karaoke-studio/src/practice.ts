import { MAX_CUES, validateCues, type Cue } from './lyrics.ts';

export type PracticeMode = 'once' | 'repeat';
export interface PracticeRange {
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly start: number;
  readonly end: number;
  readonly clipDuration: number;
}

export function createPracticeRange(cues: Cue[], duration: number, firstIndex: number, lastIndex: number): Readonly<PracticeRange> {
  const admitted = validateCues(cues, duration);
  // Array.map in the shared validator preserves holes; an omitted line is not
  // a complete graph even when the requested endpoints themselves are present.
  for (let index = 0; index < admitted.length; index++) {
    if (!admitted[index]) throw new Error('Supply every lyric line before practicing.');
  }
  if (!Number.isInteger(firstIndex) || !Number.isInteger(lastIndex) || firstIndex < 0 ||
      lastIndex < firstIndex || lastIndex >= admitted.length) {
    throw new Error('Choose an ordered range of existing lyric lines to practice.');
  }
  return Object.freeze({ firstIndex, lastIndex, start: admitted[firstIndex].start,
    end: admitted[lastIndex].end, clipDuration: duration });
}

/** Call only after the session's own seek has settled at its selected start. */
export function practiceBoundary(range: PracticeRange, mode: PracticeMode, currentTime: number): 'continue' | 'finish' | 'repeat' {
  if (!range || typeof range !== 'object') throw new Error('Choose a valid practice range.');
  validateCues([], range.clipDuration);
  if (!Number.isInteger(range.firstIndex) || !Number.isInteger(range.lastIndex) || range.firstIndex < 0 ||
      range.lastIndex < range.firstIndex || range.lastIndex >= MAX_CUES ||
      !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 ||
      range.end <= range.start || range.end > range.clipDuration) {
    throw new Error('Choose a valid practice range within the clip.');
  }
  if (mode !== 'once' && mode !== 'repeat') throw new Error('Choose play once or repeat practice.');
  if (!Number.isFinite(currentTime) || currentTime < 0 || currentTime > range.clipDuration) {
    throw new Error('Practice requires a finite playback position within the clip.');
  }
  if (currentTime < range.start) throw new Error('Playback moved before the practice range.');
  return currentTime < range.end ? 'continue' : mode === 'once' ? 'finish' : 'repeat';
}
