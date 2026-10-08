import { validateComposition, compositionDurationBeats } from './model.ts';
import { sectionWindow, type SectionRange } from './section.ts';
import type { Composition } from './types.ts';

/** Insert a detached all-track section copy; refuse any note split atomically. */
export function duplicateSection(project: Composition, range: SectionRange): Composition {
  const next = validateComposition(project);
  sectionWindow(range.start, range.end, next.tempo, compositionDurationBeats(next), 22050);
  const start = Number(range.start) - 1, end = Number(range.end) - 1, span = end - start;
  let count = 0;
  for (const track of next.tracks) {
    for (const note of track.notes) {
      const stop = note.start + note.duration;
      if (note.start < start && stop > start || note.start < end && stop > end) throw new Error(`A note in ${track.name} crosses a section boundary. Choose bounds that include whole notes.`);
    }
    const contained = track.notes.filter(note => note.start >= start && note.start < end);
    count += contained.length;
    if (track.notes.length + contained.length > 256) throw new Error(`Duplicating would exceed 256 notes in ${track.name}.`);
  }
  if (!count) throw new Error('The selected section contains no notes.');
  for (const track of next.tracks) {
    const copies = track.notes.filter(note => note.start >= start && note.start < end).map(note => ({ ...note, id: crypto.randomUUID(), start: note.start + span }));
    track.notes = track.notes.map(note => note.start >= end ? { ...note, start: note.start + span } : note);
    track.notes.push(...copies);
  }
  return validateComposition(next);
}
