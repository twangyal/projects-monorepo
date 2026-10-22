import { validateCues, type Cue } from './lyrics.ts';

function validIndex(cues: Cue[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= cues.length) throw new Error('Select an existing lyric line.');
}

/** Translate normalized textarea UTF-16 coordinates without changing literal text. */
export function splitCue(cues: Cue[], index: number, caret: number, time: number, duration: number): Cue[] {
  const next = validateCues(cues, duration); validIndex(next, index);
  const cue = next[index];
  if (!Number.isInteger(caret) || caret <= 0) throw new Error('Place the text caret inside the lyric line, leaving words on both sides.');
  let offset = 0, displayed = 0;
  while (offset < cue.text.length && displayed < caret) {
    if (cue.text[offset] === '\r' && cue.text[offset + 1] === '\n') offset++;
    offset++; displayed++;
  }
  if (displayed !== caret || offset === cue.text.length) throw new Error('Place the text caret inside the lyric line, leaving words on both sides.');
  const left = cue.text.charCodeAt(offset - 1), right = cue.text.charCodeAt(offset);
  if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) throw new Error('Place the caret between complete Unicode code points.');
  if (!Number.isFinite(time) || time <= cue.start || time >= cue.end) throw new Error('Seek the audio playhead strictly inside this line’s start and end before splitting.');
  next.splice(index, 1, { start: cue.start, end: time, text: cue.text.slice(0, offset) },
    { start: time, end: cue.end, text: cue.text.slice(offset) });
  return validateCues(next, duration);
}

/** Deliberately spans any gap; literal words are joined with one new line. */
export function mergeCue(cues: Cue[], index: number, duration: number): Cue[] {
  const next = validateCues(cues, duration); validIndex(next, index);
  if (index + 1 === next.length) throw new Error('The last lyric line has no next line to merge.');
  const first = next[index], second = next[index + 1];
  next.splice(index, 2, { start: first.start, end: second.end, text: `${first.text}\n${second.text}` });
  return validateCues(next, duration);
}

export interface CuePassage { firstIndex: number; lastIndex: number }

/** Shift all cues or one inclusive passage; validate the whole graph without cropping. */
export function shiftCues(cues: Cue[], duration: number, rawSeconds: string, passage?: CuePassage): Cue[] {
  const raw = rawSeconds.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) === 0) {
    throw new Error('Enter a nonzero finite timing shift in seconds. Positive moves later; negative moves earlier.');
  }
  const before = validateCues(cues, duration);
  if (!before.length) throw new Error('Create at least one valid lyric line before shifting timing.');
  for (let index = 0; index < before.length; index++) {
    if (!before[index]) throw new Error('Supply every lyric line before shifting timing.');
  }
  const first = passage === undefined ? 0 : passage.firstIndex, last = passage === undefined ? before.length - 1 : passage.lastIndex;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= before.length) {
    throw new Error('Choose an ordered passage range of existing lyric lines.');
  }
  const delta = Number(raw), selected = (index: number) => index >= first && index <= last;
  const after = validateCues(before.map((cue, index) => selected(index)
    ? { ...cue, start: cue.start + delta, end: cue.end + delta } : cue), duration);
  if (after.some((cue, index) => selected(index) && (cue.start === before[index].start || cue.end === before[index].end))) {
    throw new Error('The shift is too small to change every boundary. Choose a larger number of seconds.');
  }
  return after;
}

/** Copy an inclusive passage into an empty span; preserve its relative timing. */
export function copyCues(cues: Cue[], duration: number, rawSeconds: string, passage: CuePassage): { cues: Cue[]; insertIndex: number } {
  const raw = rawSeconds.trim();
  if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(Number(raw))) {
    throw new Error('Enter a finite destination start time at or after zero.');
  }
  const before = validateCues(cues, duration);
  for (let index = 0; index < before.length; index++) {
    if (!before[index]) throw new Error('Supply every lyric line before copying a passage.');
  }
  validIndex(before, passage.firstIndex); validIndex(before, passage.lastIndex);
  if (passage.lastIndex < passage.firstIndex) throw new Error('Choose an ordered passage of existing lyric lines.');
  const source = before.slice(passage.firstIndex, passage.lastIndex + 1), start = Number(raw);
  const copies = source.map(cue => ({ ...cue, start: start + (cue.start - source[0].start), end: start + (cue.end - source[0].start) }));
  const end = copies[copies.length - 1].end;
  if (before.some(cue => cue.start < end && cue.end > start)) throw new Error('The complete copied passage must fit in an empty span without overlapping existing lines.');
  const nextIndex = before.findIndex(cue => cue.start >= end), insertIndex = nextIndex < 0 ? before.length : nextIndex;
  before.splice(insertIndex, 0, ...copies);
  return { cues: validateCues(before, duration), insertIndex };
}
