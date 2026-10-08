import { MAX_COMPOSITION_BEATS, MAX_RENDER_FRAMES } from './limits.ts';
import type { Composition, Note } from './types.ts';

const MIN_HZ = 440 * 2 ** ((36 - 69) / 12);
const MAX_HZ = 440 * 2 ** ((96 - 69) / 12);
const MAX_SECONDS = 20;
const RELEASE = 0.08;
const OSCILLATOR_TABLE_SIZE = 4096;
const oscillatorTables = {
  sine: Float64Array.from({ length: OSCILLATOR_TABLE_SIZE + 1 }, (_, i) => Math.sin(2 * Math.PI * i / OSCILLATOR_TABLE_SIZE)),
  triangle: Float64Array.from({ length: OSCILLATOR_TABLE_SIZE + 1 }, (_, i) => {
    const phase = i / OSCILLATOR_TABLE_SIZE;
    return phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4;
  }),
  sawtooth: Float64Array.from({ length: OSCILLATOR_TABLE_SIZE + 1 }, (_, i) => 2 * i / OSCILLATOR_TABLE_SIZE - 1),
};

function checkSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Sample rate must be between 8000 and 192000 Hz.');
  }
}

function checkTempo(tempo: number): void {
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240) {
    throw new RangeError('Tempo must be between 40 and 240 BPM.');
  }
}

/** Average before decimating, keeping pitch analysis small at microphone sample rates. */
function downsample(samples: Float32Array, sampleRate: number, maximumLength = samples.length): { samples: Float32Array; rate: number } {
  const stride = Math.max(1, Math.floor(sampleRate / 11025));
  const length = Math.floor(Math.min(samples.length, maximumLength) / stride);
  const reduced = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (let j = 0; j < stride; j++) value += samples[i * stride + j];
    reduced[i] = value / stride;
  }
  return { samples: reduced, rate: sampleRate / stride };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  let mean = 0;
  for (const sample of samples) { sum += sample * sample; mean += sample; }
  return samples.length ? Math.sqrt(Math.max(0, sum / samples.length - (mean / samples.length) ** 2)) : 0;
}

function isHighTone(samples: Float32Array, sampleRate: number): boolean {
  // Coarse integer-lag analysis can mistake an above-range sinusoid for an
  // octave below. Verify that signal's shorter period with fractional lags.
  let mean = 0;
  for (const sample of samples) mean += sample;
  mean /= samples.length;
  let firstCrossing = -1;
  let lastCrossing = -1;
  let crossingCount = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] <= mean && samples[i] > mean) {
      const crossing = i - 1 + (mean - samples[i - 1]) / (samples[i] - samples[i - 1]);
      if (firstCrossing < 0) firstCrossing = crossing;
      lastCrossing = crossing;
      crossingCount++;
    }
  }
  const period = (lastCrossing - firstCrossing) / (crossingCount - 1);
  if (crossingCount < 3 || sampleRate / period <= MAX_HZ * 1.05) return false;
  const lag = Math.floor(period);
  const fraction = period - lag;
  let dot = 0;
  let originalEnergy = 0;
  let shiftedEnergy = 0;
  for (let i = 0; i + lag + 1 < samples.length; i++) {
    const original = samples[i] - mean;
    const shifted = samples[i + lag] * (1 - fraction) + samples[i + lag + 1] * fraction - mean;
    dot += original * shifted;
    originalEnergy += original * original;
    shiftedEnergy += shifted * shifted;
  }
  return dot / Math.sqrt(originalEnergy * shiftedEnergy) > 0.98;
}

/** YIN normalized difference: useful for clean monophonic tones, not measured vocal accuracy. */
function estimatePitch(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < sampleRate / MIN_HZ * 2.5 || rms(samples) < 0.008) return null;
  if (isHighTone(samples, sampleRate)) return null;
  const maximumLag = Math.ceil(sampleRate / MIN_HZ) + 2;
  const comparisonLength = samples.length - maximumLag;
  const difference = new Float64Array(maximumLag + 1);
  let cumulative = 0;
  for (let lag = 1; lag <= maximumLag; lag++) {
    let sum = 0;
    for (let i = 0; i < comparisonLength; i++) {
      const delta = samples[i] - samples[i + lag];
      sum += delta * delta;
    }
    cumulative += sum;
    difference[lag] = cumulative > 0 ? sum * lag / cumulative : 1;
  }
  // Start below C7's minimum lag so an out-of-range high tone is rejected
  // instead of reported as its in-range subharmonic.
  for (let lag = 2; lag < maximumLag; lag++) {
    if (difference[lag] >= 0.08) continue;
    while (lag + 1 < maximumLag && difference[lag + 1] < difference[lag]) lag++;
    const left = difference[lag - 1];
    const middle = difference[lag];
    const right = difference[lag + 1];
    const denominator = left - 2 * middle + right;
    const offset = denominator ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator))) : 0;
    const hz = sampleRate / (lag + offset);
    return hz >= MIN_HZ * 0.98 && hz <= MAX_HZ * 1.02 ? hz : null;
  }
  return null;
}

export function detectPitch(samples: Float32Array, sampleRate: number): number | null {
  checkSampleRate(sampleRate);
  const reduced = downsample(samples, sampleRate, Math.ceil(sampleRate * 0.1));
  return estimatePitch(reduced.samples, reduced.rate);
}

/** Quarter-beat notes from at most 20 seconds of monophonic audio; corrections may be needed. */
export function transcribe(samples: Float32Array, sampleRate: number, tempo: number): Note[] {
  checkSampleRate(sampleRate);
  checkTempo(tempo);
  const reduced = downsample(samples, sampleRate, sampleRate * MAX_SECONDS);
  const hop = Math.round(reduced.rate * 0.02);
  const halfWindow = 512;
  const frames: { pitch: number | null; level: number; time: number }[] = [];
  for (let center = 0; center < reduced.samples.length; center += hop) {
    const frame = reduced.samples.subarray(Math.max(0, center - halfWindow), Math.min(reduced.samples.length, center + halfWindow));
    const hz = estimatePitch(frame, reduced.rate);
    frames.push({ pitch: hz === null ? null : Math.max(36, Math.min(96, Math.round(69 + 12 * Math.log2(hz / 440)))), level: rms(frame), time: center / reduced.rate });
  }
  // Suppress a one-frame pitch excursion without moving sustained note changes.
  const pitches = frames.map(frame => frame.pitch);
  for (let i = 1; i + 1 < frames.length; i++) {
    if (pitches[i - 1] === pitches[i + 1]) frames[i].pitch = pitches[i - 1];
  }
  const notes: Note[] = [];
  const quarterBeat = (seconds: number) => Math.round(seconds * tempo / 60 * 4) / 4;
  let first = 0;
  while (first < frames.length && notes.length < 256) {
    const pitch = frames[first].pitch;
    let end = first + 1;
    let level = frames[first].level;
    while (end < frames.length && frames[end].pitch === pitch) { level += frames[end].level; end++; }
    const startSeconds = Math.max(0, frames[first].time - hop / reduced.rate / 2);
    const endSeconds = Math.min(reduced.samples.length / reduced.rate, (frames[end - 1].time + hop / reduced.rate / 2));
    if (pitch !== null && endSeconds - startSeconds >= 0.06) {
      let start = quarterBeat(startSeconds);
      const finish = Math.min(MAX_COMPOSITION_BEATS, Math.max(start + 0.25, quarterBeat(endSeconds)));
      const velocity = Math.max(0.1, Math.min(1, level / (end - first) * 2));
      while (start < finish && notes.length < 256) {
        const duration = Math.min(16, finish - start);
        notes.push({ id: crypto.randomUUID(), pitch, start, duration, velocity });
        start += duration;
      }
    }
    first = end;
  }
  return notes;
}

/** Deterministic local synthesis, with short release tails and peak-limited mixing. */
export function renderComposition(project: Composition, sampleRate = 22050): Float32Array {
  checkSampleRate(sampleRate);
  checkTempo(project.tempo);
  const secondsPerBeat = 60 / project.tempo;
  let endBeat = 0;
  for (const track of project.tracks) for (const note of track.notes) endBeat = Math.max(endBeat, note.start + note.duration);
  // The caller supplies a validated Composition; guard allocation nonetheless.
  if (!Number.isFinite(endBeat) || endBeat < 0 || endBeat > MAX_COMPOSITION_BEATS) throw new RangeError(`Composition exceeds ${MAX_COMPOSITION_BEATS} beats.`);
  if (endBeat === 0) return new Float32Array();
  const frames = Math.ceil((endBeat * secondsPerBeat + RELEASE) * sampleRate);
  if (!Number.isSafeInteger(frames) || frames > MAX_RENDER_FRAMES) throw new RangeError('Rendered audio exceeds the frame budget. Lower the sample rate or shorten the composition.');
  const result = new Float32Array(frames);
  const groups = new Map<string, { note: Note; instrument: typeof project.tracks[number]['instrument']; gain: number }>();
  for (const track of project.tracks) {
    if (track.muted || track.volume === 0) continue;
    for (const note of track.notes) {
      if (note.velocity === 0) continue;
      const key = `${track.instrument}:${note.pitch}:${note.start}:${note.duration}`;
      const gain = track.volume * note.velocity * 0.4;
      const existing = groups.get(key);
      if (existing) existing.gain += gain;
      else groups.set(key, { note, instrument: track.instrument, gain });
    }
  }
  // Identical oscillators add linearly. Sum their gains once to avoid rendering
  // duplicate sample streams and accumulating thousands of Float32 rounding errors.
  const voices = new Map<string, { note: Note; instrument: typeof project.tracks[number]['instrument']; placements: { start: number; gain: number }[] }>();
  for (const { note, instrument, gain } of groups.values()) {
    const key = `${instrument}:${note.pitch}:${note.duration}`;
    const placement = { start: Math.round(note.start * secondsPerBeat * sampleRate), gain };
    const existing = voices.get(key);
    if (existing) existing.placements.push(placement);
    else voices.set(key, { note, instrument, placements: [placement] });
  }
  // Render each distinct pitch/duration only once, then mix its placements.
  // Keeping only the current waveform bounds extra memory to one note's length.
  for (const { note, instrument, placements } of voices.values()) {
    const hz = 440 * 2 ** ((note.pitch - 69) / 12);
    const duration = note.duration * secondsPerBeat;
    const durationSamples = duration * sampleRate;
    const releaseSamples = RELEASE * sampleRate;
    const attackSamples = 0.01 * sampleRate;
    const length = Math.ceil((duration + RELEASE) * sampleRate);
    const step = hz / sampleRate * OSCILLATOR_TABLE_SIZE;
    const table = oscillatorTables[instrument];
    const waveform = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      const position = (i * step) % OSCILLATOR_TABLE_SIZE;
      const index = Math.floor(position);
      const fraction = position - index;
      const wave = table[index] + (table[index + 1] - table[index]) * fraction;
      const envelope = i < attackSamples ? i / attackSamples : i <= durationSamples ? 1 : Math.max(0, 1 - (i - durationSamples) / releaseSamples);
      waveform[i] = wave * envelope;
    }
    for (const { start, gain } of placements) {
      const mixLength = Math.min(length, result.length - start);
      for (let i = 0; i < mixLength; i++) result[start + i] += waveform[i] * gain;
    }
  }
  let peak = 0;
  for (const sample of result) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.95) for (let i = 0; i < result.length; i++) result[i] *= 0.95 / peak;
  return result;
}

export function createDemoMelody(sampleRate = 22050): Float32Array {
  checkSampleRate(sampleRate);
  const notes = [60, 64, 67, 64, 62, 60].map((pitch, i) => ({ id: `demo-${i}`, pitch, start: i * 1.25, duration: 1, velocity: 0.8 }));
  return renderComposition({ version: 1, title: 'Demo melody', tempo: 120, tracks: [{ id: 'demo-track', name: 'Melody', instrument: 'sine', volume: 1, muted: false, notes }] }, sampleRate);
}
