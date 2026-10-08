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
    classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)), contains: value => classes.has(value), toggle: (value, on) => (on ? classes.add(value) : classes.delete(value)) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    emit: (name, event = {}) => listeners.get(name)?.(event),
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    setAttribute() {},
    contains(target) { return this.children.includes(target); },
    querySelectorAll() { return []; },
    closest() { return this; },
  };
}

test('stationary pointer confirms once, resets on leave, and ignores calibration', async () => {
  const ids = ['startCamera', 'simulate', 'recalibrate', 'status', 'calibration', 'calibrationStage', 'playground', 'result', 'gazeCursor', 'dwellFill', 'messageList', 'messageDetail', 'searchInput', 'composer', 'draftSubject', 'draftBody', 'draftList', 'saveDraft', 'cancelDraft', 'dwellDefault', 'dwellSlow', 'dwellVerySlow', 'dwellDuration', 'assistOff', 'assistStandard', 'assistWide', 'assistDescription', 'newDraft', 'downloadDrafts', 'importDrafts', 'draftBackupFile', 'draftBackupChooser', 'draftReview', 'draftReviewText', 'keepComposer', 'replaceComposer', 'searchButton', 'scrollButton', 'selectButton', 'composeButton', 'pauseTracking', 'stopTracking', 'checkAccuracy', 'accuracyPanel', 'accuracyStage', 'accuracyDot', 'accuracyResult', 'accuracyData', 'downloadAccuracy', 'cancelAccuracy', 'textKeyboard', 'keyboardKeys', 'keyboardTitle', 'keyboardCaps', 'closeKeyboard', 'editSearch', 'editSubject', 'editBody', 'keyboardPreview', 'keyboardUp', 'keyboardDown'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  for (const id of ['navigationRoot', 'trackingControls', 'pageUp', 'pageDown']) nodes[id] = element();
  nodes.playground.classList.add('hidden');
  const target = nodes.composeButton;
  target.textContent = 'Compose';
  nodes.playground.append(target);
  nodes.navigationRoot.append(target);
  const doc = element();
  doc.documentElement = element();
  doc.querySelector = selector => nodes[selector.slice(1)];
  doc.createElement = element;
  doc.elementFromPoint = () => target;
  doc.hidden = false;
  const win = element();
  let frame = () => {};
  let confirmations = 0;
  win.requestAnimationFrame = callback => { frame = callback; return 1; };
  win.cancelAnimationFrame = () => { frame = null; };
  win.setTimeout = () => { confirmations += 1; };
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  globalThis.document = doc;
  globalThis.window = win;
  try {
    await import('../src/app.js');
    assert.equal(nodes.messageList.children.length, 4);
    assert.equal(nodes.keyboardKeys.children.length, 42);
    nodes.editSearch.emit('click');
    nodes.keyboardKeys.children.find(key => key.textContent === 'c').emit('click');
    nodes.keyboardKeys.children.find(key => key.textContent === 'a').emit('click');
    assert.equal(nodes.searchInput.value, 'ca');
    assert.equal(nodes.keyboardPreview.textContent, 'ca');
    nodes.keyboardKeys.children.find(key => key.textContent === 'Backspace').emit('click');
    assert.equal(nodes.searchInput.value, 'c');
    nodes.closeKeyboard.emit('click');
    assert.equal(nodes.textKeyboard.classList.contains('hidden'), true);
    nodes.composeButton.emit('click');
    assert.equal(nodes.composer.classList.contains('hidden'), false);
    nodes.editSubject.emit('click');
    assert.equal(nodes.textKeyboard.classList.contains('hidden'), false);
    nodes.draftSubject.value = 'Test subject';
    nodes.draftBody.value = 'Test body';
    nodes.saveDraft.emit('click');
    assert.equal(nodes.draftList.children.length, 1);
    assert.equal(nodes.textKeyboard.classList.contains('hidden'), true);
    assert.match(nodes.draftList.children[0].textContent, /Test subject/);
    nodes.searchInput.value = 'calibration';
    nodes.searchButton.emit('click');
    assert.equal(nodes.messageList.children.length, 1);
    nodes.selectButton.emit('click');
    assert.match(nodes.messageDetail.textContent, /calibration/i);
    nodes.scrollButton.emit('click');
    assert.equal(nodes.messageList.lastScroll, 220);
    nodes.simulate.emit('click');
    doc.emit('pointermove', { clientX: 100, clientY: 100 });
    for (let now = 0; now <= 1000; now += 100) frame(now);
    assert.equal(confirmations, 0);
    for (let click = 0; click < 27; click++) nodes.calibrationStage.children[0].emit('click');
    doc.emit('pointermove', { clientX: 100, clientY: 100 });
    for (let now = 1100; now <= 4000; now += 100) frame(now);
    assert.equal(confirmations, 1);
    assert.match(nodes.result.textContent, /practice draft/);
    assert.equal(nodes.composer.classList.contains('hidden'), false);
    assert.equal(target.classList.contains('gaze-focus'), false);
    doc.documentElement.emit('pointerleave');
    for (let now = 4100; now <= 5100; now += 100) frame(now);
    assert.equal(confirmations, 1);
    doc.emit('pointermove', { clientX: 100, clientY: 100 });
    for (let now = 5200; now <= 6100; now += 100) frame(now);
    assert.equal(confirmations, 2);
    doc.hidden = true;
    doc.emit('visibilitychange');
    for (let now = 6200; now <= 7200; now += 100) frame(now);
    assert.equal(confirmations, 2);
    doc.hidden = false;
    nodes.pauseTracking.emit('click');
    doc.emit('pointermove', { clientX: 100, clientY: 100 });
    for (let now = 7300; now <= 8300; now += 100) frame(now);
    assert.equal(confirmations, 2);
    nodes.pauseTracking.emit('click');
    doc.emit('pointermove', { clientX: 100, clientY: 100 });
    for (let now = 8400; now <= 9300; now += 100) frame(now);
    assert.equal(confirmations, 3);
    nodes.stopTracking.emit('click');
    assert.equal(nodes.simulate.disabled, false);
    assert.equal(nodes.startCamera.disabled, false);
    assert.equal(frame, null);
    nodes.simulate.emit('click');
    assert.notEqual(frame, null);
    assert.equal(nodes.playground.classList.contains('hidden'), true);
    win.emit('beforeunload');
    assert.equal(frame, null);
  } finally {
    globalThis.document = oldDocument;
    globalThis.window = oldWindow;
  }
});
