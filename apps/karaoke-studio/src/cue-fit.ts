import { validateCues, type Cue } from './lyrics.ts';
import type { CuePassage } from './cue-edit.ts';

/** Fit one inclusive passage without altering audio, literal text or outside cues. */
export function fitCues(cues: Cue[], duration: number, rawStart: string, rawEnd: string, passage: CuePassage): Cue[] {
  const numeric = (raw: string) => {
    if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) || !Number.isFinite(Number(raw))) {
      throw new Error('Enter finite passage start and end seconds at or after zero.');
    }
    return Number(raw);
  };
  const start = numeric(rawStart), end = numeric(rawEnd), before = validateCues(cues, duration);
  validateCues([{ start, end, text: 'Timing window' }], duration);
  for (let i = 0; i < before.length; i++) if (!before[i]) throw new Error('Supply every lyric line before fitting a passage.');
  const first = passage.firstIndex, last = passage.lastIndex;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= before.length) {
    throw new Error('Choose an ordered passage of existing lyric lines.');
  }
  const origin = before[first].start, finish = before[last].end;
  if (start === origin && end === finish) throw new Error('This passage already fits that window. Choose different start or end seconds.');
  // Normalize first: end/start division could overflow for a tiny valid source span.
  const map = (value: number) => start + ((value - origin) / (finish - origin)) * (end - start);
  const after = validateCues(before.map((cue, index) => index < first || index > last ? cue : {
    text: cue.text, start: index === first ? start : map(cue.start), end: index === last ? end : map(cue.end),
  }), duration);
  for (let index = first + 1; index <= last; index++) {
    if (before[index].start > before[index - 1].end && after[index].start <= after[index - 1].end) {
      throw new Error('The target window is too narrow to retain every positive lyric gap at this precision.');
    }
  }
  return after;
}
