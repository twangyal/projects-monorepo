import { validateComposition } from './model.ts';
import type { Composition } from './types.ts';

/** Keep all endpoints for aligned output; only the selected committed part sounds. */
export function isolatedTrack(project: Composition, trackId: string): Composition {
  const snapshot = validateComposition(project);
  const selected = snapshot.tracks.find(track => track.id === trackId);
  if (!selected) throw new Error('Selected track was not found.');
  if (selected.muted) throw new Error('Unmute this track before solo playback or track WAV export.');
  if (selected.volume === 0) throw new Error('Raise this track’s volume before solo playback or track WAV export.');
  if (!selected.notes.some(note => note.velocity > 0)) throw new Error('Add an audible note before solo playback or track WAV export.');
  for (const track of snapshot.tracks) if (track.id !== trackId) track.muted = true;
  return snapshot;
}
