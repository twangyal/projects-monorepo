/** Session-only, one-based beat range; the end is exclusive. */
export interface SectionRange { start: string; end: string }
export interface SectionFrames { startFrame: number; endFrame: number }
export function sectionWindow(start: string, end: string, tempo: number, durationBeats: number, sampleRate: number): SectionFrames {
  if (!start.trim() || !end.trim()) throw new Error('Enter both section beat bounds.');
  const first = Number(start), last = Number(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || first < 1 || last <= first) throw new Error('Section end must be after start; use finite beats starting at 1.');
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid section audio settings.');
  if (!Number.isFinite(durationBeats) || durationBeats <= 0 || durationBeats > 128 || last > durationBeats + 1) throw new Error(`Section must fit the composition (end beat at most ${durationBeats + 1}).`);
  const startFrame = Math.round((first - 1) * 60 / tempo * sampleRate);
  const endFrame = Math.round((last - 1) * 60 / tempo * sampleRate);
  if (endFrame <= startFrame) throw new Error('Section must contain at least one audio frame.');
  return { startFrame, endFrame };
}
/** Copy the mix without retriggering crossing notes or changing gain. */
export function cropSection(samples: Float32Array, window: SectionFrames): Float32Array {
  const { startFrame, endFrame } = window;
  if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame <= startFrame || endFrame > samples.length) throw new Error('Section frames are outside the rendered mix.');
  return samples.slice(startFrame, endFrame);
}
