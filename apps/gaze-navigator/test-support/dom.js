export function element() {
  const classes = new Set();
  const listeners = new Map();
  return {
    style: {}, children: [], textContent: '', disabled: false, value: '', dataset: {},
    classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    emit(name, event = {}) { return listeners.get(name)?.(event); },
    click() { return this.emit('click'); },
    focus() {}, setAttribute() {},
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    remove() {},
    contains(target) { return this.children.includes(target); },
    closest() { return this; },
    getBoundingClientRect() { return { left: 10, top: 20, width: 400, height: 400 }; },
  };
}

export async function appHarness(api) {
  const ids = ['startCamera', 'simulate', 'recalibrate', 'status', 'calibration', 'calibrationStage', 'playground', 'result', 'gazeCursor', 'dwellFill', 'messageList', 'messageDetail', 'searchInput', 'composer', 'draftSubject', 'draftBody', 'draftList', 'saveDraft', 'cancelDraft', 'searchButton', 'scrollButton', 'selectButton', 'composeButton', 'pauseTracking', 'stopTracking', 'checkAccuracy', 'accuracyPanel', 'accuracyStage', 'accuracyDot', 'accuracyResult', 'accuracyData', 'cancelAccuracy', 'textKeyboard', 'keyboardKeys', 'keyboardTitle', 'keyboardCaps', 'closeKeyboard', 'editSearch', 'editSubject', 'editBody', 'keyboardPreview', 'webgazerVideoFeed'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  for (const id of ['calibration', 'playground', 'accuracyPanel', 'composer', 'textKeyboard']) nodes[id].classList.add('hidden');
  nodes.stopTracking.disabled = true;
  const document = element();
  document.documentElement = element();
  document.head = element();
  document.querySelector = selector => nodes[selector.slice(1)];
  document.getElementById = id => nodes[id];
  document.createElement = element;
  document.elementFromPoint = () => nodes.composeButton;
  const window = element();
  window.webgazer = api;
  window.setTimeout = () => 1;
  window.clearTimeout = () => {};
  window.requestAnimationFrame = () => 1;
  window.cancelAnimationFrame = () => {};
  const old = { document: globalThis.document, window: globalThis.window };
  globalThis.document = document;
  globalThis.window = window;
  await import(`../src/app.js?test=${Math.random()}`);
  return { nodes, document, window, restore() { globalThis.document = old.document; globalThis.window = old.window; } };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function estimator() {
  let listener;
  let samples = [];
  return {
    begin: async () => {},
    setGazeListener(callback) { listener = callback; },
    clearGazeListener() { listener = null; },
    emit(point) { listener?.(point); },
    saveDataAcrossSessions() {}, showPredictionPoints() {}, removeMouseEventListeners() {}, end() {},
    getRegression: () => [{ init() { samples = []; }, getData: () => samples }],
    recordScreenPosition(x, y) { samples.push([x, y]); },
  };
}
