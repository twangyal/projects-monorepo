import { validateCues, type Cue } from './lyrics.ts';

export function splitCue(cues: Cue[], duration: number, index: number, start: number, end: number, time: number): Cue[] {
  const proposal = validateCues(cues, duration);
  const cue = Number.isInteger(index) && index >= 0 ? proposal[index] : undefined;
  if (!cue) throw new Error('Choose a lyric line to split.');
  if (!Number.isInteger(start) || start !== end || start <= 0 || start >= cue.text.length) {
    throw new Error('Place a collapsed text caret between the two nonempty lyric halves.');
  }
  const left = cue.text.charCodeAt(start - 1), right = cue.text.charCodeAt(start);
  if (left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff) {
    throw new Error('Place the caret between complete Unicode characters.');
  }
  if (!Number.isFinite(time) || time <= cue.start || time >= cue.end) throw new Error('Seek the playhead strictly inside this lyric line before splitting.');
  proposal.splice(index, 1,
    { start: cue.start, end: time, text: cue.text.slice(0, start) },
    { start: time, end: cue.end, text: cue.text.slice(start) });
  return validateCues(proposal, duration);
}
export function mergeCue(cues: Cue[], duration: number, index: number): Cue[] {
  const proposal = validateCues(cues, duration);
  const cue = Number.isInteger(index) && index >= 0 ? proposal[index] : undefined, next = proposal[index + 1];
  if (!cue || !next) throw new Error('Choose a lyric line with a following line to merge.');
  proposal.splice(index, 2, { start: cue.start, end: next.end, text: `${cue.text}\n${next.text}` });
  return validateCues(proposal, duration);
}
