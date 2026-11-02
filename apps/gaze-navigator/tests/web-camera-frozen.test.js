import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraGaze, FROZEN_MS } from '../src/web/camera-gaze.js';

// A camera whose picture is a number: equal numbers are identical frames. Each session names its own video element.
function setup() {
  let listener = null, picture = 1, tick = null;
  const api = {
    params: {}, setGazeListener(callback) { listener = callback; }, begin: async () => {}, saveDataAcrossSessions() {}, showPredictionPoints() {},
    removeMouseEventListeners() {}, end() {}, stopVideo() {}, getRegression: () => [{ init() {}, getData: () => [] }],
  };
  const video = { readyState: 4 };
  const context = { drawImage() {}, getImageData: () => ({ data: Uint8ClampedArray.from({ length: 64 * 48 * 4 }, (_, i) => (picture + i) % 256) }) };
  const document = { getElementById: id => (id === 'gaze-camera-web-1-videoElementId' ? video : null), createElement: () => ({ getContext: () => context }) };
  const window = { performance: { now: () => 5 }, setInterval: callback => { tick = callback; return 1; }, clearInterval: () => { tick = null; } };
  const gaze = [], lost = [];
  const camera = createCameraGaze({ document, window, load: async () => api, onGaze: (x, y) => gaze.push([x, y]), onLost: reason => lost.push(reason) });
  return { camera, gaze, lost, video, emit: point => listener?.(point), change: () => { picture++; }, run: ms => { for (let t = 0; t < ms; t += 500) tick?.(); }, ticking: () => tick !== null };
}

test('a picture that stops changing is lost tracking until it moves again', async () => {
  const camera = setup();
  await camera.camera.start();
  camera.emit({ x: 1, y: 2 });
  // A changing picture keeps estimates flowing.
  for (let i = 0; i < 10; i++) { camera.change(); camera.run(500); }
  assert.deepEqual(camera.lost, []);
  // Frozen: lost once, with its reason, and the estimates it keeps making are dropped.
  camera.run(FROZEN_MS + 500);
  assert.deepEqual(camera.lost, ['frozen']);
  camera.emit({ x: 3, y: 4 });
  camera.run(2000);
  assert.deepEqual(camera.lost, ['frozen']);
  assert.deepEqual(camera.gaze, [[1, 2]]);
  // Moving again restores tracking.
  camera.change(); camera.run(500);
  camera.emit({ x: 5, y: 6 });
  assert.deepEqual(camera.gaze, [[1, 2], [5, 6]]);
});

test('a picture still for less than the limit, or a camera not yet playing, is not frozen; stopping ends the watch', async () => {
  const camera = setup();
  await camera.camera.start();
  camera.run(FROZEN_MS - 500);
  camera.change(); camera.run(FROZEN_MS - 500);
  assert.deepEqual(camera.lost, []);
  camera.video.readyState = 1;
  camera.run(FROZEN_MS * 3);
  assert.deepEqual(camera.lost, []);
  camera.camera.stop();
  assert.equal(camera.ticking(), false);
});
