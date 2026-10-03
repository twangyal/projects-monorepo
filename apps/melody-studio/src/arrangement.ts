import { validateComposition } from './model.ts';
import type { Composition, Track } from './types.ts';

function selectedTrack(project: Composition, trackId: string): { composition: Composition; track: Track; index: number } {
  const composition = validateComposition(project);
  const index = composition.tracks.findIndex(track => track.id === trackId);
  if (index === -1) throw new Error('Selected track was not found.');
  return { composition, track: composition.tracks[index], index };
}

export function duplicateTrack(project: Composition, trackId: string): Composition {
  const { composition, track, index } = selectedTrack(project, trackId);
  if (composition.tracks.length === 8) throw new Error('A composition can have at most 8 tracks.');
  const copy: Track = {
    ...track,
    id: crypto.randomUUID(),
    name: `${track.name.slice(0, 75)} copy`,
    notes: track.notes.map(note => ({ ...note, id: crypto.randomUUID() })),
  };
  composition.tracks.splice(index + 1, 0, copy);
  return validateComposition(composition);
}

export function transposeTrack(project: Composition, trackId: string, semitones: number): Composition {
  const { composition, track } = selectedTrack(project, trackId);
  if (![-12, -1, 1, 12].includes(semitones)) throw new Error('Transpose must use -12, -1, 1 or 12 semitones.');
  if (track.notes.length === 0) throw new Error('Add notes before transposing this track.');
  if (track.notes.some(note => note.pitch + semitones < 36 || note.pitch + semitones > 96)) {
    throw new Error('Transposed pitches must stay within C2–C7 (MIDI 36–96).');
  }
  track.notes = track.notes.map(note => ({ ...note, pitch: note.pitch + semitones }));
  return validateComposition(composition);
}

export function repeatTrack(project: Composition, trackId: string): Composition {
  const { composition, track } = selectedTrack(project, trackId);
  if (track.notes.length === 0) throw new Error('Add notes before repeating this track.');
  if (track.notes.length * 2 > 256) throw new Error('Repeating would exceed the limit of 256 notes per track.');
  const firstStart = Math.min(...track.notes.map(note => note.start));
  const lastEnd = Math.max(...track.notes.map(note => note.start + note.duration));
  // The initial rest is outside the phrase, so it occurs only once.
  const span = lastEnd - firstStart;
  if (lastEnd + span > 128) throw new Error('Repeated notes must end by beat 128.');
  const copies = track.notes.map(note => ({ ...note, id: crypto.randomUUID(), start: note.start + span }));
  track.notes.push(...copies);
  return validateComposition(composition);
}
