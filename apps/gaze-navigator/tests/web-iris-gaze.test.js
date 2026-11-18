import test from 'node:test';
import assert from 'node:assert/strict';
import { createIrisModel, irisFeatures, MAX_IRIS_SAMPLES, MIN_IRIS_SAMPLES, MOVED_SPREAD } from '../src/web/iris-gaze.js';
import { MOVED_MS } from '../src/web/camera-gaze.js';
import { decodeCalibration, encodeCalibration } from '../src/web/calibration-store.js';
import { createLocalCamera } from '../src/web/camera-source.js';

// FaceMesh-like landmarks with irises: eyes 25 px wide either side of (cx, cy), lids 4 px above and below each eye's
// middle, and each iris moved `gx` and `gy` (from -1 to 1) of a fifth of the eye's width from its middle. The iris
// model's two centres come after the mesh's 468 points, the left eye's first.
function face({ gx = 0, gy = 0, cx = 320, cy = 240 } = {}) {
  const positions = Array.from({ length: 478 }, () => [cx, cy + 30, 0]);
  const eye = (outer, inner, upper, lower, iris, from, to) => {
    positions[outer] = [cx + from, cy, 0]; positions[inner] = [cx + to, cy, 0];
    const mx = cx + (from + to) / 2;
    positions[upper] = [mx, cy - 4, 0]; positions[lower] = [mx, cy + 4, 0];
    positions[iris] = [mx + gx * 5, cy + gy * 2.5, 0];
  };
  eye(33, 133, 159, 145, 473, -40, -15);
  eye(263, 362, 386, 374, 468, 40, 15);
  positions[1] = [cx, cy + 20, 0];
  return positions;
}
const screen = ({ gx, gy }) => ({ x: 960 + 800 * gx, y: 540 + 400 * gy });

test('the eye pose is where each iris sits between its eye\'s corners and lids, beside the head\'s pose', () => {
  const ahead = irisFeatures(face(), 640, 480);
  assert.equal(ahead.length, 10);
  assert.deepEqual(ahead.slice(0, 3).map(v => +v.toFixed(6)), [0.5, 0, 0.32]);
  // Looking toward the wearer's left moves the right eye's iris toward its inner corner and the left eye's toward its outer.
  const left = irisFeatures(face({ gx: 1 }), 640, 480);
  assert.ok(left[0] > ahead[0] && left[3] < ahead[3], `${left}`);
  const down = irisFeatures(face({ gy: 1 }), 640, 480);
  assert.ok(down[1] > ahead[1], `${down}`);
  // Without the iris model's points, or with a missing landmark, there is no eye pose.
  assert.equal(irisFeatures(face().slice(0, 468)), null);
  const broken = face(); broken[159] = [NaN, 0, 0];
  assert.equal(irisFeatures(broken), null);
  assert.equal(irisFeatures(null), null);
});

test('calibration pairs map the eye pose to the screen, and saved pairs come back', () => {
  const model = createIrisModel();
  let seed = 11;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.02; };
  const poses = [];
  for (const gy of [-0.8, 0, 0.8]) for (const gx of [-0.8, 0, 0.8]) for (let k = 0; k < 4; k++) poses.push({ gx: gx + noise(), gy: gy + noise(), cx: 320 + k });
  for (const [n, pose] of poses.entries()) {
    const features = irisFeatures(face(pose));
    if (n < MIN_IRIS_SAMPLES) assert.equal(model.predict(features), null, 'nothing is placed before calibration');
    const { x, y } = screen(pose);
    assert.equal(model.add(features, x, y), true);
  }
  assert.ok(model.ready);
  for (const pose of [{ gx: 0.4, gy: -0.3, cx: 321 }, { gx: -0.5, gy: 0.6, cx: 322 }]) {
    const at = model.predict(irisFeatures(face(pose))), want = screen(pose);
    assert.ok(Math.hypot(at.x - want.x, at.y - want.y) < 25, `${JSON.stringify(at)} against ${JSON.stringify(want)}`);
  }
  assert.equal(model.add(null, 1, 2), false);
  const copy = createIrisModel();
  assert.equal(copy.setSamples(model.samples), true);
  assert.deepEqual(copy.predict(irisFeatures(face({ gx: 0.2 }))), model.predict(irisFeatures(face({ gx: 0.2 }))));
  assert.equal(copy.setSamples([{ features: [1, 2], x: 0, y: 0 }]), false);
  assert.equal(copy.size, poses.length);
  for (let n = 0; n < MAX_IRIS_SAMPLES + 20; n++) copy.add(irisFeatures(face({ gx: (n % 9) / 9 - 0.5 })), n, n);
  assert.equal(copy.size, MAX_IRIS_SAMPLES);
});

test('an eye calibration keeps its iris samples beside WebGazer\'s, and older ones without them still load', () => {
  const size = { width: 1280, height: 720, now: 1000 }, eye = { width: 1, height: 1, patch: { data: new Uint8Array(4) } };
  const samples = [{ eyes: { left: eye, right: eye }, screenPos: [1, 2], type: 'click' }], iris = [{ features: irisFeatures(face()), x: 10, y: 20 }];
  const stored = encodeCalibration(samples, { ...size, iris });
  assert.deepEqual(decodeCalibration(stored, size).iris, iris);
  const older = encodeCalibration(samples, size);
  assert.equal(Object.hasOwn(older, 'iris'), false);
  assert.deepEqual(decodeCalibration(older, size).iris, []);
  assert.deepEqual(decodeCalibration({ ...stored, iris: [{ features: [1], x: 0, y: 0 }] }, size), { ok: false, reason: 'invalid' });
});

test('the camera asks for the irises, follows WebGazer until calibrated, then the irises', async () => {
  let listener = null, positions = face(), eyeSamples = 0, now = 0, saved = null, asked = null, data = [];
  const model = { estimateFaces: async config => { asked = config; return []; } };
  // WebGazer's samples: tiny eye patches and the trained point.
  const eye = () => ({ width: 1, height: 1, patch: { data: new Uint8ClampedArray(4) } });
  const api = { params: {}, saveDataAcrossSessions() {}, showPredictionPoints() {}, setGazeListener(callback) { listener = callback; }, begin: async () => {}, removeMouseEventListeners() {},
    getRegression: () => [{ init() { data = []; }, getData: () => data, setData(samples) { data.push(...samples); } }],
    recordScreenPosition(x, y, type) { eyeSamples++; data.push({ eyes: { left: eye(), right: eye() }, screenPos: [x, y], type }); },
    getTracker: () => ({ getPositions: () => positions, model: Promise.resolve(model) }) };
  const gaze = [];
  const camera = createLocalCamera({ document: { getElementById: () => null }, window: { performance: { now: () => now } }, load: async () => api,
    store: { saveCalibration: value => { saved = value; }, loadCalibration: async () => saved }, onGaze: (x, y) => gaze.push([x, y]), onLost() {} });
  assert.equal((await camera.start()).ok, true);
  // WebGazer's own requests now include the irises.
  await model.estimateFaces({ input: 'frame', predictIrises: false });
  assert.equal(asked.predictIrises, true);
  const frame = (pose, estimate) => { now += 33; positions = face(pose); listener(estimate); };
  // Before calibration the gaze is WebGazer's estimate.
  frame({ gx: 0.5 }, { x: 77, y: 88 });
  assert.deepEqual(gaze.at(-1), [77, 88]);
  for (const gy of [-0.8, 0, 0.8]) for (const gx of [-0.8, 0, 0.8]) {
    frame({ gx, gy }, { x: 1, y: 1 });
    const { x, y } = screen({ gx, gy });
    assert.equal(camera.recordSample(x, y), true);
  }
  assert.equal(eyeSamples, 9, 'WebGazer still learns each point');
  // Calibrated, the irises place the gaze and WebGazer's estimate is not used.
  frame({ gx: 0.4, gy: -0.4 }, { x: 1, y: 1 });
  const [x, y] = gaze.at(-1), want = screen({ gx: 0.4, gy: -0.4 });
  assert.ok(Math.hypot(x - want.x, y - want.y) < 25, `${x}, ${y}`);
  // Saved and restored, the iris samples come back with the calibration.
  camera.saveCalibration({ width: 1280, height: 720, now: 5 });
  assert.equal(saved.iris.length, 9);
  camera.resetCalibration();
  frame({ gx: 0.4, gy: -0.4 }, { x: 3, y: 4 });
  assert.deepEqual(gaze.at(-1), [3, 4], 'reset, WebGazer places the gaze again');
  assert.equal((await camera.restoreCalibration({ width: 1280, height: 720, now: 6 })).ok, true);
  frame({ gx: 0.4, gy: -0.4 }, { x: 3, y: 4 });
  assert.ok(Math.hypot(gaze.at(-1)[0] - want.x, gaze.at(-1)[1] - want.y) < 25);
});

test('a head well away from where it was calibrated is noticed, and reported with the gaze after a moment', async () => {
  const model = createIrisModel();
  for (const gy of [-0.8, 0, 0.8]) for (const gx of [-0.8, 0, 0.8]) { const { x, y } = screen({ gx, gy }); model.add(irisFeatures(face({ gx, gy })), x, y); }
  assert.ok(model.offset(irisFeatures(face({ gx: 0.3 }))) < 1, 'looking around in place is not moving');
  // The eyes 100 px across a 640 px picture: about four of a still calibration's spreads (a twenty-fifth of the
  // picture each); 40 px is not yet a move.
  assert.ok(model.offset(irisFeatures(face({ cx: 420 }))) > MOVED_SPREAD);
  assert.ok(model.offset(irisFeatures(face({ cx: 360 }))) < MOVED_SPREAD);
  assert.equal(createIrisModel().offset(irisFeatures(face())), 0, 'nothing before calibration');

  let listener = null, positions = face(), now = 0, data = [];
  const eye = () => ({ width: 1, height: 1, patch: { data: new Uint8ClampedArray(4) } });
  const api = { params: {}, saveDataAcrossSessions() {}, showPredictionPoints() {}, setGazeListener(callback) { listener = callback; }, begin: async () => {}, removeMouseEventListeners() {},
    getRegression: () => [{ init() { data = []; }, getData: () => data, setData(samples) { data.push(...samples); } }],
    recordScreenPosition(x, y, type) { data.push({ eyes: { left: eye(), right: eye() }, screenPos: [x, y], type }); },
    getTracker: () => ({ getPositions: () => positions }) };
  const gaze = [];
  const camera = createLocalCamera({ document: { getElementById: () => null }, window: { performance: { now: () => now } }, load: async () => api,
    onGaze: (x, y, time, extra) => gaze.push(extra ?? null), onLost() {} });
  await camera.start();
  const frame = pose => { now += 100; positions = face(pose); listener(null); };
  for (const gy of [-0.8, 0, 0.8]) for (const gx of [-0.8, 0, 0.8]) { frame({ gx, gy }); const { x, y } = screen({ gx, gy }); camera.recordSample(x, y); }
  frame({ gx: 0.2 });
  assert.equal(gaze.at(-1), null);
  // Leaning well to one side: only after MOVED_MS does each gaze point say so, and coming back clears it.
  for (let t = 0; t < MOVED_MS; t += 100) { frame({ gx: 0.2, cx: 420 }); assert.equal(gaze.at(-1), null, `${t} ms`); }
  frame({ gx: 0.2, cx: 420 });
  assert.deepEqual(gaze.at(-1), { moved: true });
  frame({ gx: 0.2 });
  assert.equal(gaze.at(-1), null);
});
