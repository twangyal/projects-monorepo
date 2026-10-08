import { validateComposition } from './model.ts';
import type { Composition } from './types.ts';

export interface BackedFramePlan {
  sampleRate: number;
  countInFrame: number;
  clickFrames: readonly number[];
  startFrame: number;
  limitFrame: number;
  maxFrames: number;
}

export function backingComposition(composition: Composition, targetId: string): Composition {
  const source = validateComposition(composition);
  if (typeof targetId !== 'string' || !source.tracks.some(track => track.id === targetId)) {
    throw new Error('Select an existing destination track before recording with backing.');
  }
  const tracks = source.tracks.filter(track => track.id !== targetId);
  if (!tracks.some(track => !track.muted && track.volume > 0
    && track.notes.some(note => note.velocity > 0 && note.start * 60 / source.tempo < 20))) {
    throw new Error('Add or unmute an audible backing part within the first 20 seconds, or use ordinary recording.');
  }
  return { ...source, tracks };
}

function frame(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('The backed recording frame clock is outside its supported range.');
  return value;
}

export function backedFramePlan(sampleRate: number, tempo: number, contextSeconds: number): BackedFramePlan {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000
    || !Number.isFinite(tempo) || tempo < 40 || tempo > 240
    || !Number.isFinite(contextSeconds) || contextSeconds < 0) {
    throw new Error('Use a finite running audio clock, an 8–192 kHz integer rate and a 40–240 BPM tempo.');
  }
  const countInFrame = frame(Math.ceil((contextSeconds + .1) * sampleRate));
  const clickFrames = [0, 1, 2, 3].map(beat => frame(countInFrame + Math.round(beat * 60 * sampleRate / tempo)));
  const startFrame = frame(countInFrame + Math.round(4 * 60 * sampleRate / tempo));
  const maxFrames = frame(Math.floor(20 * sampleRate));
  const limitFrame = frame(startFrame + maxFrames);
  return { sampleRate, countInFrame, clickFrames, startFrame, limitFrame, maxFrames };
}
