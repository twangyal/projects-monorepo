import { FPS } from './model.ts';

// The first rAF timestamp can precede the clock read in the play handler.
// Keep endpoint/loop handling with the caller, but never move before its start.
export function playbackFrame(from: number, elapsedMs: number): number {
  return from + Math.floor(Math.max(0, elapsedMs) * FPS / 1000);
}
