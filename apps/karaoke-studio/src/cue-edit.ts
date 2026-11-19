import { keptWordStarts, validateCues, MAX_CUES, SINGERS, type Cue, type Singer } from './lyrics.ts';
import { cueWords } from './word-timing.ts';

/** The line moved in time by `move`, its hand-set word starts with it. */
export function movedCue(cue: Cue, move: (time: number) => number, start = move(cue.start), end = move(cue.end)): Cue {
  return { ...cue, start, end, ...(cue.wordStarts ? { wordStarts: cue.wordStarts.map(move) } : {}) };
}

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
  // Both halves are sung by the line's singer, and keep their words' hand-set starts when the caret is between words.
  const singer = cue.singer !== undefined ? { singer: cue.singer } : {}, before = cueWords(cue.text.slice(0, offset)).length;
  const starts = (part: number[] | undefined) => (part ? { wordStarts: part } : {});
  next.splice(index, 1, { start: cue.start, end: time, text: cue.text.slice(0, offset), ...singer, ...starts(cue.wordStarts?.slice(0, before)) },
    { start: time, end: cue.end, text: cue.text.slice(offset), ...singer, ...starts(cue.wordStarts?.slice(before)) });
  return validateCues(next, duration);
}

/** Deliberately spans any gap; literal words are joined with one new line. */
export function mergeCue(cues: Cue[], index: number, duration: number): Cue[] {
  const next = validateCues(cues, duration); validIndex(next, index);
  if (index + 1 === next.length) throw new Error('The last lyric line has no next line to merge.');
  const first = next[index], second = next[index + 1];
  // Lines for different singers become one the two sing together.
  const singer = first.singer !== undefined && second.singer !== undefined && first.singer !== second.singer ? 'both' : first.singer ?? second.singer;
  next.splice(index, 2, { start: first.start, end: second.end, text: `${first.text}\n${second.text}`, ...(singer !== undefined ? { singer } : {}),
    ...(first.wordStarts && second.wordStarts ? { wordStarts: [...first.wordStarts, ...second.wordStarts] } : {}) });
  return validateCues(next, duration);
}

/**
 * Lines that take the place of others keep who sings there, so reviewing a duet's lines again keeps its parts: a line
 * without a singer takes the singer of the replaced lines it mostly covers (both, when those differ, as merging gives),
 * or else of the one it overlaps most. Exact unchanged text and boundaries also keep hand-set word starts,
 * unless the incoming cue supplies its own.
 */
export function keepSingers(replaced: readonly Cue[], cues: readonly Cue[]): Cue[] {
  return cues.map(incoming => {
    const unchanged = replaced.find(line => line.start === incoming.start && line.end === incoming.end && line.text === incoming.text);
    // Exact unchanged words/times retain manual alignment; a correction or regrouping needs fresh timing.
    const wordStarts = incoming.wordStarts === undefined ? unchanged && keptWordStarts(unchanged) : [...incoming.wordStarts];
    const cue = { ...incoming, ...(wordStarts ? { wordStarts } : {}) };
    if (cue.singer !== undefined) return cue;
    const overlap = (line: Cue) => Math.min(line.end, cue.end) - Math.max(line.start, cue.start);
    const touching = replaced.filter(line => overlap(line) > 0);
    const covered = touching.filter(line => overlap(line) * 2 > line.end - line.start);
    const from = covered.length ? covered : touching.sort((a, b) => overlap(b) - overlap(a)).slice(0, 1);
    const singers = [...new Set(from.flatMap(line => line.singer !== undefined ? [line.singer] : []))];
    const singer = singers.length > 1 ? 'both' : singers[0];
    return singer !== undefined ? { ...cue, singer } : cue;
  });
}

export interface CuePassage { firstIndex: number; lastIndex: number }

/** Assign roles without normalizing in-progress word/timing drafts. Saving still validates the complete lyrics. */
export function assignSingers(cues: Cue[], singer: unknown, passage?: CuePassage): { cues: Cue[]; changed: number } {
  if (singer !== undefined && !SINGERS.includes(singer as Singer)) throw new Error('Choose Anyone, Singer 1, Singer 2 or Both.');
  if (!Array.isArray(cues) || !cues.length || cues.length > MAX_CUES || Array.from(cues).some(cue => !cue || typeof cue !== 'object')) throw new Error('Choose existing lyric lines.');
  const first = passage === undefined ? 0 : passage.firstIndex, last = passage === undefined ? cues.length - 1 : passage.lastIndex;
  validIndex(cues, first); validIndex(cues, last);
  if (last < first) throw new Error('Choose an ordered passage of existing lyric lines.');
  let changed = 0;
  const next = cues.map((cue, index) => {
    if (index < first || index > last || cue.singer === singer) return cue;
    changed++;
    const copy = { ...cue };
    if (singer === undefined) delete copy.singer; else copy.singer = singer as Singer;
    return copy;
  });
  return { cues: changed ? next : cues, changed };
}

/** Remove literal lines, including invalid drafts, without normalizing survivors. */
export function removeCues(cues: Cue[], passage: CuePassage): Cue[] {
  if (!Array.isArray(cues) || cues.length > 200 || Array.from(cues).some(cue => !cue || typeof cue !== 'object')) throw new Error('Choose existing lyric lines.');
  validIndex(cues, passage.firstIndex); validIndex(cues, passage.lastIndex);
  if (passage.lastIndex < passage.firstIndex) throw new Error('Choose an ordered passage of existing lyric lines.');
  return [...cues.slice(0, passage.firstIndex), ...cues.slice(passage.lastIndex + 1)];
}

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
    ? movedCue(cue, time => time + delta) : cue), duration);
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
  const copies = source.map(cue => movedCue(cue, time => start + (time - source[0].start)));
  const end = copies[copies.length - 1].end;
  if (before.some(cue => cue.start < end && cue.end > start)) throw new Error('The complete copied passage must fit in an empty span without overlapping existing lines.');
  const nextIndex = before.findIndex(cue => cue.start >= end), insertIndex = nextIndex < 0 ? before.length : nextIndex;
  before.splice(insertIndex, 0, ...copies);
  return { cues: validateCues(before, duration), insertIndex };
}

/** Insert supplied words into an empty interval without moving existing cues. */
export function insertCue(cues: Cue[], duration: number, text: string, rawStart: string, rawEnd: string): { cues: Cue[]; insertIndex: number } {
  const numeric = (raw: string) => {
    if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) || !Number.isFinite(Number(raw))) {
      throw new Error('Enter finite start and end seconds at or after zero.');
    }
    return Number(raw);
  };
  const start = numeric(rawStart), end = numeric(rawEnd), before = validateCues(cues, duration);
  const cue = validateCues([{ start, end, text }], duration)[0];
  if (before.some(item => item.start < end && item.end > start)) throw new Error('The new lyric line must fit in an empty span without overlapping existing lines.');
  const next = before.findIndex(item => item.start >= end), insertIndex = next < 0 ? before.length : next;
  before.splice(insertIndex, 0, cue);
  return { cues: validateCues(before, duration), insertIndex };
}

/** Literal case-sensitive whole-editor word correction; timing is never shifted. */
export function replaceCueWords(cues: Cue[], duration: number, find: string, replacement: string): { cues: Cue[]; occurrences: number; changed: number[] } {
  if (!find.trim() || Array.from(find).length > 240) throw new Error('Enter 1–240 literal characters to replace. Matching is case-sensitive.');
  if (Array.from(replacement).length > 240) throw new Error('Replacement text: use at most 240 characters.');
  const before = validateCues(cues, duration), changed: number[] = [];
  let occurrences = 0;
  const proposed = before.map((cue, index) => {
    const parts = cue.text.split(find); occurrences += parts.length - 1;
    const text = parts.join(replacement);
    if (text !== cue.text) changed.push(index);
    return { ...cue, text };
  });
  return { cues: validateCues(proposed, duration), occurrences, changed };
}
