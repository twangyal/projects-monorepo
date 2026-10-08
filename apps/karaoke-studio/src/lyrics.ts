export interface Cue { start: number; end: number; text: string }
export interface Project { schemaVersion: 1; id: string; title: string; duration: number; revision: number; cues: Cue[] }

export const MAX_DURATION = 300;
export const MAX_CUES = 200;
export const MAX_LYRIC_CHARS = 20000;
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

// Python str.strip() whitespace: unlike JS trim(), NEL/control separators are
// whitespace and the Unicode BOM is not. Preserve text rather than normalizing it.
function strip(text: string): string {
  // eslint-disable-next-line no-control-regex -- Python whitespace intentionally includes ASCII control separators.
  return text.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');
}
function textLength(value: unknown, limit: number, label: string, allowEmpty = false): number {
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  let count = 0;
  for (const point of value) {
    const code = point.codePointAt(0)!;
    if (code === 0 || code >= 0xd800 && code <= 0xdfff) throw new Error(`${label} must contain valid Unicode text without NUL characters.`);
    if (++count > limit) throw new Error(`${label}: use at most ${limit.toLocaleString('en-US')} characters.`);
  }
  if (!allowEmpty && !strip(value)) throw new Error(`${label}: enter 1–${limit} characters.`);
  return count;
}
export function validateTitle(title: unknown): string {
  textLength(title, 100, 'Clip title');
  return title as string;
}

export function validateCues(cues: Cue[], duration: number): Cue[] {
  if (!Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION) throw new Error('Choose a clip between 1 and 300 seconds.');
  if (!Array.isArray(cues) || cues.length > MAX_CUES) throw new Error('Use at most 200 lyric lines.');
  let previous = 0, characters = 0;
  return cues.map((cue, index) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previous || cue.end <= cue.start || cue.end > duration) throw new Error(`Line ${index + 1}: choose nonoverlapping start/end times within the clip.`);
    characters += textLength(cue.text, 240, `Line ${index + 1}`);
    if (characters > MAX_LYRIC_CHARS) throw new Error('Use at most 20,000 lyric characters.');
    previous = cue.end;
    return { start: cue.start, end: cue.end, text: cue.text };
  });
}
export function draftCues(text: string, duration: number): Cue[] {
  textLength(text, MAX_LYRIC_CHARS, 'Pasted lyrics', true);
  // eslint-disable-next-line no-control-regex -- Match Python splitlines(), including file/group/record separators.
  const lines = text.split(/\r\n|[\n\r\v\f\u001c-\u001e\u0085\u2028\u2029]/).map(strip).filter(Boolean);
  if (!lines.length) throw new Error('Paste at least one lyric line first.');
  return validateCues(lines.map((line, index) => ({ start: duration * index / lines.length, end: duration * (index + 1) / lines.length, text: line })), duration);
}
export function activeCue(cues: Cue[], time: number): number {
  return cues.findIndex(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && time >= cue.start && time < cue.end);
}
export function formatTime(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(safe / 60)}:${(safe % 60).toFixed(2).padStart(5, '0')}`;
}
