import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness, estimator } from '../test-support/dom.js';

test('gaze pause stays latched, permits only safety actions, and resumes after leaving', async () => {
  const api = estimator();
  const app = await appHarness(api);
  const oldPerformance = globalThis.performance;
  let now = 0;
  globalThis.performance = { now: () => now };
  let target = app.nodes.pauseTracking;
  app.document.elementFromPoint = () => target;
  const look = () => {
    for (let i = 0; i < 12; i++, now += 100) api.emit({ x: 100, y: 100 });
  };
  try {
    await app.nodes.startCamera.click();
    for (let i = 0; i < 27; i++) app.nodes.calibrationStage.children[0].emit('click', { isTrusted: true, detail: 1 });
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking');
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking', 'holding Pause must not resume');
    api.emit(null);
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking', 'missing camera data is not a deliberate look away');
    api.emit({ x: NaN, y: 100 });
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking', 'invalid data must not release the paused safety latch');
    target = app.nodes.composeButton;
    look();
    assert.equal(app.nodes.composer.classList.contains('hidden'), true, 'workspace actions are suspended');
    target = app.nodes.pageDown;
    look();
    assert.equal(app.window.lastScroll, undefined, 'page scrolling is suspended');
    target = app.nodes.pauseTracking;
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Pause tracking');
    target = app.nodes.pageDown;
    look();
    assert.ok(app.window.lastScroll > 0, 'page scrolls down');
    target = app.nodes.pageUp;
    look();
    assert.ok(app.window.lastScroll < 0, 'page scrolls up');
    app.window.emit('keydown', { key: 'Escape' });
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking');
    target = app.nodes.stopTracking;
    look();
    assert.equal(app.nodes.stopTracking.disabled, true);
    assert.equal(app.nodes.startCamera.disabled, false);
  } finally {
    app.restore();
    globalThis.performance = oldPerformance;
  }
});

test('pointer simulation can resume and stop through the paused safety controls', async () => {
  const app = await appHarness(estimator());
  let target = app.nodes.pauseTracking;
  app.document.elementFromPoint = () => target;
  let now = 0;
  const look = () => {
    app.document.emit('pointermove', { clientX: 100, clientY: 100 });
    for (let i = 0; i < 12; i++, now += 100) app.tick(now);
  };
  try {
    app.nodes.simulate.click();
    for (let i = 0; i < 27; i++) app.nodes.calibrationStage.children[0].click();
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking');
    target = null;
    look();
    target = app.nodes.pauseTracking;
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Pause tracking', 'simulation must be able to resume');
    app.window.emit('keydown', { key: 'Escape' });
    target = app.nodes.stopTracking;
    look();
    assert.equal(app.nodes.startCamera.disabled, false);
    assert.equal(app.nodes.stopTracking.disabled, true);
  } finally { app.restore(); }
});

test('gaze can pause an accuracy check and close its completed report', async () => {
  const api = estimator();
  const app = await appHarness(api);
  const oldPerformance = globalThis.performance;
  let now = 0;
  globalThis.performance = { now: () => now };
  let target = app.nodes.pauseTracking;
  app.document.elementFromPoint = () => target;
  const look = () => { for (let i = 0; i < 12; i++, now += 100) api.emit({ x: 100, y: 100 }); };
  try {
    await app.nodes.startCamera.click();
    for (let i = 0; i < 27; i++) app.nodes.calibrationStage.children[0].emit('click', { isTrusted: true, detail: 1 });
    app.nodes.checkAccuracy.click();
    look();
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking', 'safety pause remains available during measurement');
    assert.match(app.nodes.accuracyResult.textContent, /cancelled/);
    target = null;
    look();
    target = app.nodes.pauseTracking;
    look();
    app.nodes.checkAccuracy.click();
    now += 11000;
    app.tick(now);
    target = app.nodes.cancelAccuracy;
    look();
    assert.equal(app.nodes.accuracyPanel.classList.contains('hidden'), true, 'completed report can be closed hands-free');
    app.nodes.stopTracking.click();
  } finally { app.restore(); globalThis.performance = oldPerformance; }
});

test('accuracy safety confirmation requires uninterrupted gaze on the safety control', async () => {
  const api = estimator();
  const app = await appHarness(api);
  const oldPerformance = globalThis.performance;
  let now = 0;
  globalThis.performance = { now: () => now };
  let target = app.nodes.pauseTracking;
  app.document.elementFromPoint = () => target;
  try {
    await app.nodes.startCamera.click();
    for (let i = 0; i < 27; i++) app.nodes.calibrationStage.children[0].emit('click', { isTrusted: true, detail: 1 });
    app.nodes.checkAccuracy.click();
    for (; now < 2000; now += 100) {
      target = now % 200 === 0 ? app.nodes.pauseTracking : null;
      api.emit({ x: 100, y: 100 });
    }
    assert.equal(app.nodes.pauseTracking.textContent, 'Pause tracking', 'separated looks must not accumulate');
    assert.equal(app.nodes.pauseTracking.classList.contains('gaze-focus'), false);
    app.nodes.stopTracking.click();
  } finally { app.restore(); globalThis.performance = oldPerformance; }
});
