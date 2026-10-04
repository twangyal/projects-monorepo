import assert from 'node:assert/strict';
import test from 'node:test';
import { NormalizedWavPeaks, Pcm16PeakReducer } from '../src/waveform.ts';

// Independent literal PCM/RIFF producer: it imports no implementation fixtures.
function pcm(frames: number, samples: [number, number] = [0, 0]): Uint8Array {
  const bytes = new Uint8Array(frames * 4), view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frames; frame++) {
    view.setInt16(frame * 4, samples[0], true); view.setInt16(frame * 4 + 2, samples[1], true);
  }
  return bytes;
}
function sample(bytes: Uint8Array, frame: number, left: number, right: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setInt16(frame * 4, left, true); view.setInt16(frame * 4 + 2, right, true);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function chunk(name: string, contents: Uint8Array): Uint8Array {
  const header = new Uint8Array(8); header.set(new TextEncoder().encode(name));
  new DataView(header.buffer).setUint32(4, contents.length, true);
  return concat(header, contents, new Uint8Array(contents.length % 2));
}
function format(extended = false): Uint8Array {
  const bytes = new Uint8Array(extended ? 18 : 16), view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 2, true); view.setUint32(4, 44100, true);
  view.setUint32(8, 176400, true); view.setUint16(12, 4, true); view.setUint16(14, 16, true);
  return bytes;
}
function riff(...chunks: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(12); header.set(new TextEncoder().encode('RIFF'));
  new DataView(header.buffer).setUint32(4, 4 + chunks.reduce((sum, part) => sum + part.length, 0), true);
  header.set(new TextEncoder().encode('WAVE'), 8);
  return concat(header, ...chunks);
}
function feed(target: { push(chunk: Uint8Array): void }, bytes: Uint8Array, sizes: number[]): void {
  let offset = 0, index = 0;
  while (offset < bytes.length) {
    const length = sizes[index++ % sizes.length];
    target.push(bytes.subarray(offset, offset + length)); offset += length;
  }
}
function normalized(bytes: Uint8Array, duration: number, sizes = [65536]) {
  const reducer = new NormalizedWavPeaks(duration); feed(reducer, bytes, sizes); return reducer.finish();
}

test('independent PCM oracle never invents zero for strictly positive or negative samples', () => {
  for (const [pair, expected] of [
    [[100, 200], [100, 200]], [[-300, -200], [-300, -200]], [[0, 0], [0, 0]],
  ] as const) {
    const reducer = new Pcm16PeakReducer(3);
    feed(reducer, pcm(3, [...pair]), [1]);
    const result = reducer.finish();
    assert.deepEqual([...result.minima], [expected[0]]);
    assert.deepEqual([...result.maxima], [expected[1]]);
    assert.equal(result.frameCount, 3);
    assert.equal(reducer.framesRead, 3);
  }
});

test('independent stereo impulses straddle bins and survive anti-phase and partial-byte splits', () => {
  const bytes = pcm(883);
  sample(bytes, 440, 0, 32767);
  sample(bytes, 441, -32768, 32767);
  sample(bytes, 882, 1234, 2345);
  for (const splits of [[1], [3], [5], [1763], [2, 7, 441, 17, 1]]) {
    const reducer = new Pcm16PeakReducer(883); feed(reducer, bytes, splits);
    const result = reducer.finish();
    assert.deepEqual([...result.minima], [0, -32768, 1234]);
    assert.deepEqual([...result.maxima], [32767, 32767, 2345]);
    assert.equal(result.binFrames, 441);
    assert.equal(result.sampleRate, 44100);
  }
});

test('independent44101-frame WAV has101bins with exactly one real final frame', () => {
  const bytes = pcm(44101, [100, 200]); sample(bytes, 44100, -2222, 3333);
  const wav = riff(chunk('fmt ', format()), chunk('data', bytes));
  for (const splits of [[1], [3, 5, 1763], [65536]]) {
    const result = normalized(wav, 44101 / 44100, splits);
    assert.equal(result.frameCount, 44101);
    assert.equal(result.minima.length, 101);
    assert.deepEqual([...result.minima.slice(0, 100)], Array(100).fill(100));
    assert.deepEqual([...result.maxima.slice(0, 100)], Array(100).fill(200));
    assert.equal(result.minima[100], -2222); assert.equal(result.maxima[100], 3333);
    assert.notEqual(result.frameCount / result.sampleRate, result.minima.length * .01);
  }
});

test('independent containers preserve samples through odd metadata padding and canonical extended fmt', () => {
  const data = pcm(44100, [-16, 32]);
  const wav = riff(chunk('JUNK', new Uint8Array([9, 8, 7])), chunk('fmt ', format(true)),
    chunk('LIST', new Uint8Array([6])), chunk('data', data), chunk('JUNK', new Uint8Array([5, 4, 3])));
  const result = normalized(wav, 1, [1, 3, 5, 1763]);
  assert.equal(result.frameCount, 44100);
  assert.deepEqual([...result.minima], Array(100).fill(-16));
  assert.deepEqual([...result.maxima], Array(100).fill(32));
});

test('independent RIFF failures never become partial peak results', () => {
  const data = pcm(44100), good = riff(chunk('fmt ', format()), chunk('data', data));
  const wrongRate = format(); new DataView(wrongRate.buffer).setUint32(4, 48000, true);
  const wrongAlign = format(); new DataView(wrongAlign.buffer).setUint16(12, 2, true);
  const nonzeroExtension = format(true); new DataView(nonzeroExtension.buffer).setUint16(16, 2, true);
  const tooLongHeader = good.slice(); new DataView(tooLongHeader.buffer).setUint32(4, 0xffffffff, true);
  const invalid = [good.subarray(0, good.length - 1), concat(good, new Uint8Array([0])), tooLongHeader,
    riff(chunk('data', data), chunk('fmt ', format())),
    riff(chunk('fmt ', format()), chunk('fmt ', format()), chunk('data', data)),
    riff(chunk('fmt ', format()), chunk('data', data), chunk('data', new Uint8Array())),
    riff(chunk('fmt ', wrongRate), chunk('data', data)), riff(chunk('fmt ', wrongAlign), chunk('data', data)),
    riff(chunk('fmt ', nonzeroExtension), chunk('data', data)),
    riff(chunk('fmt ', format()), chunk('data', data.subarray(1))),
    riff(chunk('fmt ', format()), chunk('data', pcm(44099))),
  ];
  assert.equal(normalized(good, 1).frameCount, 44100);
  for (const bytes of invalid) assert.throws(() => normalized(bytes, 1, [3, 1763]));
});

test('independent WAV overhead cap accepts4096bytes and rejects excess without decoding it as audio', () => {
  const data = pcm(44100);
  const atLimit = riff(chunk('fmt ', format()), chunk('JUNK', new Uint8Array(4044)), chunk('data', data));
  assert.equal(atLimit.length - data.length, 4096);
  assert.equal(normalized(atLimit, 1).frameCount, 44100);
  const over = riff(chunk('fmt ', format()), chunk('JUNK', new Uint8Array(4045)), chunk('data', data));
  assert.throws(() => normalized(over, 1));
});

test('independent expected-duration guard allows one frame only, not one10msbin', () => {
  const wav = riff(chunk('fmt ', format()), chunk('data', pcm(44101)));
  assert.equal(normalized(wav, 1).frameCount, 44101);
  assert.throws(() => normalized(wav, 1 + 3 / 44100));
  assert.throws(() => normalized(wav, 1.01));
});

test('independent300second producer stays at30000minmaxpairs with exact terminal impulse', () => {
  const frames = 13_230_000;
  const reducer = new Pcm16PeakReducer(frames);
  const parser = new NormalizedWavPeaks(300);
  const header = riff(chunk('fmt ', format()), chunk('data', new Uint8Array()));
  new DataView(header.buffer).setUint32(4, 36 + frames * 4, true);
  new DataView(header.buffer).setUint32(40, frames * 4, true);
  parser.push(header);
  const block = pcm(16384);
  let remaining = frames;
  while (remaining > 16384) { reducer.push(block); parser.push(block); remaining -= 16384; }
  const tail = pcm(remaining); sample(tail, remaining - 1, -32768, 32767); reducer.push(tail); parser.push(tail);
  const result = reducer.finish();
  assert.equal(result.frameCount / result.sampleRate, 300);
  assert.equal(result.minima.length, 30000);
  assert.equal(result.minima.byteLength + result.maxima.byteLength, 120000);
  assert.equal(result.minima[29999], -32768); assert.equal(result.maxima[29999], 32767);
  assert.equal(result.minima[29998], 0); assert.equal(result.maxima[29998], 0);
  assert.deepEqual(parser.finish(), result);
  assert.throws(() => new Pcm16PeakReducer(frames + 1));
  const oversized = header.slice();
  new DataView(oversized.buffer).setUint32(4, 36 + (frames + 1) * 4, true);
  new DataView(oversized.buffer).setUint32(40, (frames + 1) * 4, true);
  assert.throws(() => new NormalizedWavPeaks(300).push(oversized));
});
