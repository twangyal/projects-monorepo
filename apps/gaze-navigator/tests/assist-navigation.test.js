import test from 'node:test';
import assert from 'node:assert/strict';
import { appHarness, estimator } from '../test-support/dom.js';

// Places named controls at fixed rectangles; everything else is empty page.
function layout(app, rects) {
  const blank = { closest: () => null };
  const inside = ([left, top, width, height], x, y) => x >= left && x <= left + width && y >= top && y <= top + height;
  for (const [id, [left, top, width, height]] of Object.entries(rects)) {
    app.nodes[id].getBoundingClientRect = () => ({ left, top, width, height });
  }
  app.document.elementFromPoint = (x, y) => {
    const id = Object.keys(rects).find(key => inside(rects[key], x, y));
    return id ? app.nodes[id] : blank;
  };
  const targets = Object.keys(rects).map(id => app.nodes[id]);
  app.nodes.navigationRoot.querySelectorAll = () => targets;
  app.nodes.trackingControls.querySelectorAll = () => targets.filter(node => app.nodes.trackingControls.contains(node));
  app.nodes.navigationRoot.contains = node => targets.includes(node);
}

async function startCamera() {
  const api = estimator();
  const app = await appHarness(api);
  const oldPerformance = globalThis.performance;
  let now = 0;
  globalThis.performance = { now: () => now };
  await app.nodes.startCamera.click();
  for (let i = 0; i < 27; i++) app.nodes.calibrationStage.children[0].emit('click', { isTrusted: true, detail: 1 });
  const emit = (points, step = 33) => {
    for (const point of points) { api.emit(point); now += step; }
  };
  return { app, emit, restore() { app.restore(); globalThis.performance = oldPerformance; } };
}

function confirmations(node) {
  let count = 0;
  const original = node.click.bind(node);
  node.click = () => { count++; return original(); };
  return () => count;
}

test('camera jitter around a control is stabilized enough to confirm it without assist', async () => {
  const camera = await startCamera();
  try {
    const { app, emit } = camera;
    layout(app, { composeButton: [100, 100, 100, 50] });
    const count = confirmations(app.nodes.composeButton);
    app.nodes.assistOff.click();
    // Raw samples alternate 20 px outside the left and right edges of Compose.
    emit(Array.from({ length: 50 }, (_, i) => ({ x: i % 2 ? 80 : 220, y: 125 })));
    assert.equal(count(), 1, 'smoothed gaze settles inside and confirms once');
  } finally {
    camera.restore();
  }
});

test('a fixation just outside a control is assisted, outlined, and confirms only after the hold', async () => {
  const camera = await startCamera();
  try {
    const { app, emit } = camera;
    layout(app, { composeButton: [100, 100, 100, 50] });
    const count = confirmations(app.nodes.composeButton);
    emit(Array.from({ length: 10 }, () => ({ x: 150, y: 180 })));
    assert.equal(app.nodes.composeButton.classList.contains('gaze-assisted'), true);
    assert.equal(count(), 0, 'assist highlights but does not activate early');
    emit(Array.from({ length: 30 }, () => ({ x: 150, y: 180 })));
    assert.equal(count(), 1);
    app.nodes.assistOff.click();
    emit([{ x: 600, y: 600 }], 300);
    emit(Array.from({ length: 40 }, () => ({ x: 150, y: 180 })));
    assert.equal(count(), 1, 'turning assist off requires a direct hit');
  } finally {
    camera.restore();
  }
});

test('equidistant controls abstain and mark the cursor ambiguous', async () => {
  const camera = await startCamera();
  try {
    const { app, emit } = camera;
    layout(app, { composeButton: [100, 100, 100, 50], searchButton: [100, 190, 100, 50] });
    const compose = confirmations(app.nodes.composeButton);
    const search = confirmations(app.nodes.searchButton);
    emit(Array.from({ length: 60 }, () => ({ x: 150, y: 170 })));
    assert.equal(compose() + search(), 0);
    assert.equal(app.nodes.gazeCursor.classList.contains('ambiguous'), true);
  } finally {
    camera.restore();
  }
});

test('paused assist only reaches Resume and Stop, never a closer page control', async () => {
  const camera = await startCamera();
  try {
    const { app, emit } = camera;
    layout(app, {
      pauseTracking: [100, 10, 100, 50],
      recalibrate: [210, 10, 100, 50],
      composeButton: [100, 200, 100, 50],
    });
    app.window.emit('keydown', { key: 'Escape' });
    assert.equal(app.nodes.pauseTracking.textContent, 'Resume tracking');
    const recalibrations = confirmations(app.nodes.recalibrate);
    // 5 px from Recalibrate but 15 px from Resume: only the safety control is eligible.
    emit(Array.from({ length: 60 }, () => ({ x: 205, y: 70 })));
    assert.equal(recalibrations(), 0);
    assert.equal(app.nodes.pauseTracking.textContent, 'Pause tracking', 'nearby Resume confirmed');
  } finally {
    camera.restore();
  }
});
