import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness, deferred, estimator } from '../test-support/dom.js';

test('stop releases every media track even if dependency cleanup throws', async () => {
  const api = estimator();
  const app = await appHarness(api);
  let stopped = 0;
  app.nodes.webgazerVideoFeed.srcObject = { getTracks: () => [{ stop() { stopped++; } }, { stop() { stopped++; } }] };
  try {
    await app.nodes.startCamera.click();
    api.end = () => { throw new Error('overlay already removed'); };
    assert.doesNotThrow(() => app.nodes.stopTracking.click());
    assert.equal(stopped, 2, 'all webcam tracks must be stopped');
    assert.equal(app.nodes.startCamera.disabled, false);
    assert.equal(app.nodes.stopTracking.disabled, true);
  } finally { app.restore(); }
});

test('canceling a pending library load prevents begin and permits simulation', async () => {
  const app = await appHarness(undefined);
  const api = estimator();
  let begins = 0;
  api.begin = async () => { begins++; };
  try {
    const starting = app.nodes.startCamera.click();
    assert.equal(app.nodes.stopTracking.disabled, false, 'startup must be cancelable');
    const script = app.document.head.children[0];
    app.nodes.stopTracking.click();
    app.nodes.simulate.click();
    app.window.webgazer = api;
    script.onload();
    await starting;
    assert.equal(begins, 0);
    assert.match(app.nodes.status.textContent, /Calibration point/);
    assert.equal(app.nodes.simulate.disabled, true);
    app.nodes.stopTracking.click();
    assert.equal(app.nodes.startCamera.disabled, false);
  } finally { app.restore(); }
});

test('late begin after stop releases tracks without reopening calibration', async () => {
  const pending = deferred();
  const api = estimator();
  api.begin = () => pending.promise;
  const app = await appHarness(api);
  let stopped = 0;
  try {
    const starting = app.nodes.startCamera.click();
    await Promise.resolve();
    app.nodes.stopTracking.click();
    assert.equal(app.nodes.startCamera.disabled, true, 'do not overlap singleton startup');
    app.nodes.webgazerVideoFeed.srcObject = { getTracks: () => [{ stop() { stopped++; } }] };
    pending.resolve();
    await starting;
    assert.equal(stopped, 1);
    assert.equal(app.nodes.calibration.classList.contains('hidden'), true);
    assert.equal(app.nodes.startCamera.disabled, false);
    assert.equal(app.nodes.stopTracking.disabled, true);
    assert.match(app.nodes.status.textContent, /stopped/);
  } finally { app.restore(); }
});

test('late camera startup cannot reset a newly calibrated simulation', async () => {
  const pending = deferred();
  const api = estimator();
  api.begin = () => pending.promise;
  const app = await appHarness(api);
  try {
    const starting = app.nodes.startCamera.click();
    await Promise.resolve();
    app.nodes.stopTracking.click();
    app.nodes.simulate.click();
    for (let i = 0; i < 27; i++) app.nodes.calibrationStage.children[0].click();
    assert.equal(app.nodes.playground.classList.contains('hidden'), false);
    pending.resolve();
    await starting;
    assert.equal(app.nodes.playground.classList.contains('hidden'), false);
    assert.equal(app.nodes.calibration.classList.contains('hidden'), true);
    assert.equal(app.nodes.stopTracking.disabled, false);
    assert.equal(app.nodes.startCamera.disabled, true);
    assert.match(app.nodes.status.textContent, /Simulation active/);
    app.nodes.stopTracking.click();
  } finally { app.restore(); }
});
