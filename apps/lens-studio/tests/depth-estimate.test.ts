import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultThresholds, modelInput, modelSize, photoDepth, planeShares, proposePlanes, quantile, thresholdsAround, validThresholds } from '../src/depth-estimate.ts';
import { encodeMask, fillMask } from '../src/model.ts';
import { createProject } from '../src/model.ts';
import { History } from '../src/history.ts';
import { photo } from './model-fixture.ts';

test('model input keeps aspect with the shorter side at 518 and both sides on the 14-pixel patch grid', () => {
  assert.deepEqual(modelSize(1280, 960), { width: 686, height: 518 }); // Matches the research harness's [1,3,518,686].
  assert.deepEqual(modelSize(960, 1280), { width: 518, height: 686 });
  assert.deepEqual(modelSize(518, 518), { width: 518, height: 518 });
  assert.deepEqual(modelSize(300, 100), { width: 1554, height: 518 });
  for (const [w, h] of [[1280, 853], [1, 1280], [1279, 1]] as const) {
    const size = modelSize(w, h);
    assert.equal(size.width % 14, 0); assert.equal(size.height % 14, 0); assert.ok(Math.min(size.width, size.height) >= 518);
  }
  assert.throws(() => modelSize(0, 10)); assert.throws(() => modelSize(1.5, 10));
});

test('pixels are antialiased, composited over black and normalized per ImageNet channel', () => {
  const width = 1036, height = 518, rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([255, 128, 0, 255], i * 4);
  rgba.set([255, 255, 255, 0], 0); // A fully transparent pixel counts as black.
  const input = modelInput({ width, height, rgba });
  assert.deepEqual([input.width, input.height], [1036, 518]);
  const plane = input.width * input.height;
  assert.ok(Math.abs(input.data[1]! - (1 - 0.485) / 0.229) < 1e-5);
  assert.ok(Math.abs(input.data[plane + 1]! - (128 / 255 - 0.456) / 0.224) < 1e-5);
  assert.ok(Math.abs(input.data[2 * plane + 1]! - (0 - 0.406) / 0.225) < 1e-5);
  assert.ok(Math.abs(input.data[0]! - (0 - 0.485) / 0.229) < 1e-5);
  // A one-pixel checkerboard downscaled 2× averages instead of aliasing.
  const checker = new Uint8ClampedArray(1036 * 1036 * 4);
  for (let y = 0; y < 1036; y++) for (let x = 0; x < 1036; x++) checker.set((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * 1036 + x) * 4);
  const small = modelInput({ width: 1036, height: 1036, rgba: checker });
  const middle = small.data[259 * 518 + 259]! * 0.229 + 0.485;
  assert.ok(Math.abs(middle - 0.5) < 0.02, `averaged ${middle}`);
});

test('model output becomes a 0–1 near-to-far field at photo size, robust to outliers', () => {
  const raw = new Float32Array(100 * 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) raw[y * 100 + x] = x; // Nearer to the right.
  raw[0] = 1e6; // A single outlier does not compress everyone else.
  const depth = photoDepth(raw, 100, 100, 50, 30);
  assert.equal(depth.length, 50 * 30);
  const row = depth.subarray(15 * 50, 16 * 50);
  assert.ok(row[49]! > 0.95 && row[0]! < 0.05, `${row[0]} ${row[49]}`);
  for (let x = 1; x < 50; x++) assert.ok(row[x]! >= row[x - 1]! - 1e-6, 'monotonic like its source');
  assert.throws(() => photoDepth(new Float32Array(4).fill(2), 2, 2, 2, 2), /no depth variation/);
  assert.throws(() => photoDepth(Float32Array.from([0, NaN, 1, 2]), 2, 2, 2, 2), /invalid/);
  assert.throws(() => photoDepth(new Float32Array(3), 2, 2, 2, 2), /size/);
});

test('thresholds split pixels into editable near, subject and far planes as one undoable mask', () => {
  const depth = Float32Array.from({ length: 100 }, (_, i) => i / 99);
  const defaults = defaultThresholds(depth);
  assert.ok(Math.abs(defaults.farBelow - quantile(depth, 0.5)) < 1e-3);
  const labels = proposePlanes(depth, defaults);
  const [near, subject, far] = planeShares(labels);
  assert.ok(Math.abs(near - 0.05) <= 0.011 && Math.abs(far - 0.5) <= 0.011 && Math.abs(subject - 0.45) <= 0.02, `${near} ${subject} ${far}`);
  assert.deepEqual(thresholdsAround(0.5), { farBelow: 0.38, nearAbove: 0.62 });
  assert.deepEqual(thresholdsAround(0.05), { farBelow: 0, nearAbove: 0.17 });
  assert.equal(validThresholds({ farBelow: 0.6, nearAbove: 0.6 }), false);
  assert.throws(() => proposePlanes(depth, { farBelow: 0.7, nearAbove: 0.3 }), /far limit below the near limit/);

  // Applying a proposal is an ordinary mask edit: one undo restores the authored mask.
  const original = fillMask(createProject(photo(10, 10)), 1), history = new History(original);
  const proposed = { ...original, depth: encodeMask(labels, 10, 10) };
  assert.equal(history.commit(proposed), true);
  assert.deepEqual(history.undo(), original);
});
