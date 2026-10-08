import { validateComposition } from './model.ts';
import type { Composition } from './types.ts';

export interface TimingOptions { grid: number; strength: number; swing: number }
export interface TimingChange { id: string; before: number; after: number }
export interface TimingResult { composition: Composition; changes: TimingChange[] }

/** Onsets only: odd subdivisions are delayed within each two-grid pair. */
export function quantizeTrack(project: Composition, trackId: string, options: TimingOptions): TimingResult {
  const { grid, strength, swing } = options;
  if (![1, .5, .25, .125].includes(grid) || !Number.isFinite(strength) || strength < 0 || strength > 1 || !Number.isFinite(swing) || swing < 0 || swing > .5) {
    throw new Error('Choose a supported timing grid, strength 0–100%, and swing 0–50%.');
  }
  const composition = validateComposition(project);
  const track = composition.tracks.find(item => item.id === trackId);
  if (!track) throw new Error('Selected timing track was not found.');
  if (!track.notes.length) throw new Error('Add notes before reviewing timing.');
  const changes: TimingChange[] = [];
  for (const note of track.notes) {
    const before = note.start;
    let target = 0, distance = Infinity;
    // Swing is at most half a grid step, so these neighbors bracket the nearest target.
    const index = Math.floor(before / grid);
    for (let i = Math.max(0, index - 2); i <= index + 2; i++) {
      const candidate = (i + (i % 2 ? swing : 0)) * grid;
      const delta = Math.abs(candidate - before);
      if (delta < distance || delta === distance && candidate > target) { target = candidate; distance = delta; }
    }
    note.start = strength === 0 ? before : strength === 1 ? target : before + (target - before) * strength;
    if (note.start !== before) changes.push({ id: note.id, before, after: note.start });
  }
  // A late shift can exceed the timeline: refuse the whole detached proposal.
  return { composition: validateComposition(composition), changes };
}
