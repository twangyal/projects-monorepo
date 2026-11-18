import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalCamera } from '../src/web/camera-source.js';
import { MAX_AGE_MS, encodeCalibration } from '../src/web/calibration-store.js';

async function fixture({ now = 123 } = {}) {
  let samples = [], applied = 0, release;
  const eye = { width: 1, height: 1, patch: { data: new Uint8Array(4) } };
  const size = { width: 800, height: 600, now };
  const stored = encodeCalibration([{ eyes: { left: eye, right: eye }, screenPos: [10, 20], type: 'click' }], size);
  const api = { params: {}, saveDataAcrossSessions() {}, showPredictionPoints() {}, setGazeListener() {}, begin: async () => {}, removeMouseEventListeners() {},
    getRegression: () => [{ init() { samples = []; }, getData: () => samples, setData(data) { applied++; samples = data; } }],
    recordScreenPosition(x, y) { samples.push([x, y]); } };
  const pending = new Promise(resolve => { release = () => resolve(stored); });
  const camera = createLocalCamera({ document: { getElementById: () => null }, window: {}, load: async () => api, store: { loadCalibration: () => pending } });
  await camera.start();
  return { camera, size, release, data: () => samples, applied: () => applied };
}

test('resetting the model invalidates a pending stored calibration', async () => {
  const f = await fixture();
  const restore = f.camera.restoreCalibration(f.size);
  f.camera.resetCalibration(); f.camera.recordSample(999, 888); f.release();
  assert.equal((await restore).ok, false);
  assert.equal(f.applied(), 0);
  assert.deepEqual(f.data(), [[999, 888]]);
});

test('a current stored calibration still restores through the local provider', async () => {
  const f = await fixture();
  const restore = f.camera.restoreCalibration(f.size); f.release();
  assert.equal((await restore).ok, true); assert.equal(f.applied(), 1);
  assert.deepEqual(f.data()[0].screenPos, [10, 20]);
});

test('an old stored calibration is restored but reported stale, to be refreshed', async () => {
  const f = await fixture();
  const restore = f.camera.restoreCalibration({ ...f.size, now: f.size.now + MAX_AGE_MS + 1 }); f.release();
  assert.deepEqual(await restore, { ok: true, stale: true });
  assert.equal(f.applied(), 1);
  assert.deepEqual(f.data()[0].screenPos, [10, 20]);
});
