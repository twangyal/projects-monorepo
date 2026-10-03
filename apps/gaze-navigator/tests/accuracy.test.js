import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccuracyCheck } from '../src/accuracy.js';

test('excludes settling samples and measures held-out points in pixels', () => {
  const check = createAccuracyCheck([{ x: 100, y: 100 }, { x: 200, y: 200 }], 0);
  check.update({ x: 900, y: 900 }, 100);
  check.update({ x: 103, y: 104 }, 500);
  check.update({ x: 100, y: 100 }, 600);
  assert.equal(check.update(null, 2000).index, 1);
  check.update({ x: 206, y: 208 }, 2500);
  const done = check.update(null, 4000);
  assert.equal(done.done, true);
  assert.equal(done.report.samples, 3);
  assert.equal(done.report.meanErrorPx, 5);
  assert.equal(done.report.medianErrorPx, 5);
  assert.equal(done.report.p90ErrorPx, 10);
  assert.equal(done.report.meanSampleIntervalMs, 100);
  assert.equal(done.report.measuredTargets, 2);
});

test('empty and partial checks explicitly report unmeasured targets', () => {
  const check = createAccuracyCheck([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0);
  check.update({ x: NaN, y: 0 }, 700);
  const report = check.update(null, 4000).report;
  assert.equal(report.meanErrorPx, null);
  assert.equal(report.meanSampleIntervalMs, null);
  assert.equal(report.measuredTargets, 0);
  assert.equal(report.targets.length, 2);
  assert.equal(report.targets[0].samples, 0);
});

test('invalid clocks are ignored and cannot crash or add measurements', () => {
  const check = createAccuracyCheck([{ x: 0, y: 0 }], 0);
  assert.doesNotThrow(() => check.update({ x: 0, y: 0 }, NaN));
  check.update({ x: 0, y: 0 }, 700);
  check.update({ x: 100, y: 100 }, 600);
  assert.equal(check.update(null, 2000).report.samples, 1);
});
