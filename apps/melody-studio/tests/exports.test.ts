import assert from 'node:assert/strict';
import test from 'node:test';
import { createComposition, createNote, createTrack } from '../src/model.ts';
import { encodeMidi } from '../src/midi.ts';
import { encodeWav } from '../src/wav.ts';

interface MidiEvent { tick: number; status: number; data: number[]; meta?: number }
function readMidi(bytes: Uint8Array): { format: number; division: number; tracks: MidiEvent[][] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, size: number) => new TextDecoder().decode(bytes.subarray(offset, offset + size));
  assert.equal(ascii(0, 4), 'MThd');
  assert.equal(view.getUint32(4), 6);
  const count = view.getUint16(10);
  const tracks: MidiEvent[][] = [];
  let offset = 14;
  for (let index = 0; index < count; index++) {
    assert.equal(ascii(offset, 4), 'MTrk');
    const end = offset + 8 + view.getUint32(offset + 4);
    offset += 8;
    let tick = 0;
    const events: MidiEvent[] = [];
    const vlq = () => {
      let value = 0;
      for (let byteCount = 0; byteCount < 4; byteCount++) {
        const byte = bytes[offset++];
        value = value * 128 + (byte & 127);
        if (!(byte & 128)) return value;
      }
      throw new Error('Invalid MIDI variable-length quantity');
    };
    while (offset < end) {
      tick += vlq();
      const status = bytes[offset++];
      assert.ok(status >= 128, 'explicit event status');
      if (status === 255) {
        const meta = bytes[offset++];
        const length = vlq();
        events.push({ tick, status, meta, data: [...bytes.subarray(offset, offset + length)] });
        offset += length;
      } else {
        const size = (status & 240) === 192 ? 1 : 2;
        const data = [...bytes.subarray(offset, offset + size)];
        assert.ok(data.every(value => value < 128));
        events.push({ tick, status, data });
        offset += size;
      }
    }
    assert.equal(offset, end);
    assert.equal(events.at(-1)?.meta, 47);
    tracks.push(events);
  }
  assert.equal(offset, bytes.length);
  return { format: view.getUint16(8), division: view.getUint16(12), tracks };
}

test('MIDI writes standard independent tracks with tempo, programs, volume and musical timing', () => {
  const project = createComposition();
  project.tempo = 120;
  project.tracks[0].notes = [{ ...createNote(60, 0), duration: 1, velocity: 0.5 }, { ...createNote(60, 1), duration: 1, velocity: 1 }];
  const harmony = createTrack('Harmony');
  harmony.instrument = 'sawtooth';
  harmony.volume = 0.25;
  harmony.notes = [{ ...createNote(64, 0.5), duration: 2, velocity: 0.75 }];
  project.tracks.push(harmony);
  const midi = readMidi(encodeMidi(project));
  assert.equal(midi.format, 1);
  assert.equal(midi.tracks.length, 3);
  assert.equal(midi.division, 480);
  assert.deepEqual(midi.tracks[0].find(event => event.meta === 81)?.data, [7, 161, 32]);
  assert.ok(midi.tracks[1].some(event => event.status === 192));
  assert.ok(midi.tracks[2].some(event => event.status === 193));
  assert.notDeepEqual(midi.tracks[1].find(event => event.status === 192)?.data, midi.tracks[2].find(event => event.status === 193)?.data);
  assert.deepEqual(midi.tracks[2].find(event => event.status === 177)?.data, [7, 32]);
  assert.deepEqual(midi.tracks[1].filter(event => event.status === 144).map(event => [event.tick, ...event.data]), [[0, 60, 64], [480, 60, 127]]);
  const adjacent = midi.tracks[1].filter(event => event.tick === 480 && [128, 144].includes(event.status));
  assert.deepEqual(adjacent.map(event => event.status), [128, 144]);
  assert.deepEqual(midi.tracks[2].filter(event => [129, 145].includes(event.status)).map(event => [event.tick, event.status, event.data[0]]), [[240, 145, 64], [1200, 129, 64]]);
  assert.deepEqual(encodeMidi(project), encodeMidi(project));
});

test('MIDI omits muted and zero-velocity notes, handles long gaps and validates input', () => {
  const project = createComposition();
  project.tempo = 40;
  project.tracks[0].notes = [{ ...createNote(36, 112), duration: 16, velocity: 1 }, { ...createNote(96), velocity: 0 }];
  const muted = createTrack();
  muted.muted = true;
  muted.notes = [createNote()];
  project.tracks.push(muted);
  const midi = readMidi(encodeMidi(project));
  assert.deepEqual(midi.tracks[0].find(event => event.meta === 81)?.data, [22, 227, 96]);
  assert.deepEqual(midi.tracks[1].filter(event => event.status === 144).map(event => event.tick), [53_760]);
  assert.equal(midi.tracks[1].find(event => event.status === 128)?.tick, 61_440);
  assert.equal(midi.tracks[2].filter(event => (event.status & 240) === 144).length, 0);
  assert.throws(() => encodeMidi({ ...project, tempo: Infinity }));
});

test('WAV encodes a deterministic mono 16-bit PCM RIFF with clamped samples', () => {
  const bytes = encodeWav(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2]), 22_050);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) => new TextDecoder().decode(bytes.subarray(offset, offset + length));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(12, 4), 'fmt ');
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), 22_050);
  assert.equal(view.getUint32(28, true), 44_100);
  assert.equal(view.getUint16(32, true), 2);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(ascii(36, 4), 'data');
  assert.equal(view.getUint32(40, true), 14);
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => view.getInt16(44 + index * 2, true)), [-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  assert.deepEqual(encodeWav(new Float32Array([0, 1]), 44_100), encodeWav(new Float32Array([0, 1]), 44_100));
  assert.equal(encodeWav(new Float32Array(), 48_000).length, 44);
});

test('WAV rejects invalid sample rates and nonfinite samples', () => {
  assert.equal(encodeWav(new Float32Array([0]), 22_050).length, 46);
  for (const rate of [0, -1, 22_050.5, NaN, Infinity, 384_001]) assert.throws(() => encodeWav(new Float32Array([0]), rate));
  for (const sample of [NaN, Infinity, -Infinity]) assert.throws(() => encodeWav(new Float32Array([sample]), 22_050));
});
