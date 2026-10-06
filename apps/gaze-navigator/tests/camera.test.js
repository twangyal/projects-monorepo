import test from 'node:test';
import assert from 'node:assert/strict';

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    style: {}, children: [], textContent: '', disabled: false, value: '', dataset: {},
    focus() { this.focused = true; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    click() { this.emit('click'); },
    scrollBy(options) { this.lastScroll = options.top; },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    emit: (name, event = {}) => listeners.get(name)?.(event),
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    remove() {},
    setAttribute() {},
    contains(target) { return this.children.includes(target); },
    closest() { return this; },
  };
}

test('camera stop releases tracking and failed startup permits retry', async () => {
  const ids = ['startCamera', 'simulate', 'recalibrate', 'status', 'calibration', 'calibrationStage', 'playground', 'result', 'gazeCursor', 'dwellFill', 'messageList', 'messageDetail', 'searchInput', 'composer', 'draftSubject', 'draftBody', 'draftList', 'saveDraft', 'cancelDraft', 'searchButton', 'scrollButton', 'selectButton', 'composeButton', 'pauseTracking', 'stopTracking', 'checkAccuracy', 'accuracyPanel', 'accuracyStage', 'accuracyDot', 'accuracyResult', 'accuracyData', 'downloadAccuracy', 'cancelAccuracy', 'textKeyboard', 'keyboardKeys', 'keyboardTitle', 'keyboardCaps', 'closeKeyboard', 'editSearch', 'editSubject', 'editBody', 'keyboardPreview', 'keyboardUp', 'keyboardDown'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  for (const id of ['navigationRoot', 'trackingControls', 'pageUp', 'pageDown']) nodes[id] = element();
  const doc = element();
  doc.documentElement = element();
  doc.querySelector = selector => nodes[selector.slice(1)];
  doc.createElement = element;
  doc.elementFromPoint = () => nodes.composeButton;
  nodes.playground.append(nodes.composeButton);
  nodes.navigationRoot.append(nodes.composeButton);
  const win = element();
  let listener;
  let ended = 0;
  let cleared = 0;
  let fail = false;
  let persistence = true;
  let implicitTraining = true;
  let predictionPoints = true;
  let faceVisible = true;
  let samples = [[1, 2]];
  let training = [];
  let resets = 0;
  const physicalClick = { isTrusted: true, detail: 1 };
  const regression = { getData: () => samples, init: () => { resets++; samples = []; } };
  nodes.calibrationStage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  nodes.accuracyStage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  win.webgazer = {
    setGazeListener: callback => { listener = callback; },
    begin: async () => { implicitTraining = true; if (fail) throw new Error('denied'); },
    saveDataAcrossSessions: value => { persistence = value; },
    showPredictionPoints: value => { predictionPoints = value; },
    removeMouseEventListeners: () => { implicitTraining = false; },
    getRegression: () => [regression],
    recordScreenPosition: (x, y, type) => { if (faceVisible) { samples.push([x, y]); training.push([x, y, type]); } },
    clearGazeListener: () => { cleared++; },
    end: () => { ended++; },
  };
  const initialApi = win.webgazer;
  doc.head = { append(script) { win.webgazer = { ...initialApi, params: {} }; script.onload(); } };
  win.clearTimeout = () => {};
  let confirmations = 0;
  let now = 0;
  win.setTimeout = () => { confirmations++; };
  win.requestAnimationFrame = () => 1;
  win.cancelAnimationFrame = () => {};
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldError = console.error;
  const oldPerformance = globalThis.performance;
  globalThis.performance = { now: () => now };
  globalThis.document = doc;
  globalThis.window = win;
  console.error = () => {};
  try {
    await import('../src/app.js');
    await nodes.startCamera.emit('click');
    assert.equal(nodes.stopTracking.disabled, false);
    assert.equal(persistence, false, 'estimator data must stay in this session');
    assert.equal(implicitTraining, false, 'pointer and synthetic clicks must not train');
    assert.equal(predictionPoints, false, 'dependency overlay must not cue held-out measurements');
    assert.equal(samples.length, 0, 'old estimator samples must be cleared');
    nodes.calibrationStage.children[0].getBoundingClientRect = () => ({ left: 10, top: 20, width: 52, height: 52 });
    nodes.calibrationStage.children[0].emit('click');
    nodes.calibrationStage.children[0].emit('click', { isTrusted: true, detail: 0 });
    faceVisible = false;
    nodes.calibrationStage.children[0].emit('click', physicalClick);
    assert.equal(nodes.calibrationStage.children[0].textContent, '1');
    faceVisible = true;
    nodes.calibrationStage.children[0].emit('click', physicalClick);
    assert.deepEqual(training[0], [36, 46, 'click']);
    for (let i = 1; i < 27; i++) {
      nodes.calibrationStage.children[0].getBoundingClientRect = () => ({ left: 10, top: 20, width: 52, height: 52 });
      nodes.calibrationStage.children[0].emit('click', physicalClick);
    }
    const trained = training.length;
    for (now = 0; now <= 3000; now += 100) listener({ x: 100, y: 100 });
    assert.equal(confirmations, 1);
    assert.equal(training.length, trained, 'workspace actions must not train');
    win.emit('scroll');
    for (; now <= 5000; now += 100) listener({ x: 100, y: 100 });
    assert.equal(confirmations, 1);
    assert.equal(nodes.gazeCursor.classList.contains('visible'), true);
    nodes.checkAccuracy.emit('click');
    listener({ x: 100, y: 100 });
    assert.equal(training.length, trained, 'held-out measurements must not train');
    assert.equal(confirmations, 1, 'held-out measurements must not execute actions');
    nodes.cancelAccuracy.emit('click');
    win.emit('resize');
    assert.equal(samples.length, 0, 'resizing must remove old geometry from the estimator');
    assert.equal(nodes.playground.classList.contains('hidden'), true, 'resize must require fresh calibration');
    assert.equal(nodes.checkAccuracy.disabled, true);
    assert.equal(nodes.calibrationStage.children[0].textContent, '1');
    for (let i = 0; i < 5; i++) {
      nodes.calibrationStage.children[0].getBoundingClientRect = () => ({ left: 10, top: 20, width: 52, height: 52 });
      nodes.calibrationStage.children[0].emit('click', physicalClick);
    }
    win.emit('resize');
    assert.equal(nodes.calibrationStage.children[0].textContent, '1', 'partial calibration must restart');
    assert.match(nodes.status.textContent, /point 1 of 9/);
    for (let i = 0; i < 27; i++) {
      nodes.calibrationStage.children[0].getBoundingClientRect = () => ({ left: 10, top: 20, width: 52, height: 52 });
      nodes.calibrationStage.children[0].emit('click', physicalClick);
    }
    assert.equal(nodes.playground.classList.contains('hidden'), false);
    assert.equal(nodes.checkAccuracy.disabled, false);
    nodes.pauseTracking.emit('click');
    listener({ x: 100, y: 100 });
    assert.equal(nodes.gazeCursor.classList.contains('visible'), false);
    nodes.stopTracking.emit('click');
    assert.equal(ended, 1);
    assert.equal(cleared, 1);
    listener({ x: 100, y: 100 });
    assert.equal(nodes.gazeCursor.classList.contains('visible'), false);
    assert.equal(nodes.startCamera.disabled, false);
    nodes.simulate.emit('click');
    for (let i = 0; i < 27; i++) {
      nodes.calibrationStage.children[0].getBoundingClientRect = () => ({ left: 10, top: 20, width: 52, height: 52 });
      nodes.calibrationStage.children[0].emit('click', physicalClick);
    }
    listener({ x: 100, y: 100 });
    assert.equal(nodes.gazeCursor.classList.contains('visible'), false);
    nodes.stopTracking.emit('click');
    const staleListener = listener;
    fail = true;
    await nodes.startCamera.emit('click');
    assert.equal(ended, 2);
    assert.equal(nodes.startCamera.disabled, false);
    assert.equal(nodes.simulate.disabled, false);
    assert.match(nodes.status.textContent, /could not start/);
    fail = false;
    await nodes.startCamera.emit('click');
    assert.equal(nodes.stopTracking.disabled, false);
    for (let i = 0; i < 27; i++) {
      nodes.calibrationStage.children[0].getBoundingClientRect = () => ({ left: 10, top: 20, width: 52, height: 52 });
      nodes.calibrationStage.children[0].emit('click', physicalClick);
    }
    assert.equal(nodes.playground.classList.contains('hidden'), false);
    staleListener({ x: 100, y: 100 });
    assert.equal(nodes.gazeCursor.classList.contains('visible'), false);
    win.emit('beforeunload');
    assert.equal(ended, 3);
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    console.error = oldError;
    globalThis.performance = oldPerformance;
  }
});
