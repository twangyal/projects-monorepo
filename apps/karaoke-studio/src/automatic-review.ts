import { MAX_CUES, validateCues, type Cue } from './lyrics.ts';
import { keepSingers, splitCue, mergeCue } from './cue-edit.ts';
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

/** Listen to the included passage even before words or current cue boundaries are corrected. */
export function reviewedPassageRange(rows: readonly ReviewedCue[], duration: number, first: number, last: number): Readonly<PracticeRange> {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Number.isInteger(first) || !Number.isInteger(last)
      || first < 0 || last < first || last >= rows.length) throw new Error('Choose an existing first and last reviewed line.');
  const times = rows.slice(first, last + 1).map(row => ({ ...row, text: 'Reviewed line' }));
  let included: Cue[];
  try { included = reviewedCues(times, duration); }
  catch (error) {
    throw new Error((error instanceof Error ? error.message : 'Check the reviewed passage timing.')
      .replace(/Line (\d+)/g, (_, number) => `Line ${Number(number) + first}`));
  }
  if (!included.length) throw new Error('Include at least one reviewed line to listen.');
  return Object.freeze({ ...createPracticeRange(included, duration, 0, included.length - 1), firstIndex: first, lastIndex: last });
}

/** Apply just one reviewed cue. Never infer that several corrected current lines should be removed. */
export function applyReviewedLine(current: Cue[], rows: readonly ReviewedCue[], index: number, duration: number): {cues:Cue[];index:number;replaced:boolean;changed:boolean} {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Number.isInteger(index) || index < 0 || index >= rows.length) throw new Error('Choose an existing reviewed lyric line.');
  let selected: Cue | undefined;
  try { selected = reviewedCues([rows[index]], duration)[0]; }
  catch (error) { throw new Error((error instanceof Error ? error.message : 'Check the reviewed line.').replace(/Line 1\b/g, `Line ${index + 1}`)); }
  if (!selected) throw new Error(`Include automatic line ${index + 1} before applying it.`);
  return applySingleReviewedCue(current, selected, duration, true);
}

/** Apply checked, included rows atomically against the original current lyrics.
 * `sources` maps unchanged output cues to their original timing-draft rows.
 * Changed/inserted cues use null so only those times get new literal spellings.
 */
export function applyCheckedReviewedLines(current: Cue[], rows: readonly ReviewedCue[], checked: readonly number[], duration: number): {cues:Cue[];sources:(number|null)[];replaced:number;added:number;changed:boolean} {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Array.isArray(checked) || checked.length > MAX_CUES
      || new Set(checked).size !== checked.length || checked.some(index => !Number.isInteger(index) || index < 0 || index >= rows.length)) throw new Error('Choose existing checked reviewed lines.');
  const indices = [...checked].sort((a,b) => a-b).filter(index => rows[index].excluded !== true);
  if (!indices.length) throw new Error('Check at least one included automatic line to apply. Excluded lines stay unchanged.');
  let cues: Cue[], selected: Cue[];
  try { cues = validateCues(current, duration); }
  catch (error) { throw new Error(`Check current lyrics first: ${error instanceof Error ? error.message : 'Invalid lyric cues.'}`); }
  try { selected = reviewedCues(indices.map(index => rows[index]), duration); }
  catch (error) { throw new Error((error instanceof Error ? error.message : 'Check the selected lines.').replace(/Line (\d+)/g, (_, n) => `Line ${indices[Number(n)-1] + 1}`)); }
  const removed = new Set<number>();
  let changed = false, added = 0;
  const replacements = selected.map((cue, at) => {
    const overlaps = cues.flatMap((old, index) => old.start < cue.end && cue.start < old.end ? [index] : []);
    if (overlaps.length > 1) throw new Error(`Reviewed line ${indices[at] + 1} overlaps more than one current line. Adjust its times or use a reviewed passage; current lyrics are unchanged.`);
    const index = overlaps[0];
    if (index !== undefined && removed.has(index)) throw new Error(`Several checked lines replace the same current line ${index + 1}. Use a reviewed passage for changed grouping; current lyrics are unchanged.`);
    if (index !== undefined) removed.add(index); else added++;
    const old = index === undefined ? undefined : cues[index];
    const same = !!old && old.start === cue.start && old.end === cue.end && old.text === cue.text;
    if (!same) changed = true;
    return {cue:same ? old : keepSingers(old ? [old] : [], [cue])[0],source:same ? index : null};
  });
  const result = cues.flatMap((cue,index) => removed.has(index) ? [] : [{cue,source:index as number|null}]).concat(replacements)
    .sort((a,b) => a.cue.start-b.cue.start);
  return {cues:validateCues(result.map(item=>item.cue),duration),sources:result.map(item=>item.source),replaced:removed.size,added,changed};
}

/** Replace one overlapping cue or insert into a gap, for automatic and file reviews alike. */
export function applySingleReviewedCue(current: Cue[], selected: Cue, duration: number, canAdjustTiming = false): {cues:Cue[];index:number;replaced:boolean;changed:boolean} {
  let cues: Cue[];
  try { cues = validateCues(current, duration); }
  catch (error) { throw new Error(`Check current lyrics first: ${error instanceof Error ? error.message : 'Invalid lyric cues.'}`); }
  const overlaps = cues.flatMap((cue, k) => cue.start < selected.end && selected.start < cue.end ? [k] : []);
  if (overlaps.length > 1) throw new Error(`This reviewed line overlaps more than one current line. ${canAdjustTiming ? 'Adjust its times or use the complete review; current lyrics are unchanged.' : 'Current lyrics are unchanged.'}`);
  const replaced = overlaps.length === 1;
  let target = replaced ? overlaps[0] : cues.findIndex(cue => cue.start >= selected.end);
  if (target < 0) target = cues.length;
  const old = cues[target];
  const changed = !replaced || old.start !== selected.start || old.end !== selected.end || old.text !== selected.text;
  // A line it replaces keeps its singer.
  cues.splice(target, replaced ? 1 : 0, ...keepSingers(replaced ? [old] : [], [selected]));
  return {cues:validateCues(cues, duration),index:target,replaced,changed};
}

/** Replace a complete reviewed interval; never trim a corrected line at its edges. */
export function applyReviewedPassage(current: Cue[], rows: readonly ReviewedCue[], first: number, last: number, duration: number, canEditBoundaries = true): {cues:Cue[];index:number;removed:number;start:number;end:number;changed:boolean} {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Number.isInteger(first) || !Number.isInteger(last)
    || first < 0 || last < first || last >= rows.length) throw new Error('Choose an existing first and last reviewed line for the passage.');
  let cues: Cue[];
  try { cues = validateCues(current, duration); }
  catch (error) { throw new Error(`Check current lyrics first: ${error instanceof Error ? error.message : 'Invalid lyric cues.'}`); }
  let selected: Cue[];
  try { selected = reviewedCues(rows.slice(first, last + 1), duration); }
  catch (error) {
    throw new Error((error instanceof Error ? error.message : 'Check the reviewed passage.').replace(/Line (\d+)/g, (_, number) => `Line ${Number(number) + first}`));
  }
  if (!selected.length) throw new Error('Include at least one reviewed line in the selected passage.');
  const start = selected[0].start, end = selected[selected.length - 1].end;
  const overlaps = cues.flatMap((cue, index) => cue.start < end && start < cue.end ? [index] : []);
  for (const index of overlaps) {
    if (cues[index].start < start || cues[index].end > end) throw new Error(`The passage cuts through current line ${index + 1}. ${canEditBoundaries ? 'Adjust reviewed boundary times' : 'Preview a different timing offset'} or choose a wider passage; current lyrics are unchanged.`);
  }
  let index = overlaps.length ? overlaps[0] : cues.findIndex(cue => cue.start >= end);
  if (index < 0) index = cues.length;
  const removed = overlaps.length;
  // The lines it replaces keep their singers.
  selected = keepSingers(overlaps.map(at => cues[at]), selected);
  const changed = removed !== selected.length || selected.some((cue, offset) => {
    const old = cues[index + offset];
    return !old || old.start !== cue.start || old.end !== cue.end || old.text !== cue.text;
  });
  cues.splice(index, removed, ...selected);
  return { cues:validateCues(cues, duration), index, removed, start, end, changed };
}


function groupingRows(rows: readonly ReviewedCue[], index: number, count: number, duration: number): Cue[] {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Number.isInteger(index) || index < 0 || index + count > rows.length) throw new Error('Choose existing adjacent reviewed lyric lines.');
  for (let at = index; at < index + count; at++) if (rows[at].excluded) throw new Error(`Include reviewed line ${at + 1} before applying its line grouping.`);
  try { return reviewedCues(rows.slice(index, index + count), duration); }
  catch (error) { throw new Error((error instanceof Error ? error.message : 'Check the reviewed lines.').replace(/Line (\d+)/g, (_, number) => `Line ${Number(number) + index}`)); }
}
function applyGrouping(current: Cue[], proposal: Cue[], duration: number): ReturnType<typeof applyReviewedPassage> {
  return applyReviewedPassage(current, proposal.map(cue => ({start:String(cue.start),end:String(cue.end),text:cue.text})), 0, proposal.length - 1, duration);
}

/** Apply a corrected line break without discarding the remaining staged review. */
export function applyReviewedSplit(current: Cue[], rows: readonly ReviewedCue[], index: number, caret: number, playhead: number, duration: number): ReturnType<typeof applyReviewedPassage> {
  return applyGrouping(current, splitCue(groupingRows(rows, index, 1, duration), 0, caret, playhead, duration), duration);
}
/** Explicitly join adjacent reviewed lines, including their gap, as one undoable current-lyric edit. */
export function applyReviewedMerge(current: Cue[], rows: readonly ReviewedCue[], index: number, duration: number): ReturnType<typeof applyReviewedPassage> {
  return applyGrouping(current, mergeCue(groupingRows(rows, index, 2, duration), 0, duration), duration);
}


/** Bounded staged words for audition, with original row numbers after exclusions. */
export function reviewedPreview(rows: readonly ReviewedCue[], duration: number, first: number, last: number): { cues: Cue[]; indices: number[] } {
  if (!Array.isArray(rows) || rows.length > MAX_CUES || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= rows.length) throw new Error('Choose existing reviewed lines for preview.');
  let cues: Cue[];
  try { cues = reviewedCues(rows.slice(first, last + 1), duration); }
  catch (error) { throw new Error((error instanceof Error ? error.message : 'Check reviewed words and times.').replace(/Line (\d+)/g, (_, number) => `Line ${Number(number) + first}`)); }
  if (!cues.length) throw new Error('Include at least one reviewed line to preview.');
  return { cues, indices: rows.slice(first, last + 1).flatMap((row, index) => row.excluded ? [] : [first + index]) };
}
