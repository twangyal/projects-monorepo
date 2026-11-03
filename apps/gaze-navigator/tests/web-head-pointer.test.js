import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeadModel, headFeatures, MAX_HEAD_SAMPLES, MIN_HEAD_SAMPLES } from '../src/web/head-pointer.js';
import { decodeCalibration, encodeCalibration, encodeHeadCalibration } from '../src/web/calibration-store.js';
import { createLocalCamera } from '../src/web/camera-source.js';
import { interpret } from '../src/web/interpreter.js';

// FaceMesh-like landmarks: eye corners 40 px apart, the nose tip `turn` and `tilt` eye widths from between them, the
// whole face rotated by `roll` and moved to (cx, cy).
function face({ turn = 0, tilt = 0.5, roll = 0, cx = 320, cy = 240 } = {}) {
  const positions = Array.from({ length: 468 }, () => [cx, cy, 0]);
  const place = (x, y) => [cx + x * Math.cos(roll) - y * Math.sin(roll), cy + x * Math.sin(roll) + y * Math.cos(roll), 0];
  positions[33] = place(-20, 0); positions[263] = place(20, 0); positions[1] = place(40 * turn, 40 * tilt);
  return positions;
}

test('the head pose is read from the landmarks, unaffected by leaning the head sideways', () => {
  assert.deepEqual(headFeatures(face(), 640, 480), [0, 0.5, 0.5, 0.5]);
  const turned = headFeatures(face({ turn: 0.25, tilt: 0.4 }), 640, 480);
  assert.ok(Math.abs(turned[0] - 0.25) < 1e-12 && Math.abs(turned[1] - 0.4) < 1e-12);
  const leaning = headFeatures(face({ turn: 0.25, tilt: 0.4, roll: 0.5 }), 640, 480);
  assert.ok(Math.abs(leaning[0] - 0.25) < 1e-9 && Math.abs(leaning[1] - 0.4) < 1e-9, `${leaning}`);
  assert.deepEqual(headFeatures(face({ cx: 160, cy: 360 }), 640, 480).slice(2), [0.25, 0.75]);
  // Missing or implausible landmarks give no pose.
  assert.equal(headFeatures(null), null);
  assert.equal(headFeatures(face().slice(0, 100)), null);
  const squeezed = face(); squeezed[263] = [301, 240, 0];
  assert.equal(headFeatures(squeezed), null);
});

test('calibration pairs map the head pose to the screen, and saved pairs come back', () => {
  const model = createHeadModel(), screen = ({ turn, tilt, cx }) => ({ x: 960 + 2400 * turn + 0.5 * (cx - 320), y: 540 + 1800 * (tilt - 0.5) });
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.004; };
  // Nine dots, four samples each, with a little landmark jitter and the head drifting a few pixels.
  const poses = [];
  for (const turn of [-0.3, 0, 0.3]) for (const tilt of [0.3, 0.5, 0.7]) for (let k = 0; k < 4; k++) poses.push({ turn: turn + noise(), tilt: tilt + noise(), cx: 320 + k });
  for (const [n, pose] of poses.entries()) {
    assert.equal(model.predict(headFeatures(face(pose))), null, 'nothing is placed before calibration');
    const { x, y } = screen(pose);
    assert.equal(model.add(headFeatures(face(pose)), x, y), true);
    if (n + 1 >= MIN_HEAD_SAMPLES) break;
  }
  for (const pose of poses.slice(MIN_HEAD_SAMPLES)) { const { x, y } = screen(pose); model.add(headFeatures(face(pose)), x, y); }
  for (const pose of [{ turn: 0.15, tilt: 0.6, cx: 321 }, { turn: -0.2, tilt: 0.35, cx: 322 }]) {
    const at = model.predict(headFeatures(face(pose))), want = screen(pose);
    assert.ok(Math.hypot(at.x - want.x, at.y - want.y) < 15, `${JSON.stringify(at)} against ${JSON.stringify(want)}`);
  }
  assert.equal(model.add(null, 1, 2), false);
  // Saved samples restore the same map; malformed ones change nothing.
  const copy = createHeadModel();
  assert.equal(copy.setSamples(model.samples), true);
  assert.deepEqual(copy.predict(headFeatures(face({ turn: 0.1 }))), model.predict(headFeatures(face({ turn: 0.1 }))));
  assert.equal(copy.setSamples([{ features: [1, 2], x: 0, y: 0 }]), false);
  assert.equal(copy.size, poses.length);
  for (let n = 0; n < MAX_HEAD_SAMPLES + 20; n++) copy.add([0.01 * (n % 7), 0.5, 0.5, 0.5], n, n);
  assert.equal(copy.size, MAX_HEAD_SAMPLES);
});

test('a head calibration is stored apart from an eye calibration and never reused for the other', () => {
  const size = { width: 1280, height: 720, now: 1000 }, samples = [{ features: [0, 0.5, 0.5, 0.5], x: 10, y: 20 }];
  const head = encodeHeadCalibration(samples, size);
  assert.deepEqual(decodeCalibration(head, { ...size, mode: 'head' }), { ok: true, samples });
  assert.deepEqual(decodeCalibration(head, size), { ok: false, reason: 'mode' });
  const eye = { width: 1, height: 1, patch: { data: new Uint8Array(4) } };
  assert.deepEqual(decodeCalibration(encodeCalibration([{ eyes: { left: eye, right: eye }, screenPos: [1, 2], type: 'click' }], size), { ...size, mode: 'head' }), { ok: false, reason: 'mode' });
  assert.deepEqual(decodeCalibration({ ...head, samples: [{ features: [0, 'x', 0, 0], x: 1, y: 2 }] }, { ...size, mode: 'head' }), { ok: false, reason: 'invalid' });
});

test('in head mode the camera trains and follows the head pose, leaving the eye model alone', async () => {
  let listener = null, positions = face(), eyeSamples = 0, now = 0, saved = null;
  const api = { params: {}, saveDataAcrossSessions() {}, showPredictionPoints() {}, setGazeListener(callback) { listener = callback; }, begin: async () => {}, removeMouseEventListeners() {},
    getRegression: () => [{ init() {}, getData: () => [], setData() {} }], recordScreenPosition() { eyeSamples++; },
    getTracker: () => ({ getPositions: () => positions }) };
  const gaze = [], lost = [];
  const window = { performance: { now: () => now } };
  const camera = createLocalCamera({ document: { getElementById: () => null }, window, load: async () => api,
    store: { saveCalibration: value => { saved = value; }, loadCalibration: async () => saved }, onGaze: (x, y) => gaze.push([x, y]), onLost: () => lost.push(now) });
  camera.setMode('head');
  await camera.start();
  const frame = pose => { now += 33; positions = face(pose); listener(null); };
  // Calibration: point at each of nine places.
  for (const [n, [turn, tilt, x, y]] of [[-0.3, 0.3, 100, 100], [0, 0.3, 640, 100], [0.3, 0.3, 1180, 100], [-0.3, 0.5, 100, 360], [0, 0.5, 640, 360], [0.3, 0.5, 1180, 360],
    [-0.3, 0.7, 100, 620], [0, 0.7, 640, 620], [0.3, 0.7, 1180, 620]].entries()) {
    frame({ turn, tilt });
    // Nothing is placed until there are enough calibration pairs.
    assert.equal(gaze.length, Math.max(0, n - 5));
    assert.equal(camera.recordSample(x, y), true);
  }
  assert.equal(eyeSamples, 0, 'the eye model is not trained in head mode');
  frame({ turn: 0.15, tilt: 0.4 });
  const [x, y] = gaze.at(-1);
  assert.ok(Math.abs(x - 910) < 2 && Math.abs(y - 230) < 2, `${x}, ${y}`);
  // The same landmark list again means the face was not found this frame; after half a second the head is lost.
  now += 600; listener(null);
  assert.equal(lost.length, 1);
  // The calibration is saved as a head calibration and restored for the head mode only.
  camera.saveCalibration({ width: 1280, height: 720, now: 5 });
  assert.equal(saved.mode, 'head');
  assert.equal((await camera.restoreCalibration({ width: 1280, height: 720, now: 6 })).ok, true);
  camera.setMode('eyes');
  assert.deepEqual(await camera.restoreCalibration({ width: 1280, height: 720, now: 6 }), { ok: false, reason: 'mode' });
});

test('"use head pointer" and its everyday forms choose the head pointer', () => {
  for (const said of ['use head pointer', 'use the head pointer', 'use my head', 'switch to head tracking', 'head mode', 'head pointer mode', 'point with my head', 'turn on head tracking']) {
    assert.deepEqual(interpret(said, { elements: [] }), { type: 'tracking', source: 'head' }, said);
  }
  assert.deepEqual(interpret('use camera', { elements: [] }), { type: 'tracking', source: 'camera' });
  assert.deepEqual(interpret('use eye tracking', { elements: [] }), { type: 'tracking', source: 'camera' });
});
