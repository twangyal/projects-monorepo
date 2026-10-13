import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraGaze } from '../src/web/camera-gaze.js';
import { runCalibration } from '../src/web/calibration.js';
import { deferred } from '../test-support/dom.js';

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function fakeEstimator({ faceVisible = () => true } = {}) {
  let listener = null;
  let samples = [];
  const api = {
    calls: [], params: {},
    setGazeListener(callback) { listener = callback; },
    clearGazeListener() { listener = null; api.calls.push('clearGazeListener'); },
    emit(point) { listener?.(point); },
    begin: async () => { api.calls.push('begin'); },
    saveDataAcrossSessions(value) { api.calls.push(`save:${value}`); },
    showPredictionPoints(value) { api.calls.push(`points:${value}`); },
    removeMouseEventListeners() { api.calls.push('removeMouse'); },
    end() { api.calls.push('end'); },
    stopVideo() { api.calls.push('stopVideo'); },
    getRegression: () => [{ init() { samples = []; api.calls.push('reset'); }, getData: () => samples }],
    recordScreenPosition(x, y) { if (faceVisible(x, y)) samples.push([Math.round(x), Math.round(y)]); },
    get samples() { return samples; },
  };
  return api;
}

const environment = () => ({ document: { getElementById: () => null }, window: { performance: { now: () => 5 } } });

test('starting configures a private estimator and forwards only valid gaze while ready', async () => {
  const api = fakeEstimator();
  const gaze = [];
  let lost = 0;
  const camera = createCameraGaze({ ...environment(), load: async () => api, onGaze: (x, y) => gaze.push([x, y]), onLost: () => lost++ });
  const result = await camera.start();
  assert.equal(result.ok, true);
  assert.equal(camera.state, 'ready');
  assert.deepEqual(api.calls, ['save:false', 'points:false', 'begin', 'removeMouse', 'reset']);
  api.emit({ x: 10, y: 20 });
  api.emit(null);
  api.emit({ x: NaN, y: 1 });
  assert.deepEqual(gaze, [[10, 20]]);
  assert.equal(lost, 2);
  assert.equal((await camera.start()).ok, false, 'a second start is refused');
  assert.equal(camera.stop(), true);
  assert.ok(api.calls.includes('stopVideo') && api.calls.includes('end'), 'stream and estimator released');
  api.emit({ x: 1, y: 1 });
  assert.deepEqual(gaze, [[10, 20]], 'a stopped session ignores late callbacks');
  assert.equal(camera.api, null);
});

test('stop during startup cancels it, and a restart asks the loader for a fresh estimator', async () => {
  const loading = deferred();
  const requests = [];
  const first = fakeEstimator();
  let next = first;
  const camera = createCameraGaze({ ...environment(), load: options => { requests.push(options.fresh); return requests.length === 1 ? loading.promise : Promise.resolve(next); }, onGaze() {}, onLost() {} });
  const starting = camera.start();
  assert.equal(camera.state, 'starting');
  camera.stop();
  assert.match((await starting).message, /cancelled/);
  loading.resolve(first);
  await flush();
  assert.deepEqual(first.calls, [], 'a late-loaded estimator is never started');

  const began = deferred();
  const second = fakeEstimator();
  second.begin = () => began.promise;
  next = second;
  const restarting = camera.start();
  await flush();
  camera.stop();
  assert.match((await restarting).message, /cancelled/);
  began.resolve();
  await flush();
  assert.ok(second.calls.includes('stopVideo'), 'a stream that arrives after stop is released');
  next = fakeEstimator();
  await camera.start();
  assert.deepEqual(requests, [false, false, true], 'only a started-then-stopped estimator forces a fresh load');
});

test('a failed start reports a recoverable message and releases what started', async () => {
  const api = fakeEstimator();
  api.begin = async () => { throw new Error('Permission denied'); };
  const camera = createCameraGaze({ ...environment(), load: async () => api, onGaze() {}, onLost() {} });
  const result = await camera.start();
  assert.equal(result.ok, false);
  assert.match(result.message, /Permission denied.*keep using the pointer/);
  assert.equal(camera.state, 'off');
  assert.ok(api.calls.includes('end'));
});

function manualClock() {
  let now = 0;
  const timers = new Map();
  let id = 0;
  return {
    window: {
      innerWidth: 1000, innerHeight: 500,
      setTimeout(callback, ms) { timers.set(++id, { callback, at: now + ms }); return id; },
      clearTimeout(timer) { timers.delete(timer); },
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
        await flush();
      }
      now = end;
    },
  };
}

test('hands-free calibration samples every dot after the settle period without clicks', async () => {
  const api = fakeEstimator();
  const clock = manualClock();
  const dot = { style: {}, className: '' };
  const progress = [];
  const run = runCalibration({ api, window: clock.window, dot, onProgress: event => progress.push(event) });
  await clock.advance(899);
  assert.equal(api.samples.length, 0, 'nothing is learned while the eyes settle');
  assert.equal(dot.className, 'calibration-dot settling');
  await clock.advance(1);
  assert.equal(api.samples.length, 1);
  assert.deepEqual(api.samples[0], [100, 60], 'first dot at 10% / 12% of the viewport');
  await clock.advance(20000);
  const result = await run.done;
  assert.deepEqual(result, { ok: true, cancelled: false, calibrated: 9, total: 9 });
  assert.equal(api.samples.length, 36);
  assert.equal(dot.className, 'calibration-dot hidden');
  assert.equal(progress.filter(event => event.phase === 'settle').length, 9);
});

test('dots without eye features are retried, and too few learned dots fail calibration', async () => {
  // The face is "visible" only for the left column.
  const api = fakeEstimator({ faceVisible: x => x < 200 });
  const clock = manualClock();
  const progress = [];
  const run = runCalibration({ api, window: clock.window, dot: { style: {} }, onProgress: event => progress.push(event) });
  await clock.advance(60000);
  const result = await run.done;
  assert.deepEqual(result, { ok: false, cancelled: false, calibrated: 3, total: 9 });
  assert.equal(progress.filter(event => event.phase === 'retry').length, 12, 'six failing dots, each retried once');
});

test('cancelling calibration stops sampling immediately', async () => {
  const api = fakeEstimator();
  const clock = manualClock();
  const dot = { style: {}, className: '' };
  const run = runCalibration({ api, window: clock.window, dot });
  await clock.advance(950);
  run.cancel();
  const result = await run.done;
  assert.deepEqual(result, { ok: false, cancelled: true, calibrated: 0 });
  const learned = api.samples.length;
  await clock.advance(20000);
  assert.equal(api.samples.length, learned);
  assert.equal(dot.className, 'calibration-dot hidden');
});
