import assert from 'node:assert/strict';
import test from 'node:test';
import {
  comparisonComposition, cropComparison, normalizeReference, referenceSamples, referenceWindow,
} from '../src/reference-audio.ts';
import { renderComposition } from '../src/audio.ts';
import type { MelodyDocument, ReferenceAsset } from '../src/reference-types.ts';

const rate = 22050;
const assetId = '12345678-1234-4123-8123-123456789abc';
function pcm(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  return bytes;
}
function ints(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: bytes.length / 2 }, (_, index) => view.getInt16(index * 2, true));
}
function asset(values = [0, -32768, 32767, -16384, 16384]): ReferenceAsset {
  return { id: assetId, kind: 'demo', captureTempo: 120, decodedSampleRate: rate,
    decodedChannels: 1, decodedFrames: values.length, analyzedFrames: values.length,
    frameCount: values.length, pcm: pcm(values) };
}
function document(): MelodyDocument {
  return {
    schemaVersion: 1,
    composition: { version: 1, title: 'Known reference', tempo: 60, tracks: [
      { id: 'lead', name: 'Lead', instrument: 'sine', volume: 0.7, muted: false,
        notes: [{ id: 'first', pitch: 69, start: 0.5, duration: 1, velocity: 0.6 },
          { id: 'late', pitch: 72, start: 3, duration: 0.25, velocity: 0.5 }] },
      { id: 'other', name: 'Other', instrument: 'sawtooth', volume: 1, muted: false,
        notes: [{ id: 'unrelated', pitch: 90, start: 0, duration: 16, velocity: 1 }] },
    ] },
    references: [{ trackId: 'lead', assetId }],
  };
}
const metadata = (decodedFrames: number) => ({
  kind: 'audio-file' as const, captureTempo: 120, decodedChannels: 2, decodedFrames,
});
const signal = () => new AbortController().signal;

test('equal-rate normalization freezes literal clipping, asymmetric quantization and LE bytes', async () => {
  const source = Float32Array.from([0, -2, -1, -0.5, -1 / 65536, -3 / 65536,
    1 / 65536, 1 / 32768, 0.5, 1, 2]);
  const before = source.slice();
  const result = await normalizeReference(source, rate, metadata(source.length), signal());
  assert.deepEqual(ints(result.pcm), [0, -32768, -32768, -16384, 0, -1, 0, 1, 16384, 32767, 32767]);
  assert.equal(result.pcm[2], 0);
  assert.equal(result.pcm[3], 128);
  assert.deepEqual(source, before);
  assert.equal(result.frameCount, source.length);
  assert.equal(result.analyzedFrames, source.length);
  assert.equal(result.decodedChannels, 2);
  assert.equal(result.captureTempo, 120);
  assert.match(result.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  source.fill(0);
  assert.equal(ints(result.pcm)[1], -32768);
});

test('maximum retained duration cuts declared decoded padding without storing it', async () => {
  const source = new Float32Array(441000);
  source[0] = -1;
  source[source.length - 1] = 1;
  const result = await normalizeReference(source, rate, metadata(443205), signal());
  assert.equal(result.decodedFrames, 443205);
  assert.equal(result.analyzedFrames, 441000);
  assert.equal(result.frameCount, 441000);
  assert.equal(result.pcm.length, 882000);
  assert.equal(ints(result.pcm).at(-1), 32767);
});

test('normalization rejects invalid bounds and metadata before native allocation', async () => {
  const source = new Float32Array(8);
  for (const badRate of [0, 7999, 192001, 22050.5, NaN, Infinity]) {
    await assert.rejects(normalizeReference(source, badRate, metadata(8), signal()));
  }
  for (const badMeta of [
    { ...metadata(8), decodedChannels: 0 }, { ...metadata(8), decodedChannels: 33 },
    { ...metadata(8), decodedChannels: 1.5 }, { ...metadata(8), captureTempo: 39 },
    { ...metadata(8), captureTempo: Infinity }, { ...metadata(8), decodedFrames: 0 },
    { ...metadata(8), decodedFrames: 8.5 }, { ...metadata(8), decodedFrames: 443206 },
    { ...metadata(8), kind: 'other' }, { ...metadata(8), extra: true },
  ]) {
    await assert.rejects(normalizeReference(source, rate, badMeta as ReturnType<typeof metadata>, signal()));
  }
  await assert.rejects(normalizeReference(source, rate, metadata(9), signal()));
  await assert.rejects(normalizeReference(new Float32Array(0), rate, metadata(0), signal()));
  await assert.rejects(normalizeReference(Float32Array.of(NaN), rate, metadata(1), signal()));
  await assert.rejects(normalizeReference(Float32Array.of(Infinity), rate, metadata(1), signal()));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(normalizeReference(source, rate, metadata(8), controller.signal), { name: 'AbortError' });
});

test('normalization rejects accessor metadata without executing supplied code', async () => {
  const meta = metadata(8);
  Object.defineProperty(meta, 'captureTempo', { get() { throw new Error('getter executed'); } });
  await assert.rejects(normalizeReference(new Float32Array(8), rate, meta, signal()),
    error => error instanceof Error && error.message !== 'getter executed');
});

test('reference window rounds to exact frame bounds and rejects empty or invalid intervals', () => {
  assert.deepEqual(referenceWindow(1.49 / rate, 3.51 / rate, 8), { startFrame: 1, endFrame: 4 });
  assert.deepEqual(referenceWindow(0, 441000 / rate, 441000), { startFrame: 0, endFrame: 441000 });
  for (const [start, end, frames] of [
    [NaN, 1, 8], [0, Infinity, 8], [-1, 1, 8], [0, 0, 8], [2, 1, 8],
    [0, 1, 8], [0, 1, 0], [0, 1, 441001], [0, 1, 8.5],
    [0, 0.49 / rate, 8],
  ]) assert.throws(() => referenceWindow(start, end, frames));
});

test('reference samples decode asymmetric PCM and detach arbitrary-window output', () => {
  const original = asset();
  const result = referenceSamples(original, { startFrame: 1, endFrame: 5 });
  assert.deepEqual(result, Float32Array.of(-1, 1, -0.5, 16384 / 32767));
  result[0] = 0;
  assert.equal(ints(original.pcm)[1], -32768);
  for (const window of [
    { startFrame: -1, endFrame: 2 }, { startFrame: 2, endFrame: 2 },
    { startFrame: 0, endFrame: 6 }, { startFrame: 0.5, endFrame: 2 },
    { startFrame: 0, endFrame: Infinity }, { startFrame: 0, endFrame: 1, extra: true },
  ]) assert.throws(() => referenceSamples(original, window));
  assert.throws(() => referenceSamples({ ...original, pcm: new Uint8Array(2) }, { startFrame: 0, endFrame: 1 }));
});

test('comparison composition is captured-tempo, selected-track-only and detached', () => {
  const original = document();
  const result = comparisonComposition(original, 'lead', asset());
  assert.equal(result.tempo, 120);
  assert.equal(original.composition.tempo, 60);
  assert.equal(result.tracks.length, 1);
  assert.deepEqual(result.tracks[0], original.composition.tracks[0]);
  result.tracks[0].notes[0].pitch = 80;
  assert.equal(original.composition.tracks[0].notes[0].pitch, 69);
  assert.throws(() => comparisonComposition(original, 'other', asset()));
  assert.throws(() => comparisonComposition(original, 'missing', asset()));
  assert.throws(() => comparisonComposition(original, 'lead', { ...asset(), id: 'abcdefab-1234-4123-8123-123456789abc' }));
});

test('comparison keeps applied mute, volume, velocity and full note timing', () => {
  const original = document();
  original.composition.tracks[0].muted = true;
  const solo = comparisonComposition(original, 'lead', asset());
  const rendered = renderComposition(solo);
  assert.ok(rendered.length > 0);
  assert.ok(rendered.every(value => value === 0));
  assert.equal(solo.tracks[0].volume, 0.7);
  assert.equal(solo.tracks[0].notes[0].velocity, 0.6);
  assert.equal(solo.tracks[0].notes[1].start, 3);
});

test('comparison crop copies frame interval, preserves silence and pads only missing output', () => {
  const source = Float32Array.of(0, 0.1, 0.2, 0.3);
  const cropped = cropComparison(source, { startFrame: 2, endFrame: 7 });
  assert.deepEqual(cropped, Float32Array.of(0.2, 0.3, 0, 0, 0));
  cropped[0] = 1;
  assert.equal(source[2], Math.fround(0.2));
  assert.deepEqual(cropComparison(new Float32Array(0), { startFrame: 1, endFrame: 3 }), new Float32Array(2));
  assert.deepEqual(cropComparison(source, { startFrame: 5, endFrame: 8 }), new Float32Array(3));
  assert.throws(() => cropComparison(Float32Array.of(NaN), { startFrame: 0, endFrame: 1 }));
  assert.throws(() => cropComparison(new Float32Array(16978501), { startFrame: 0, endFrame: 1 }));
});

test('full solo render crop retains phase before window and crops release without restarting envelopes', () => {
  const solo = comparisonComposition(document(), 'lead', asset());
  const full = renderComposition(solo);
  const window = { startFrame: Math.round(0.4 * rate), endFrame: Math.round(0.79 * rate) };
  const result = cropComparison(full, window);
  assert.deepEqual(result, full.slice(window.startFrame, window.endFrame));
  assert.notEqual(result[0], 0);
  assert.ok(result.subarray(Math.round((0.75 - 0.4) * rate)).some(value => value !== 0));
  assert.equal(result.length, window.endFrame - window.startFrame);
});

test('a loud late note outside comparison still affects full-solo gain limiting', () => {
  const original = document();
  const track = original.composition.tracks[0];
  track.volume = 1;
  track.notes = [{ id: 'quiet', pitch: 69, start: 0, duration: 1, velocity: 0.1 },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `loud-${i}`, pitch: 69, start: 4, duration: 1, velocity: 1 }))];
  const normalized = cropComparison(renderComposition(comparisonComposition(original, 'lead', asset())),
    { startFrame: 0, endFrame: 4000 });
  track.notes = track.notes.slice(0, 1);
  const quietAlone = renderComposition(comparisonComposition(original, 'lead', asset()));
  let ratio = 0;
  for (let i = 1000; i < 4000; i++) if (Math.abs(quietAlone[i]) > 0.01) {
    ratio = normalized[i] / quietAlone[i];
    break;
  }
  assert.ok(ratio > 0 && ratio < 0.4);
});

interface DeferredNative {
  input: Float32Array | null;
  inputRate: number;
  channels: number;
  outputFrames: number;
  outputRate: number;
  stopped: number;
  disconnected: number;
  resolve(values: Float32Array): void;
  reject(error: Error): void;
}
/** Native resampling is independently browser-tested; this seam exercises only ownership/drain. */
async function withDeferredNative(run: (native: DeferredNative) => Promise<void>): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
  let resolve!: (value: AudioBuffer) => void;
  let reject!: (reason: Error) => void;
  const pending = new Promise<AudioBuffer>((yes, no) => { resolve = yes; reject = no; });
  void pending.catch(() => {});
  const state: DeferredNative = {
    input: null, inputRate: 0, channels: 0, outputFrames: 0, outputRate: 0,
    stopped: 0, disconnected: 0,
    resolve: values => resolve({ length: values.length, numberOfChannels: 1, sampleRate: rate,
      getChannelData: () => values } as unknown as AudioBuffer),
    reject,
  };
  class FakeOffline {
    destination = {};
    constructor(channels: number, frames: number, sampleRate: number) {
      state.channels = channels;
      state.outputFrames = frames;
      state.outputRate = sampleRate;
    }
    createBuffer(channels: number, frames: number, sampleRate: number) {
      assert.equal(channels, 1);
      state.inputRate = sampleRate;
      state.input = new Float32Array(frames);
      return { copyToChannel: (data: Float32Array) => state.input!.set(data) };
    }
    createBufferSource() {
      return { buffer: null, connect: () => {}, start: () => {},
        stop: () => { state.stopped++; }, disconnect: () => { state.disconnected++; } };
    }
    startRendering() { return pending; }
  }
  Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: FakeOffline });
  try { await run(state); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'OfflineAudioContext', descriptor);
    else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
  }
}

test('resampling owns detached input and metadata until native output completes', async () => {
  await withDeferredNative(async native => {
    const source = Float32Array.from([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    const before = source.slice(), meta = metadata(8);
    const pending = normalizeReference(source, 44100, meta, signal());
    void pending.catch(() => {});
    source.fill(NaN);
    meta.captureTempo = 60;
    assert.deepEqual(native.input, before);
    assert.equal(native.inputRate, 44100);
    assert.equal(native.channels, 1);
    assert.equal(native.outputFrames, 4);
    assert.equal(native.outputRate, 22050);
    native.resolve(Float32Array.of(0, 0.25, -0.25, 1));
    const result = await pending;
    assert.deepEqual(ints(result.pcm), [0, 8192, -8192, 32767]);
    assert.equal(result.frameCount, 4);
    assert.equal(result.captureTempo, 120);
    assert.equal(native.disconnected, 1);
  });
});

test('aborted native work keeps admission occupied and settles rejection only after drain', async () => {
  await withDeferredNative(async native => {
    const controller = new AbortController();
    const pending = normalizeReference(new Float32Array(8), 44100, metadata(8), controller.signal);
    const outcome = assert.rejects(pending, { name: 'AbortError' });
    void outcome.catch(() => {});
    let settled = false;
    void pending.then(() => { settled = true; }, () => { settled = true; });
    controller.abort();
    await Promise.resolve();
    assert.equal(settled, false);
    await assert.rejects(normalizeReference(new Float32Array(4), rate, metadata(4), signal()), /progress|drain|retry/i);
    native.resolve(new Float32Array(4));
    await outcome;
    const next = await normalizeReference(new Float32Array(4), rate, metadata(4), signal());
    assert.equal(next.frameCount, 4);
  });
});

test('normalization deadline revokes output but leaves native admission blocked until drain', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await withDeferredNative(async native => {
      const pending = normalizeReference(new Float32Array(8), 44100, metadata(8), signal());
      const outcome = assert.rejects(pending, /timed out|too long/i);
      void outcome.catch(() => {});
      let settled = false;
      void pending.then(() => { settled = true; }, () => { settled = true; });
      t.mock.timers.tick(30000);
      await Promise.resolve();
      assert.equal(settled, false);
      await assert.rejects(normalizeReference(new Float32Array(4), rate, metadata(4), signal()), /progress|drain|retry/i);
      native.resolve(new Float32Array(4));
      await outcome;
    });
  } finally { t.mock.timers.reset(); }
});

test('native rejection and invalid outputs release admission without quoting native details', async () => {
  await withDeferredNative(async native => {
    const pending = normalizeReference(new Float32Array(8), 44100, metadata(8), signal());
    const outcome = assert.rejects(pending, error => error instanceof Error && !error.message.includes('private decoder detail'));
    native.reject(new Error('private decoder detail'));
    await outcome;
    assert.equal((await normalizeReference(new Float32Array(4), rate, metadata(4), signal())).frameCount, 4);
  });
  for (const output of [Float32Array.of(0), Float32Array.of(0, NaN, 0, 0)]) {
    await withDeferredNative(async native => {
      const pending = normalizeReference(new Float32Array(8), 44100, metadata(8), signal());
      const outcome = assert.rejects(pending);
      native.resolve(output);
      await outcome;
    });
  }
});

test('synchronous native setup failures release admission and return bounded guidance', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
  class FailingOffline {
    constructor() { throw new Error('private native setup detail'); }
  }
  Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: FailingOffline });
  try {
    await assert.rejects(normalizeReference(new Float32Array(8), 44100, metadata(8), signal()),
      error => error instanceof Error && !error.message.includes('private native setup detail') && /browser|audio/i.test(error.message));
    const next = await normalizeReference(Float32Array.of(0, 1), rate, metadata(2), signal());
    assert.deepEqual(ints(next.pcm), [0, 32767]);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'OfflineAudioContext', descriptor);
    else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
  }
});
