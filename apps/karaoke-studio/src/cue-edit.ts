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
