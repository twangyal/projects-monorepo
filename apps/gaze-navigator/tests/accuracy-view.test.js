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

test('timed accuracy view downloads contextualized missing measurements and retires cancelled reports', async () => {
  const ids = ['accuracyPanel', 'accuracyStage', 'accuracyDot', 'accuracyResult', 'accuracyData', 'downloadAccuracy', 'cancelAccuracy'];
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  nodes.accuracyStage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  let link, blob, revoked;
  const doc = { querySelector: selector => nodes[selector.slice(1)],createElement:()=>{link=element();return link;} };
  let frame;
  let reset = 0;
  const win = { innerWidth:800,innerHeight:600,devicePixelRatio:2,Blob,
    URL:{createObjectURL:value=>{blob=value;return 'blob:receipt';},revokeObjectURL:value=>{revoked=value;}},
    setTimeout:callback=>callback(),
    requestAnimationFrame: callback => { frame = callback; return 1; }, cancelAnimationFrame: () => { frame = null; } };
  const check = setupAccuracyCheck(doc, win, () => { reset++; });
  check.start('simulation');
  assert.equal(check.active, true);
  frame(performance.now() + 11000);
  assert.equal(check.active, false);
  assert.equal(reset, 1);
  assert.match(nodes.accuracyResult.textContent, /SIMULATION/);
  assert.match(nodes.accuracyResult.textContent, /0\/5 targets/);
  const report=JSON.parse(nodes.accuracyData.textContent);
  assert.equal(report.meanErrorPx, null);
  assert.equal(report.meanSampleIntervalMs, null);
  assert.equal(report.format,'gaze-accuracy-report');
  assert.deepEqual(report.viewport,{width:800,height:600,devicePixelRatio:2});
  assert.deepEqual(report.measurementArea,{left:0,top:0,width:400,height:400});
  assert.equal(report.targets.length,5);
  assert.equal(report.protocol.settleMs,500);
  assert(Number.isFinite(Date.parse(report.startedAt)));
  assert(Number.isFinite(Date.parse(report.completedAt)));
  assert.equal(nodes.downloadAccuracy.disabled,false);
  nodes.downloadAccuracy.click();
  assert.equal(link.download,'gaze-accuracy-simulation.json');
  assert.deepEqual(JSON.parse(await blob.text()),report);
  assert.equal(revoked,'blob:receipt');
  check.start('camera');
  assert.equal(nodes.downloadAccuracy.disabled,true);
  assert.equal(nodes.accuracyData.textContent,'');
  nodes.cancelAccuracy.emit('click');
  assert.equal(check.active, false);
  assert.equal(frame, null);
  assert.match(nodes.accuracyResult.textContent, /cancelled/);
  assert.equal(nodes.downloadAccuracy.disabled,true);
  link=null;nodes.downloadAccuracy.click();assert.equal(link,null);
  check.start('camera');frame(performance.now()+11000);
  nodes.downloadAccuracy.click();
  const cameraReport=JSON.parse(await blob.text());
  assert.equal(cameraReport.mode,'camera');
  assert.equal(link.download,'gaze-accuracy-camera.json');
  assert.match(cameraReport.limitations.join(' '),/experimental/);
  assert.equal(cameraReport.meanErrorPx,null);
});
