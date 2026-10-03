import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoMelody, detectPitch, renderComposition, transcribe } from '../src/audio.ts';
import type { Composition, Note } from '../src/types.ts';

const rate = 22050;
const frequency = (pitch: number) => 440 * 2 ** ((pitch - 69) / 12);
function tone(hz: number, seconds = 0.3, sampleRate = rate, harmonic = false): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, i) => {
    const phase = 2 * Math.PI * hz * i / sampleRate;
    return harmonic ? 0.2 * Math.sin(phase) + 0.7 * Math.sin(phase * 2) + 0.15 * Math.sin(phase * 3) : 0.6 * Math.sin(phase);
  });
}
function noise(seconds: number, amplitude = 0.5): Float32Array {
  let seed = 419;
  return Float32Array.from({ length: Math.round(seconds * rate) }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed / 2 ** 32) * 2 - 1) * amplitude;
  });
}
function join(...parts: Float32Array[]): Float32Array {
  const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) { result.set(part, cursor); cursor += part.length; }
  return result;
}
function project(notes: Note[], tempo = 120): Composition {
  return { version: 1, title: 'Test', tempo, tracks: [{ id: 'track', name: 'Lead', instrument: 'sine', volume: 0.8, muted: false, notes }] };
}
const note: Note = { id: 'note', pitch: 69, start: 0, duration: 1, velocity: 0.75 };
const peak = (samples: Float32Array) => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

test('detects the complete pitch range with correct octaves at common input sample rates', () => {
  for (const sampleRate of [22050, 44100, 48000]) {
    for (const pitch of [36, 48, 60, 69, 84, 96]) {
      const hz = frequency(pitch);
      const found = detectPitch(tone(hz, 0.15, sampleRate), sampleRate);
      assert.ok(found !== null, `missing MIDI ${pitch} at ${sampleRate}`);
      assert.ok(Math.abs(1200 * Math.log2(found / hz)) < 35, `MIDI ${pitch}: ${found} Hz`);
    }
  }
});

test('detects the fundamental when the second harmonic is louder', () => {
  for (const pitch of [36, 45, 60, 69]) {
    const found = detectPitch(tone(frequency(pitch), 0.2, rate, true), rate);
    assert.ok(found !== null);
    assert.ok(Math.abs(1200 * Math.log2(found / frequency(pitch))) < 35);
  }
});

test('rejects silence, DC offset, very quiet signals, noise, and out-of-range pitch', () => {
  for (const samples of [new Float32Array(4096), new Float32Array(4096).fill(0.2), tone(440).map(x => x * 0.001), noise(0.2), tone(40), tone(3500)]) {
    assert.equal(detectPitch(samples, rate), null);
  }
  assert.deepEqual(transcribe(noise(2), rate, 120), []);
  assert.deepEqual(transcribe(new Float32Array(rate), rate, 120), []);
});

test('transcribes melody changes and rests onto the quarter-beat grid', () => {
  const samples = join(tone(frequency(60), 0.5), new Float32Array(rate / 4), tone(frequency(64), 0.5), tone(frequency(67), 0.5));
  const notes = transcribe(samples, rate, 120);
  assert.deepEqual(notes.map(n => n.pitch), [60, 64, 67]);
  assert.deepEqual(notes.map(n => n.start), [0, 1.5, 2.5]);
  assert.deepEqual(notes.map(n => n.duration), [1, 1, 1]);
  assert.equal(new Set(notes.map(n => n.id)).size, notes.length);
  for (const n of notes) assert.ok(n.velocity > 0 && n.velocity <= 1);
});

test('tempo changes transcription beat lengths and long captures stay within note bounds', () => {
  assert.equal(transcribe(tone(440, 1), rate, 60)[0]?.duration, 1);
  assert.equal(transcribe(tone(440, 1), rate, 120)[0]?.duration, 2);
  const notes = transcribe(tone(440, 21), rate, 240);
  assert.ok(notes.length > 0 && notes.length <= 256);
  assert.ok(notes.at(-1)!.start + notes.at(-1)!.duration <= 80.25);
  for (const n of notes) {
    assert.ok(n.start >= 0 && n.start * 4 % 1 === 0);
    assert.ok(n.duration >= 0.25 && n.duration <= 16 && n.duration * 4 % 1 === 0);
    assert.ok(n.start + n.duration <= 128);
  }
});

test('rendering preserves tempo timing and adds an envelope tail', () => {
  const fast = renderComposition(project([note]), rate);
  const slow = renderComposition(project([note], 60), rate);
  assert.ok(fast.length > rate * 0.5 && fast.length < rate * 0.75);
  assert.equal(slow.length - fast.length, rate / 2);
  assert.equal(fast[0], 0);
  assert.ok(Math.abs(fast.at(-1)!) < 0.001);
  const found = detectPitch(fast.subarray(500, 4000), rate);
  assert.ok(found !== null && Math.abs(found - 440) < 2);
});

test('mixing instruments stays finite and bounded while respecting volume, velocity, and mute', () => {
  const base = project([note]);
  for (const instrument of ['sine', 'triangle', 'sawtooth'] as const) {
    base.tracks[0].instrument = instrument;
    assert.ok(peak(renderComposition(base)) > 0.1);
  }
  base.tracks[0].instrument = 'sine';
  const normalPeak = peak(renderComposition(base));
  base.tracks[0].volume /= 2;
  assert.ok(Math.abs(peak(renderComposition(base)) / normalPeak - 0.5) < 0.001);
  base.tracks[0].notes[0] = { ...note, velocity: 0 };
  assert.equal(peak(renderComposition(base)), 0);
  base.tracks[0].notes[0] = note;
  base.tracks[0].muted = true;
  assert.equal(peak(renderComposition(base)), 0);
  base.tracks = Array.from({ length: 8 }, (_, i) => ({ ...base.tracks[0], id: `track-${i}`, muted: false, volume: 1, notes: Array.from({ length: 32 }, (_, j) => ({ ...note, id: `n-${i}-${j}`, velocity: 1 })) }));
  const mixed = renderComposition(base);
  assert.ok(peak(mixed) <= 1 && peak(mixed) > 0.1);
  assert.ok(mixed.every(Number.isFinite));
});

test('the generated demo is deterministic, contains rests, and transcribes into a useful melody', () => {
  const demo = createDemoMelody();
  assert.deepEqual(demo, createDemoMelody());
  assert.ok(demo.length > rate && demo.length < rate * 20);
  assert.ok(peak(demo) <= 1);
  assert.ok(transcribe(demo, rate, 120).length >= 4);
});

test('invalid rate and tempo arguments fail explicitly', () => {
  for (const badRate of [0, -1, NaN, Infinity]) {
    assert.throws(() => detectPitch(tone(440), badRate), RangeError);
    assert.throws(() => transcribe(tone(440), badRate, 120), RangeError);
    assert.throws(() => renderComposition(project([note]), badRate), RangeError);
    assert.throws(() => createDemoMelody(badRate), RangeError);
  }
  assert.throws(() => transcribe(tone(440), rate, 0), RangeError);
});

test('separate captures have distinct note IDs suitable for layering tracks', () => {
  const first = transcribe(tone(440), rate, 120);
  const second = transcribe(tone(440), rate, 120);
  assert.equal(new Set([...first, ...second].map(n => n.id)).size, first.length + second.length);
});

test('out-of-range high tones are rejected at microphone sample rates', () => {
  for (const sampleRate of [44100, 48000]) {
    assert.equal(detectPitch(tone(3500, 0.2, sampleRate), sampleRate), null);
  }
});

test('short low notes at the capture boundaries are retained', () => {
  const samples = join(tone(frequency(36), 0.125), new Float32Array(rate / 4), tone(frequency(48), 0.125));
  const notes = transcribe(samples, rate, 120);
  assert.deepEqual(notes.map(n => n.pitch), [36, 48]);
  assert.deepEqual(notes.map(n => n.duration), [0.25, 0.25]);
});
