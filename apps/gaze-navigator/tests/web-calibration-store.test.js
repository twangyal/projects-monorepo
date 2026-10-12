import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AGE_MS, decodeCalibration, encodeCalibration } from '../src/web/calibration-store.js';

const eye = (seed, width = 3, height = 2) => ({
  width, height, imagex: 10, imagey: 20,
  patch: { data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, index) => (index * seed) % 256) },
});
const sample = (seed, x, y) => ({ eyes: { left: eye(seed), right: eye(seed + 1) }, screenPos: [x, y], type: 'click' });
const viewport = { width: 1280, height: 800, now: 1000 };

test('encoded calibrations survive JSON storage and decode to setData input', () => {
  const samples = [sample(3, 100, 200), sample(7, 640, 400)];
  const stored = JSON.parse(JSON.stringify(encodeCalibration(samples, viewport)));
  assert.equal(stored.samples.length, 2);
  assert.equal(typeof stored.samples[0].eyes.left.patch, 'string');
  const decoded = decodeCalibration(stored, { ...viewport, now: 5000 });
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.samples[1].screenPos, [640, 400]);
  assert.equal(decoded.samples[1].type, 'click');
  assert.equal(decoded.samples[0].eyes.left.imagex, 10);
  assert.deepEqual([...decoded.samples[0].eyes.left.patch.data], [...samples[0].eyes.left.patch.data]);
  assert.deepEqual([...decoded.samples[1].eyes.right.patch.data], [...samples[1].eyes.right.patch.data]);
});

test('malformed samples are dropped instead of corrupting the regression', () => {
  const broken = sample(5, 1, 1);
  broken.eyes.left.width = 4;
  const stored = encodeCalibration([broken, { eyes: null }, sample(2, 5, 5)], viewport);
  assert.equal(stored.samples.length, 1);
});

test('calibrations are reused only for the same viewport and while recent', () => {
  const stored = encodeCalibration([sample(1, 1, 1)], viewport);
  assert.deepEqual(decodeCalibration(stored, { ...viewport, width: 1279 }), { ok: false, reason: 'resized' });
  assert.deepEqual(decodeCalibration(stored, { ...viewport, now: viewport.now + MAX_AGE_MS + 1 }), { ok: false, reason: 'expired' });
  assert.deepEqual(decodeCalibration(stored, { ...viewport, now: viewport.now - 1 }), { ok: false, reason: 'expired' });
  assert.deepEqual(decodeCalibration(null, viewport), { ok: false, reason: 'none' });
  assert.deepEqual(decodeCalibration({ ...stored, version: 99 }, viewport), { ok: false, reason: 'none' });
  assert.deepEqual(decodeCalibration({ ...stored, samples: [{ eyes: { left: { patch: '%%%' }, right: { patch: '' } }, screenPos: [1, 1] }] }, viewport),
    { ok: false, reason: 'invalid' });
});
