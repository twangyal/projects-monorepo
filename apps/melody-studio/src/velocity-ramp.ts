import { compositionDurationBeats, validateComposition } from './model.ts';
import { sectionWindow, type SectionRange } from './section.ts';
import type { Composition } from './types.ts';

/** Shape note-onset dynamics on one track without splitting notes or touching audio. */
export function applyVelocityRamp(project: Composition, trackId: string, range: SectionRange, first: number, last: number): Composition {
  const next = validateComposition(project);
  if (![first, last].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Ramp velocities must be numbers from 0 to 1.');
  sectionWindow(range.start, range.end, next.tempo, compositionDurationBeats(next), 22050);
  const track = next.tracks.find(t => t.id === trackId);
  if (!track) throw new Error('Choose an existing track.');
  const start = Number(range.start) - 1, end = Number(range.end) - 1;
  const notes = track.notes.filter(note => note.start >= start && note.start < end);
  if (!notes.length) throw new Error('The selected track has no note onsets in this section.');
  const earliest = Math.min(...notes.map(n => n.start)), latest = Math.max(...notes.map(n => n.start));
  if (earliest === latest) throw new Error('Choose at least two distinct note onsets for a velocity ramp.');
  for (const note of notes) note.velocity = note.start === earliest ? first : note.start === latest ? last : first + (last - first) * (note.start - earliest) / (latest - earliest);
  return validateComposition(next);
}
