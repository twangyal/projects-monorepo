import { MAX_CUES, validateCues, type Cue } from './lyrics.ts';
import { createPracticeRange, type PracticeRange } from './practice.ts';

export interface ReviewedCue { start: string; end: string; text: string }
function timing(row: ReviewedCue, index: number): Pick<Cue, 'start' | 'end'> {
  const read = (boundary: 'start' | 'end') => {
    const raw = row?.[boundary]?.trim();
    if (!raw || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) {
      throw new Error(`Line ${index + 1}: enter a finite ${boundary} time in seconds.`);
    }
    return Number(raw);
  };
  return { start: read('start'), end: read('end') };
}
/** Validate the complete proposal without normalizing or changing the raw drafts. */
export function reviewedCues(rows: readonly ReviewedCue[], duration: number): Cue[] {
  return validateCues(Array.from(rows, (row, index) => ({ ...timing(row, index), text: row.text })), duration);
}
/** Audition a single staged interval even while other lines or words need correction. */
export function reviewedRange(rows: readonly ReviewedCue[], duration: number, index: number): Readonly<PracticeRange> {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length || index >= MAX_CUES) throw new Error('Choose an existing reviewed lyric line.');
  const times = timing(rows[index], index);
  try {
    const range = createPracticeRange([{ ...times, text: 'Reviewed passage' }], duration, 0, 0);
    return Object.freeze({ ...range, firstIndex: index, lastIndex: index });
  } catch (error) {
    throw new Error((error instanceof Error ? error.message : 'Check the reviewed timing.').replace('Line 1:', `Line ${index + 1}:`));
  }
}
