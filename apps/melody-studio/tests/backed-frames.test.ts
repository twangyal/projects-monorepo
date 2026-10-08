import assert from 'node:assert/strict';
import test from 'node:test';
import { BackedFrames } from '../src/backed-frames.ts';

const mono = (...values: number[]) => [Float32Array.from(values)];

test('variable blocks retain exactly the start/end intersection without count-in or trailing frames', () => {
  const capture = new BackedFrames(8000);
  assert.equal(capture.channels, null);
  assert.equal(capture.push(0, mono(90, 91, 92, 93)), null);
  capture.arm(6, 11);
  assert.equal(capture.push(4, mono(94, 95, 6, 7, 8)), null);
  assert.equal(capture.framesCaptured, 3);
  const final = capture.push(9, mono(9, 10, 99, 100));
  assert.ok(final);
  assert.deepEqual([...final.samples], [6, 7, 8, 9, 10]);
  assert.deepEqual({ ...final, samples: undefined }, { sampleRate: 8000, channels: 1, startFrame: 6, endFrame: 11, samples: undefined });
  assert.equal(capture.terminal, true);
  assert.equal(capture.push(1000, []), null);
  assert.equal(capture.finish(7), null);
});

test('stereo channels average dry samples and input arrays never alias the retained result', () => {
  const capture = new BackedFrames(44100); capture.arm(0, 4);
  const left = Float32Array.from([1, -1, .75, .25]), right = Float32Array.from([-1, 1, .25, .75]);
  const final = capture.push(0, [left, right]); assert.ok(final);
  left.fill(9); right.fill(9);
  assert.equal(final.channels, 2);
  assert.deepEqual([...final.samples], [0, 0, .5, .5]);
});

test('delayed Finish trims samples already captured to the trusted absolute cutoff', () => {
  const capture = new BackedFrames(48000); capture.arm(10, 30);
  assert.equal(capture.push(8, mono(-2, -1, 0, 1, 2, 3, 4, 5, 6, 7)), null);
  const final = capture.finish(15); assert.ok(final);
  assert.deepEqual([...final.samples], [0, 1, 2, 3, 4]);
  assert.equal(final.endFrame, 15);
  assert.equal(capture.framesCaptured, 5);
});

test('Finish ahead of received input waits for contiguous real data, never pads or moves a pinned cutoff', () => {
  const capture = new BackedFrames(8000); capture.arm(0, 12);
  capture.push(0, mono(1, 2));
  assert.equal(capture.finish(5), null);
  assert.equal(capture.terminal, false);
  assert.equal(capture.finish(3), null);
  const final = capture.push(2, mono(3, 4, 5, 6)); assert.ok(final);
  assert.deepEqual([...final.samples], [1, 2, 3, 4, 5]);
  assert.equal(final.endFrame, 5);
});

test('Finish before arm/start cancels, cancellation is terminal and cannot resurrect', () => {
  for (const armed of [false, true]) {
    const capture = new BackedFrames(8000);
    if (armed) capture.arm(10, 20);
    assert.equal(capture.finish(10), null);
    assert.equal(capture.terminal, true);
    assert.throws(() => capture.arm(20, 30));
    assert.equal(capture.push(0, mono(1)), null);
    capture.cancel(); capture.cancel();
  }
});

test('invalid topology/finite values/continuity refuse atomically and cannot inject a gap', () => {
  const capture = new BackedFrames(8000); capture.arm(0, 10); capture.push(0, mono(1, 2));
  const invalid: [number, readonly Float32Array[]][] = [
    [2, []], [2, [new Float32Array(0)]], [2, [new Float32Array([1]), new Float32Array([2])]],
    [2, mono(1, NaN)], [2, mono(Infinity)], [3, mono(3)], [1, mono(3)],
    [2.5, mono(3)], [Number.MAX_SAFE_INTEGER, mono(3)],
  ];
  for (const [frame, channels] of invalid) {
    assert.throws(() => capture.push(frame, channels));
    assert.equal(capture.framesCaptured, 2); assert.equal(capture.terminal, false);
  }
  const final = capture.finish(4); assert.equal(final, null);
  assert.deepEqual([...capture.push(2, mono(3, 4))!.samples], [1, 2, 3, 4]);
  const stereo = new BackedFrames(8000); stereo.arm(0, 4);
  assert.throws(() => stereo.push(0, [new Float32Array([1, 2]), new Float32Array([3])]));
  assert.equal(stereo.channels, null);
});

test('readiness topology is pinned before arm, missing input and out-of-order arm are refused', () => {
  const capture = new BackedFrames(8000);
  capture.push(100, mono(1, 2));
  assert.equal(capture.channels, 1);
  assert.throws(() => capture.arm(101, 110));
  capture.arm(104, 110);
  assert.throws(() => capture.arm(104, 110));
  assert.throws(() => capture.push(102, []));
  capture.push(102, mono(2, 3));
  assert.equal(capture.finish(104), null); assert.equal(capture.terminal, true);
});

test('observed stereo readiness gaps before arm retain no samples and preserve the exact armed interval', () => {
  for (const [first, second] of [[3584, 4224], [3200, 3712]]) {
    const capture = new BackedFrames(44100);
    const stereo = () => [new Float32Array(128).fill(.25), new Float32Array(128).fill(.75)];
    assert.equal(capture.push(first, stereo()), null);
    assert.equal(capture.push(second, stereo()), null);
    assert.equal(capture.channels, 2);
    assert.equal(capture.framesCaptured, 0);
    const start = second + 128 + 48;
    capture.arm(start, start + 4);
    const result = capture.push(second + 128, stereo());
    assert.ok(result);
    assert.equal(result.startFrame, start);
    assert.equal(result.endFrame, start + 4);
    assert.equal(result.channels, 2);
    assert.deepEqual([...result.samples], [.5, .5, .5, .5]);
  }
});

test('pre-arm forward gaps still reject backward, duplicate, overlap, topology and nonfinite blocks atomically', () => {
  const capture = new BackedFrames(8000);
  capture.push(100, mono(1, 2, 3, 4));
  for (const frame of [99, 100, 102, 103]) assert.throws(() => capture.push(frame, mono(5, 6)));
  assert.throws(() => capture.push(110, [Float32Array.of(1), Float32Array.of(2)]));
  assert.throws(() => capture.push(110, mono(NaN)));
  assert.equal(capture.channels, 1);
  assert.equal(capture.framesCaptured, 0);
  assert.equal(capture.terminal, false);
  capture.push(110, mono(5, 6, 7, 8));
  capture.arm(114, 116);
  assert.deepEqual([...capture.push(114, mono(9, 10))!.samples], [9, 10]);
});

test('arming makes count-in blocks strictly contiguous even before the capture start', () => {
  const capture = new BackedFrames(8000);
  capture.push(0, mono(0, 1, 2, 3));
  capture.arm(10, 12);
  assert.throws(() => capture.push(8, mono(8, 9, 10, 11)));
  assert.equal(capture.framesCaptured, 0);
  capture.push(4, mono(4, 5, 6, 7));
  assert.deepEqual([...capture.push(8, mono(8, 9, 10, 11))!.samples], [10, 11]);
});

test('sample-rate, interval and cutoff arithmetic are safe and bounded without silently shortening', () => {
  for (const rate of [7999, 192001, 8000.5, NaN, Infinity]) assert.throws(() => new BackedFrames(rate));
  const capture = new BackedFrames(8000);
  for (const [start, end] of [[-1, 10], [10, 10], [10, 9], [0, 160001], [0, Infinity], [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]]) assert.throws(() => capture.arm(start, end));
  capture.arm(0, 4);
  for (const stop of [-1, NaN, Infinity, .5]) assert.throws(() => capture.finish(stop));
  assert.equal(capture.terminal, false);
  const result = capture.push(0, mono(0, 0, 0, 0)); assert.ok(result);
  assert.deepEqual([...result.samples], [0, 0, 0, 0]);
});

test('exact maximum-rate twenty-second buffer succeeds and ignores any after-cap tail', () => {
  const capture = new BackedFrames(192000); capture.arm(7, 3840007);
  const samples = new Float32Array(3840000); samples[0] = .25; samples[samples.length - 1] = -.5;
  const result = capture.push(7, [samples]); assert.ok(result);
  assert.equal(result.samples.length, 3840000);
  assert.equal(result.samples.byteLength, 15360000);
  assert.equal(result.samples[0], .25); assert.equal(result.samples.at(-1), -.5);
  assert.equal(result.endFrame, 3840007);
});

test('thirty-two input channels are finite averaged input, while extra and sparse topology refuses', () => {
  const capture = new BackedFrames(8000); capture.arm(0, 1);
  assert.throws(() => capture.push(0, Array.from({ length: 33 }, () => Float32Array.of(1))));
  assert.throws(() => capture.push(0, new Array<Float32Array>(2)));
  const final = capture.push(0, Array.from({ length: 32 }, (_, i) => Float32Array.of(i - 16))); assert.ok(final);
  assert.equal(final.channels, 32); assert.equal(final.samples[0], -.5);
});
