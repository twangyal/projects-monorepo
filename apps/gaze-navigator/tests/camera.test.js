import test from 'node:test';
import assert from 'node:assert/strict';

function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    style: {}, children: [], textContent: '', disabled: false, value: '', dataset: {},
    focus() { this.focused = true; },
    click() { this.emit('click'); },
    scrollBy(options) { this.lastScroll = options.top; },
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    emit: (name, event = {}) => listeners.get(name)?.(event),
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    setAttribute() {},
    contains(target) { return this.children.includes(target); },
    closest() { return this; },
  };
}

test('camera stop releases tracking and failed startup permits retry', async () => {
  const ids = ['startCamera', 'simulate', 'recalibrate', 'status', 'calibration', 'calibrationStage', 'playground', 'result', 'gazeCursor', 'dwellFill', 'messageList', 'messageDetail', 'searchInput', 'composer', 'draftSubject', 'draftBody', 'draftList', 'saveDraft', 'cancelDraft', 'searchButton', 'scrollButton', 'selectButton', 'composeButton', 'pauseTracking', 'stopTracking', 'checkAccuracy', 'accuracyPanel', 'accuracyStage', 'accuracyDot', 'accuracyResult', 'accuracyData', 'cancelAccuracy'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const doc = element();
  doc.documentElement = element();
  doc.querySelector = selector => nodes[selector.slice(1)];
  doc.createElement = element;
  doc.elementFromPoint = () => nodes.composeButton;
  nodes.playground.append(nodes.composeButton);
  const win = element();
  let listener;
  let ended = 0;
  let cleared = 0;
  let fail = false;
  win.webgazer = {
    setGazeListener: callback => { listener = callback; },
    begin: async () => { if (fail) throw new Error('denied'); },
    clearGazeListener: () => { cleared++; },
    end: () => { ended++; },
  };
  win.setTimeout = () => {};
  win.requestAnimationFrame = () => 1;
  win.cancelAnimationFrame = () => {};
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  const oldError = console.error;
  globalThis.document = doc;
  globalThis.window = win;
  console.error = () => {};
  try {
    await import('../src/app.js');
    await nodes.startCamera.emit('click');
    assert.equal(nodes.stopTracking.disabled, false);
    for (let i = 0; i < 27; i++) nodes.calibrationStage.children[0].emit('click');
    listener({ x: 100, y: 100 });
    assert.equal(nodes.gazeCursor.classList.contains('visible'), true);
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
    for (let i = 0; i < 27; i++) nodes.calibrationStage.children[0].emit('click');
    listener({ x: 100, y: 100 });
    assert.equal(nodes.gazeCursor.classList.contains('visible'), false);
    nodes.stopTracking.emit('click');
    fail = true;
    await nodes.startCamera.emit('click');
    assert.equal(ended, 2);
    assert.equal(nodes.startCamera.disabled, false);
    assert.equal(nodes.simulate.disabled, false);
    assert.match(nodes.status.textContent, /could not start/);
    fail = false;
    await nodes.startCamera.emit('click');
    assert.equal(nodes.stopTracking.disabled, false);
    win.emit('beforeunload');
    assert.equal(ended, 3);
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
    console.error = oldError;
  }
});
