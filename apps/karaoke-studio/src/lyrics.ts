export interface Cue { start: number; end: number; text: string }
export interface Project { schemaVersion: 1; id: string; title: string; duration: number; revision: number; cues: Cue[] }

export function validateCues(cues: Cue[], duration: number): Cue[] {
  if (!Number.isFinite(duration) || duration < 1 || duration > 30) throw new Error('Choose a clip between 1 and 30 seconds.');
  if (!Array.isArray(cues) || cues.length > 40) throw new Error('Use at most 40 lyric lines.');
  let previous = 0, characters = 0;
  return cues.map((cue, index) => {
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previous || cue.end <= cue.start || cue.end > duration) throw new Error(`Line ${index + 1}: choose nonoverlapping start/end times within the clip.`);
    if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 240) throw new Error(`Line ${index + 1}: enter 1–240 characters.`);
    characters += cue.text.length;
    if (characters > 5000) throw new Error('Use at most 5,000 lyric characters.');
    previous = cue.end;
    return { start: cue.start, end: cue.end, text: cue.text };
  });
}
export function draftCues(text: string, duration: number): Cue[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
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
