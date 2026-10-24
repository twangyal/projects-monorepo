import { validateComposition } from './model.ts';
import type { Composition } from './types.ts';

/** Move one boundary voice beyond the opposite pitch, preserving its pitch class. */
export function cycleChordVoicing(input: Composition, trackId: string, noteId: string, direction: unknown): Composition {
  const next = validateComposition(input), track = next.tracks.find(item => item.id === trackId), selected = track?.notes.find(note => note.id === noteId);
  if (!track || !selected) throw new Error('Choose an existing chord note in the selected track.');
  if (track.instrument === 'drums') throw new Error('Chord voicing requires a melodic track, not drums.');
  if (direction !== 'up' && direction !== 'down') throw new Error('Choose a supported chord voicing direction.');
  const voices = track.notes.filter(note => note.start === selected.start);
  if (voices.length < 2) throw new Error('Choose at least two notes at the exact same start beat to cycle a chord voicing.');
  if (new Set(voices.map(note => note.pitch)).size !== voices.length) throw new Error('Unison duplicates at this onset are ambiguous. Use distinct chord pitches.');
  const ordered = [...voices].sort((a, b) => a.pitch - b.pitch), low = ordered[0], high = ordered.at(-1)!;
  const octaves = Math.floor((high.pitch - low.pitch) / 12) + 1;
  const moved = direction === 'up' ? low : high;
  const pitch = moved.pitch + (direction === 'up' ? 12 : -12) * octaves;
  if (pitch < 36 || pitch > 96) throw new Error('The new chord voice must stay within C2–C7 (MIDI36–96).');
  if (track.notes.some(other => other.id !== moved.id && other.pitch === pitch && other.start < moved.start + moved.duration && other.start + other.duration > moved.start)) throw new Error('The moved chord voice would introduce a same-pitch overlap. Edit the other voice first.');
  moved.pitch = pitch;
  return validateComposition(next);
}
