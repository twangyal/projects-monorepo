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
  const begun = deferred();
  const api = estimator();
  api.begin = () => { begun.resolve(); return pending.promise; };
  const app = await appHarness(api);
  let stopped = 0;
  try {
    const starting = app.nodes.startCamera.click();
    await begun.promise;
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
  const begun = deferred();
  const api = estimator();
  api.begin = () => { begun.resolve(); return pending.promise; };
  const app = await appHarness(api);
  try {
    const starting = app.nodes.startCamera.click();
    await begun.promise;
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

test('stop settles the app startup even when the dependency never finishes video readiness', async () => {
  const begun = deferred();
  const api = estimator();
  api.begin = () => { begun.resolve(); return new Promise(() => {}); };
  const app = await appHarness(api);
  let stopped = 0;
  let settled = false;
  try {
    const starting = app.nodes.startCamera.click();
    starting.then(() => { settled = true; });
    await begun.promise;
    app.nodes.webgazerVideoFeed.srcObject = { getTracks: () => [{ stop() { stopped++; } }] };
    app.nodes.stopTracking.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(stopped, 1);
    assert.equal(settled, true, 'dependency readiness must not block cancellation');
    assert.equal(app.nodes.startCamera.disabled, false, 'retry must be available after cancellation');
    assert.equal(app.nodes.calibration.classList.contains('hidden'), true);
  } finally { app.restore(); }
});

test('a late stream is released before a canceled dependency begin resolves', async () => {
  const begun = deferred();
  const api = estimator();
  api.begin = () => { begun.resolve(); return new Promise(() => {}); };
  const app = await appHarness(api);
  let notifyMutation;
  app.window.MutationObserver = class {
    constructor(callback) { notifyMutation = callback; }
    observe() {}
    disconnect() { notifyMutation = null; }
  };
  let stopped = 0;
  try {
    app.nodes.startCamera.click();
    await begun.promise;
    app.nodes.stopTracking.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    app.nodes.webgazerVideoFeed.srcObject = { getTracks: () => [{ stop() { stopped++; } }] };
    assert.equal(typeof notifyMutation, 'function', 'retired startup must watch for its own late stream');
    notifyMutation();
    assert.equal(stopped, 1);
    assert.equal(app.nodes.webgazerVideoFeed.srcObject, null);
    assert.equal(notifyMutation, null, 'observer disconnects after releasing the late stream');
  } finally { app.restore(); }
});

test('retry uses an isolated instance while a retired camera still awaits permission', async () => {
  const begun = deferred();
  const oldApi = estimator();
  oldApi.begin = () => { begun.resolve(); return new Promise(() => {}); };
  const app = await appHarness(oldApi);
  let notifyMutation;
  app.window.MutationObserver = class {
    constructor(callback) { notifyMutation = callback; }
    observe() {}
    disconnect() { notifyMutation = null; }
  };
  let oldStopped = 0;
  let newStopped = 0;
  let newEnded = 0;
  try {
    const starting = app.nodes.startCamera.click();
    await begun.promise;
    const oldVideoId = oldApi.params.videoElementId;
    app.nodes.stopTracking.click();
    await starting;
    const retrying = app.nodes.startCamera.click();
    const newApi = estimator();
    newApi.end = () => { newEnded++; };
    app.window.webgazer = newApi;
    app.document.head.children.at(-1).onload();
    await retrying;
    assert.notEqual(newApi.params.videoElementId, oldVideoId);
    const newVideo = app.document.getElementById(newApi.params.videoElementId);
    newVideo.srcObject = { getTracks: () => [{ stop() { newStopped++; } }] };
    const oldVideo = app.document.getElementById(oldVideoId);
    oldVideo.srcObject = { getTracks: () => [{ stop() { oldStopped++; } }] };
    notifyMutation();
    assert.equal(oldStopped, 1);
    assert.equal(newStopped, 0, 'old startup must not release the new camera stream');
    assert.equal(newEnded, 0, 'old startup must not end the new dependency instance');
    assert.equal(app.nodes.calibration.classList.contains('hidden'), false);
    assert.equal(app.nodes.stopTracking.disabled, false);
    app.nodes.stopTracking.click();
    assert.equal(newStopped, 1);
  } finally { app.restore(); }
});

test('a completed camera is also replaced instead of reusing its pending inference loop', async () => {
  const oldApi = estimator();
  const app = await appHarness(oldApi);
  let retrying;
  try {
    await app.nodes.startCamera.click();
    app.nodes.stopTracking.click();
    retrying = app.nodes.startCamera.click();
    assert.equal(app.document.head.children.length, 1, 'stopped APIs must never be reused');
    const newApi = estimator();
    app.window.webgazer = newApi;
    app.document.head.children[0].onload();
    await retrying;
    assert.notEqual(newApi.params.videoElementId, oldApi.params.videoElementId);
    app.nodes.stopTracking.click();
  } finally { app.nodes.stopTracking.click(); await retrying; app.restore(); }
});
