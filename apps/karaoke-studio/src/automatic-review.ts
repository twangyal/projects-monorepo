import { MAX_CUES, validateCues, type Cue } from './lyrics.ts';
import { createPracticeRange, type PracticeRange } from './practice.ts';

export interface ReviewedCue { start: string; end: string; text: string; excluded?: boolean }
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
  if (!Array.isArray(rows) || rows.length > MAX_CUES) throw new Error('Use at most 200 automatic lyric lines.');
  const indices: number[] = [];
  const included = rows.flatMap((row, index) => {
    if (row.excluded !== undefined && typeof row.excluded !== 'boolean') throw new Error(`Line ${index + 1}: exclusion must be boolean.`);
    if (row.excluded) return [];
    indices.push(index); return [{ ...timing(row, index), text: row.text }];
  });
  try { return validateCues(included, duration); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Check included automatic lyric lines.';
    throw new Error(message.replace(/Line (\d+)/g, (_, number) => `Line ${(indices[Number(number) - 1] ?? Number(number) - 1) + 1}`));
  }
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

/** Apply just one reviewed cue. Never infer that several corrected current lines should be removed. */
export function applyReviewedLine(current: Cue[], rows: readonly ReviewedCue[], index: number, duration: number): {cues:Cue[];index:number;replaced:boolean;changed:boolean} {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Number.isInteger(index) || index < 0 || index >= rows.length) throw new Error('Choose an existing reviewed lyric line.');
  let cues: Cue[];
  try { cues = validateCues(current, duration); }
  catch (error) { throw new Error(`Check current lyrics first: ${error instanceof Error ? error.message : 'Invalid lyric cues.'}`); }
  let selected: Cue | undefined;
  try { selected = reviewedCues([rows[index]], duration)[0]; }
  catch (error) { throw new Error((error instanceof Error ? error.message : 'Check the reviewed line.').replace(/Line 1\b/g, `Line ${index + 1}`)); }
  if (!selected) throw new Error(`Include automatic line ${index + 1} before applying it.`);
  const overlaps = cues.flatMap((cue, k) => cue.start < selected!.end && selected!.start < cue.end ? [k] : []);
  if (overlaps.length > 1) throw new Error('This reviewed line overlaps more than one current line. Adjust its times or use the complete review; current lyrics are unchanged.');
  const replaced = overlaps.length === 1;
  let target = replaced ? overlaps[0] : cues.findIndex(cue => cue.start >= selected!.end);
  if (target < 0) target = cues.length;
  const old = cues[target];
  const changed = !replaced || old.start !== selected.start || old.end !== selected.end || old.text !== selected.text;
  cues.splice(target, replaced ? 1 : 0, selected);
  return {cues:validateCues(cues, duration),index:target,replaced,changed};
}
