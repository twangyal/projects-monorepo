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

import { setupAccuracyCheck } from '../src/accuracy-view.js';

test('timed accuracy view completes without samples and can cancel', () => {
  const ids = ['accuracyPanel', 'accuracyStage', 'accuracyDot', 'accuracyResult', 'accuracyData', 'cancelAccuracy'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes.accuracyStage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  const doc = { querySelector: selector => nodes[selector.slice(1)] };
  let frame;
  let reset = 0;
  const win = { requestAnimationFrame: callback => { frame = callback; return 1; }, cancelAnimationFrame: () => { frame = null; } };
  const check = setupAccuracyCheck(doc, win, () => { reset++; });
  check.start('simulation');
  assert.equal(check.active, true);
  frame(performance.now() + 11000);
  assert.equal(check.active, false);
  assert.equal(reset, 1);
  assert.match(nodes.accuracyResult.textContent, /SIMULATION/);
  assert.match(nodes.accuracyResult.textContent, /0\/5 targets/);
  assert.equal(JSON.parse(nodes.accuracyData.textContent).meanErrorPx, null);
  check.start('camera');
  nodes.cancelAccuracy.emit('click');
  assert.equal(check.active, false);
  assert.equal(frame, null);
  assert.match(nodes.accuracyResult.textContent, /cancelled/);
});
