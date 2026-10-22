import { validateComposition } from './model.ts';
import { MAX_COMPOSITION_BEATS } from './limits.ts';
import type { Composition } from './types.ts';

/** Spread one exact-onset chord's attacks; notes remain ordinary voices with unchanged lengths. */
export function rollChord(input: Composition, trackId: string, noteId: string, direction: unknown, spacing: unknown): Composition {
  const next = validateComposition(input), track = next.tracks.find(item => item.id === trackId), selected = track?.notes.find(note => note.id === noteId);
  if (!track || !selected) throw new Error('Choose an existing note in the selected track.');
  if (track.instrument === 'drums') throw new Error('Chord rolling requires a melodic track, not drums.');
  if (direction !== 'up' && direction !== 'down') throw new Error('Choose a supported roll direction.');
  if (typeof spacing !== 'number' || ![.25, .5, 1].includes(spacing)) throw new Error('Choose attack spacing of 0.25, 0.5 or 1 beat.');
  const voices = track.notes.filter(note => note.start === selected.start);
  if (voices.length < 2) throw new Error('Choose at least two notes at the exact same start beat to roll a chord.');
  if (new Set(voices.map(note => note.pitch)).size !== voices.length) throw new Error('Unison duplicates at this onset are ambiguous. Use distinct chord pitches.');
  const ordered = [...voices].sort((a, b) => direction === 'up' ? a.pitch - b.pitch : b.pitch - a.pitch), onset = selected.start;
  ordered.forEach((note, index) => { note.start = onset + index * spacing; });
  if (voices.some(note => note.start + note.duration > MAX_COMPOSITION_BEATS)) throw new Error(`Rolled notes must end by beat ${MAX_COMPOSITION_BEATS}.`);
  const ids = new Set(voices.map(note => note.id));
  const conflict = voices.some(note => track.notes.some(other => {
    if (ids.has(other.id) || other.pitch !== note.pitch) return false;
    const after = other.start < note.start + note.duration && other.start + other.duration > note.start;
    const before = other.start < onset + note.duration && other.start + other.duration > onset;
    return after && !before;
  }));
  if (conflict) throw new Error('A rolled voice would introduce a new overlap with another note of the same pitch. Edit that voice first.');

  return validateComposition(next);
}
