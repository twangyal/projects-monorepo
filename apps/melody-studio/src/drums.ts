// Drum tracks: notes whose pitch is a General MIDI percussion key, played by a deterministic synthesized kit.
// A drum note is a one-shot: its sound length comes from the kit piece, not the note duration or envelope.
import { MAX_COMPOSITION_BEATS } from './limits.ts';
import type { Note, Track } from './types.ts';

/** One row of the step grid: a GM percussion key and its kit-piece name. Ordered top to bottom as shown. */
export const DRUM_ROWS: readonly { pitch: number; name: string }[] = [
  { pitch: 49, name: 'Crash' }, { pitch: 46, name: 'Open hat' }, { pitch: 42, name: 'Closed hat' }, { pitch: 50, name: 'High tom' },
  { pitch: 45, name: 'Low tom' }, { pitch: 39, name: 'Clap' }, { pitch: 38, name: 'Snare' }, { pitch: 36, name: 'Kick' },
];
/** Sixteenth-note steps, four per beat, sixteen per four-beat bar. */
export const STEP_BEATS = 0.25;
export const STEPS_PER_BAR = 16;
export const MAX_TRACK_NOTES = 256;
const EPSILON = 1e-9;

type Piece = 'kick' | 'snare' | 'clap' | 'closed-hat' | 'open-hat' | 'pedal-hat' | 'tom' | 'crash' | 'ride' | 'rim' | 'cowbell' | 'shaker' | 'tone';
const GM: Record<number, [Piece, string]> = {
  35: ['kick', 'Acoustic kick'], 36: ['kick', 'Kick'], 37: ['rim', 'Side stick'], 38: ['snare', 'Snare'], 39: ['clap', 'Clap'], 40: ['snare', 'Electric snare'],
  41: ['tom', 'Low floor tom'], 42: ['closed-hat', 'Closed hat'], 43: ['tom', 'High floor tom'], 44: ['pedal-hat', 'Pedal hat'], 45: ['tom', 'Low tom'],
  46: ['open-hat', 'Open hat'], 47: ['tom', 'Low-mid tom'], 48: ['tom', 'High-mid tom'], 49: ['crash', 'Crash'], 50: ['tom', 'High tom'], 51: ['ride', 'Ride'],
  52: ['crash', 'China'], 53: ['ride', 'Ride bell'], 54: ['shaker', 'Tambourine'], 55: ['crash', 'Splash'], 56: ['cowbell', 'Cowbell'], 57: ['crash', 'Crash 2'],
  59: ['ride', 'Ride 2'], 69: ['shaker', 'Cabasa'], 70: ['shaker', 'Maracas'], 82: ['shaker', 'Shaker'],
};
const TOM_HZ: Record<number, number> = { 41: 82, 43: 98, 45: 110, 47: 131, 48: 147, 50: 175 };

/** The kit-piece name for a percussion key; keys outside the kit play a tuned percussion tone. */
export function drumName(pitch: number): string {
  return GM[pitch]?.[1] ?? `Tuned percussion ${pitch}`;
}

function piece(pitch: number): Piece { return GM[pitch]?.[0] ?? 'tone'; }

/** Seconds a kit piece rings after its hit. */
export function drumSeconds(pitch: number): number {
  return { kick: 0.5, snare: 0.3, clap: 0.35, 'closed-hat': 0.12, 'open-hat': 0.55, 'pedal-hat': 0.15, tom: 0.55, crash: 1.8, ride: 1.2, rim: 0.08, cowbell: 0.3, shaker: 0.12, tone: 0.4 }[piece(pitch)];
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296 * 2 - 1;
  };
}

/** A first-order high-pass that removes the low body from noise; the cutoff is clamped below Nyquist. */
function highpass(samples: Float64Array, cutoff: number, sampleRate: number): Float64Array {
  const rc = 1 / (2 * Math.PI * Math.min(cutoff, sampleRate * 0.4)), alpha = rc / (rc + 1 / sampleRate);
  const result = new Float64Array(samples.length);
  let previousIn = 0, previousOut = 0;
  for (let i = 0; i < samples.length; i++) { previousOut = alpha * (previousOut + samples[i]! - previousIn); previousIn = samples[i]!; result[i] = previousOut; }
  return result;
}

function synthesize(pitch: number, sampleRate: number): Float64Array {
  const kind = piece(pitch), length = Math.ceil(drumSeconds(pitch) * sampleRate);
  const noise = random(pitch * 7919 + 17), out = new Float64Array(length);
  const white = () => { const values = new Float64Array(length); for (let i = 0; i < length; i++) values[i] = noise(); return values; };
  const sweep = (from: number, to: number, settle: number, decay: number) => {
    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate, hz = to + (from - to) * Math.exp(-t / settle);
      phase += 2 * Math.PI * hz / sampleRate;
      out[i] += Math.sin(phase) * Math.exp(-t / decay);
    }
  };
  const metal = (partials: number[], decay: number, level: number) => {
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let sum = 0;
      for (const hz of partials) sum += Math.sign(Math.sin(2 * Math.PI * Math.min(hz, sampleRate * 0.45) * t));
      out[i] += sum / partials.length * level * Math.exp(-t / decay);
    }
  };
  const hiss = (cutoff: number, decay: number, level: number, attack = 0) => {
    const filtered = highpass(white(), cutoff, sampleRate);
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      out[i] += filtered[i]! * level * Math.exp(-t / decay) * (attack ? Math.min(1, t / attack) : 1);
    }
  };
  switch (kind) {
    case 'kick': sweep(160, 48, 0.035, 0.22); for (let i = 0; i < Math.min(length, sampleRate * 0.004); i++) out[i] += 0.6 * (1 - i / (sampleRate * 0.004)); break;
    case 'snare': sweep(240, 185, 0.02, 0.07); hiss(1800, 0.11, 1.1); break;
    case 'clap': {
      const filtered = highpass(white(), 1200, sampleRate);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        // Three quick bursts, then a short room tail, as hands never strike exactly together.
        const bursts = [0, 0.011, 0.022].reduce((sum, at) => sum + (t >= at ? Math.exp(-(t - at) / 0.006) : 0), 0);
        out[i] = filtered[i]! * (bursts + 0.5 * Math.exp(-t / 0.09) * (t >= 0.022 ? 1 : 0));
      }
      break;
    }
    case 'closed-hat': hiss(7000, 0.025, 1); metal([3400, 5300, 7700], 0.02, 0.25); break;
    case 'pedal-hat': hiss(6000, 0.035, 0.9); break;
    case 'open-hat': hiss(7000, 0.18, 1); metal([3400, 5300, 7700], 0.15, 0.25); break;
    case 'tom': { const hz = TOM_HZ[pitch]!; sweep(hz * 1.6, hz, 0.04, 0.22); hiss(1200, 0.03, 0.15); break; }
    case 'crash': hiss(4500, 0.55, 1, 0.002); metal([2900, 4300, 6100, 8200], 0.4, 0.3); break;
    case 'ride': metal(pitch === 53 ? [1400, 2100, 3600] : [2500, 3900, 5600], pitch === 53 ? 0.5 : 0.35, 0.6); hiss(6000, 0.4, 0.35); break;
    case 'rim': sweep(1700, 1600, 0.01, 0.012); hiss(3000, 0.006, 0.6); break;
    case 'cowbell': metal([545, 815], 0.09, 1); break;
    case 'shaker': hiss(6500, 0.035, 1, 0.008); break;
    case 'tone': { const hz = 440 * 2 ** ((pitch - 69) / 12); sweep(hz * 1.3, hz, 0.03, 0.15); break; }
  }
  // Each kit piece peaks at 1, like the oscillators, so track volume and velocity mean the same thing.
  let peak = 0;
  for (const value of out) peak = Math.max(peak, Math.abs(value));
  if (peak > 0) for (let i = 0; i < length; i++) out[i] /= peak;
  return out;
}

const voices = new Map<string, Float64Array>();
/** The cached one-shot for a percussion key at a sample rate. Callers must not modify it. */
export function drumVoice(pitch: number, sampleRate: number): Float64Array {
  const key = `${pitch}:${sampleRate}`;
  let voice = voices.get(key);
  if (!voice) {
    if (voices.size > 256) voices.clear();
    voice = synthesize(pitch, sampleRate);
    voices.set(key, voice);
  }
  return voice;
}

/** The hit for this key starting exactly on this step, if any. */
export function stepNote(track: Track, pitch: number, beat: number): Note | undefined {
  return track.notes.find(note => note.pitch === pitch && Math.abs(note.start - beat) < EPSILON);
}

/** Turn a step on (a sixteenth-length hit) or off. Mutates the track; throws when a limit would be exceeded. */
export function toggleStep(track: Track, pitch: number, beat: number): boolean {
  if (!Number.isInteger(pitch) || pitch < 36 || pitch > 96) throw new Error('Choose a drum from the kit.');
  if (!Number.isFinite(beat) || beat < 0 || beat + STEP_BEATS > MAX_COMPOSITION_BEATS || Math.abs(beat / STEP_BEATS - Math.round(beat / STEP_BEATS)) > EPSILON) throw new Error(`Steps fall on sixteenth notes within ${MAX_COMPOSITION_BEATS} beats.`);
  const existing = stepNote(track, pitch, beat);
  if (existing) { track.notes = track.notes.filter(note => note !== existing); return false; }
  if (track.notes.length >= MAX_TRACK_NOTES) throw new Error(`A track holds at most ${MAX_TRACK_NOTES} hits. Clear some steps first.`);
  track.notes.push({ id: crypto.randomUUID(), pitch, start: beat, duration: STEP_BEATS, velocity: 0.8 });
  track.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return true;
}

/** Copy one bar's hits over the next bar, replacing what was there. */
export function copyBarForward(track: Track, bar: number): void {
  const start = bar * STEPS_PER_BAR * STEP_BEATS, span = STEPS_PER_BAR * STEP_BEATS;
  if (!Number.isInteger(bar) || bar < 0 || start + 2 * span > MAX_COMPOSITION_BEATS) throw new Error(`There is no room for another bar within ${MAX_COMPOSITION_BEATS} beats.`);
  const source = track.notes.filter(note => note.start >= start - EPSILON && note.start < start + span - EPSILON);
  if (!source.length) throw new Error('This bar has no hits to copy.');
  const kept = track.notes.filter(note => !(note.start >= start + span - EPSILON && note.start < start + 2 * span - EPSILON));
  if (kept.length + source.length > MAX_TRACK_NOTES) throw new Error(`A track holds at most ${MAX_TRACK_NOTES} hits. Clear some steps first.`);
  track.notes = [...kept, ...source.map(note => ({ ...note, id: crypto.randomUUID(), start: note.start + span }))]
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** A one-bar starting groove: kick on 1 and 3, snare on 2 and 4, closed hats on every eighth. */
export function basicBeat(): Note[] {
  const hits: [number, number, number][] = [[36, 0, 0.9], [36, 2, 0.9], [36, 2.5, 0.6], [38, 1, 0.85], [38, 3, 0.85]];
  for (let eighth = 0; eighth < 8; eighth++) hits.push([42, eighth / 2, eighth % 2 ? 0.45 : 0.65]);
  return hits.map(([pitch, start, velocity]) => ({ id: crypto.randomUUID(), pitch, start, duration: STEP_BEATS, velocity }))
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/** The number of four-beat bars the grid should offer: the track's extent plus one empty bar to grow into. */
export function gridBars(track: Track): number {
  const end = Math.max(0, ...track.notes.map(note => note.start + STEP_BEATS));
  return Math.min(Math.floor(MAX_COMPOSITION_BEATS / 4), Math.max(1, Math.ceil(end / 4 - EPSILON)) + 1);
}
