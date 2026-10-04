import { MAX_CUES, MAX_DURATION, type Cue } from './lyrics.ts';

export type CueBoundary = 'start' | 'end';
export interface TimeWindow { start: number; end: number }

function validDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration >= 1 && duration <= MAX_DURATION;
}

/** Deliberately ignore text validity: an invalid lyric draft is still editable. */
export function timingError(cues: readonly Cue[], duration: number): string | null {
  if (!validDuration(duration)) return 'Choose a clip between 1 and 300 seconds.';
  if (!Array.isArray(cues) || cues.length > MAX_CUES) return 'Use at most 200 lyric lines.';
  let previousEnd = 0;
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)
      || cue.start < previousEnd || cue.end <= cue.start || cue.end > duration) {
      return `Line ${index + 1}: choose ordered, nonoverlapping times within the clip.`;
    }
    previousEnd = cue.end;
  }
  return null;
}

/** Return a detached candidate; never repair overlap or mutate the live draft. */
export function proposeBoundary(cues: readonly Cue[], duration: number, index: number, boundary: CueBoundary, value: number): Cue[] {
  const existingError = timingError(cues, duration);
  if (existingError) throw new Error(existingError);
  if (!Number.isInteger(index) || index < 0 || index >= cues.length) throw new Error('Choose an existing lyric line.');
  if (boundary !== 'start' && boundary !== 'end') throw new Error('Choose the start or end boundary.');
  if (!Number.isFinite(value)) throw new Error('Choose a finite boundary time.');
  const candidate = cues.map(cue => ({ ...cue }));
  candidate[index][boundary] = value;
  const candidateError = timingError(candidate, duration);
  if (candidateError) throw new Error(candidateError);
  return candidate;
}

/** Snap movement, not the imported original. Half ticks round toward +infinity. */
export function quantizeBoundaryDelta(original: number, deltaSeconds: number, duration: number): number {
  if (!validDuration(duration) || !Number.isFinite(original) || original < 0 || original > duration
    || !Number.isFinite(deltaSeconds)) throw new Error('Choose finite boundary times inside the clip.');
  if (deltaSeconds === 0) return original;
  const target = original + deltaSeconds;
  // Explicit outer-edge targeting must reach non-grid clip endpoints as well.
  if (target <= 0) return 0;
  if (target >= duration) return duration;
  const ticks = Math.round(deltaSeconds / 0.01);
  if (ticks === 0) return original;
  return Math.max(0, Math.min(duration, original + ticks / 100));
}

export function timeWindow(duration: number, span: 5 | 15 | 60, center: number): TimeWindow {
  if (!validDuration(duration) || ![5, 15, 60].includes(span) || !Number.isFinite(center)) {
    throw new Error('Choose a valid clip, window size and center time.');
  }
  const length = Math.min(span, duration);
  const boundedCenter = Math.max(0, Math.min(duration, center));
  const start = Math.max(0, Math.min(duration - length, boundedCenter - length / 2));
  return { start, end: start === duration - length ? duration : start + length };
}

function validateCoordinates(window: TimeWindow, width: number): void {
  if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end)
    || window.start < 0 || window.end <= window.start || window.end > MAX_DURATION
    || !Number.isFinite(width) || width < 1 || width > 8192) {
    throw new Error('Choose a finite view window and a width between 1 and 8192 pixels.');
  }
}

export function timeToPixel(time: number, window: TimeWindow, width: number): number {
  validateCoordinates(window, width);
  if (!Number.isFinite(time)) throw new Error('Choose a finite time.');
  if (time <= window.start) return 0;
  if (time >= window.end) return width;
  return (time - window.start) / (window.end - window.start) * width;
}

export function pixelToTime(x: number, window: TimeWindow, width: number): number {
  validateCoordinates(window, width);
  if (!Number.isFinite(x)) throw new Error('Choose a finite pixel position.');
  if (x <= 0) return window.start;
  if (x >= width) return window.end;
  return window.start + x / width * (window.end - window.start);
}
