import { limitPeak, renderDry } from './audio.ts';
import { DEFAULT_REVERB } from './mix-settings.ts';
import type { Composition, ReverbBus, Track } from './types.ts';

export { DEFAULT_REVERB, validatePan, validateReverb, validateSend } from './mix-settings.ts';

/**
 * Stereo mixing stage: per-track pan and reverb send, and one shared reverb bus.
 *
 * Pan uses a balance law: a centred track keeps unity gain in both channels, and panning only
 * attenuates the opposite side. A project that uses none of these features renders through the
 * original mono path, so its samples (and mono WAV exports) are unchanged.
 */
const STEREO_SPREAD = 23;
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];

/** Left/right gains for a pan position from -1 (left) to +1 (right). */
export function panGains(pan: number): [number, number] {
  return [pan > 0 ? 1 - pan : 1, pan < 0 ? 1 + pan : 1];
}

function audible(track: Track): boolean { return !track.muted && track.volume > 0 && track.notes.some(note => note.velocity > 0); }

/** True when any audible track is panned or sends to the reverb bus. */
export function usesStereoMix(project: Composition): boolean {
  return project.tracks.some(track => audible(track) && ((track.pan ?? 0) !== 0 || (track.reverbSend ?? 0) > 0));
}

/** Seconds of reverb tail added after the last sound. */
export function reverbTail(bus: ReverbBus): number { return 0.75 + 3.25 * bus.size; }

/** Deterministic Freeverb-style stereo reverb of a mono send (wet signal only). */
export function reverb(input: Float32Array, sampleRate: number, bus: ReverbBus): [Float32Array, Float32Array] {
  const scale = sampleRate / 44100, feedback = 0.7 + 0.28 * bus.size, damp = 0.35;
  const channel = (spread: number): Float32Array => {
    const combs = COMBS.map(length => ({ buffer: new Float32Array(Math.max(1, Math.round((length + spread) * scale))), index: 0, store: 0 }));
    const passes = ALLPASSES.map(length => ({ buffer: new Float32Array(Math.max(1, Math.round((length + spread) * scale))), index: 0 }));
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const sample = input[i]! * 0.015;
      let sum = 0;
      for (const comb of combs) {
        const delayed = comb.buffer[comb.index]!;
        comb.store = delayed * (1 - damp) + comb.store * damp;
        comb.buffer[comb.index] = sample + comb.store * feedback;
        comb.index = (comb.index + 1) % comb.buffer.length;
        sum += delayed;
      }
      for (const pass of passes) {
        const delayed = pass.buffer[pass.index]!;
        pass.buffer[pass.index] = sum + delayed * 0.5;
        pass.index = (pass.index + 1) % pass.buffer.length;
        sum = delayed - sum;
      }
      out[i] = sum * 3 * bus.level;
    }
    return out;
  };
  return [channel(0), channel(STEREO_SPREAD)];
}

/**
 * Render the composition as one (mono, unchanged legacy path) or two channels (stereo mix).
 * Tracks are rendered dry and unlimited, panned and summed with the reverb return, then the
 * whole mix is peak-limited across both channels together.
 */
export function renderMix(project: Composition, sampleRate = 22050): Float32Array[] {
  if (!usesStereoMix(project)) {
    const mono = renderDry(project, sampleRate);
    limitPeak([mono]);
    return [mono];
  }
  const bus = project.reverb ?? DEFAULT_REVERB;
  const sends = project.tracks.some(track => audible(track) && (track.reverbSend ?? 0) > 0);
  const tail = sends ? reverbTail(bus) : 0;
  const length = renderDry(project, sampleRate, '\u0000no-track', tail).length;
  const left = new Float32Array(length), right = new Float32Array(length), send = sends ? new Float32Array(length) : null;
  for (const track of project.tracks) {
    if (!audible(track)) continue;
    const dry = renderDry(project, sampleRate, track.id, tail);
    const [gainLeft, gainRight] = panGains(track.pan ?? 0), amount = track.reverbSend ?? 0;
    for (let i = 0; i < length; i++) {
      left[i] += dry[i]! * gainLeft;
      right[i] += dry[i]! * gainRight;
    }
    if (send && amount > 0) for (let i = 0; i < length; i++) send[i] += dry[i]! * amount;
  }
  if (send) {
    const [wetLeft, wetRight] = reverb(send, sampleRate, bus);
    for (let i = 0; i < length; i++) { left[i] += wetLeft[i]!; right[i] += wetRight[i]!; }
  }
  limitPeak([left, right]);
  return [left, right];
}
