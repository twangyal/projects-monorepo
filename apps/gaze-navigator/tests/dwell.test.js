import test from 'node:test';
import assert from 'node:assert/strict';
import { createDwellTracker } from '../src/dwell.js';

test('requires continuous residence before confirming exactly once', () => {
  const dwell = createDwellTracker();
  assert.equal(dwell.update('compose', 0).progress, 0);
  for (let time = 100; time <= 800; time += 100) assert.equal(dwell.update('compose', time).activated, null);
  assert.equal(dwell.update('compose', 900).activated, 'compose');
  assert.equal(dwell.update('compose', 3000).activated, null);
  dwell.update(null, 3001);
  dwell.update('compose', 3002);
  for (let time = 3102; time <= 3802; time += 100) dwell.update('compose', time);
  assert.equal(dwell.update('compose', 3902).activated, 'compose');
});

test('switching targets and losing gaze restart dwell', () => {
  const dwell = createDwellTracker();
  dwell.update('compose', 0);
  assert.equal(dwell.update('search', 800).progress, 0);
  assert.equal(dwell.update('search', 900).activated, null);
  dwell.update(null, 1000);
  assert.equal(dwell.update('search', 1100).progress, 0);
});

test('a gap in samples cannot count as continuous gaze', () => {
  const dwell = createDwellTracker();
  dwell.update('compose', 0);
  assert.equal(dwell.update('compose', 2000).activated, null);
  for (let time = 2100; time <= 2900; time += 100) dwell.update('compose', time);
  assert.equal(dwell.update('compose', 3000).activated, null);
});

test('reset clears progress and permits a fresh selection', () => {
  const dwell = createDwellTracker();
  dwell.update('compose', 0);
  dwell.reset();
  assert.equal(dwell.update('compose', 899).progress, 0);
});

test('layout reset can preserve confirmation until the user leaves', () => {
  const dwell = createDwellTracker();
  for (let time = 0; time <= 900; time += 100) dwell.update('compose', time);
  dwell.reset({ preserveConfirmation: true });
  for (let time = 1000; time <= 2500; time += 100) {
    assert.equal(dwell.update('compose', time).activated, null);
  }
  dwell.update(null, 2600);
  dwell.update('compose', 2700);
  for (let time = 2800; time < 3600; time += 100) dwell.update('compose', time);
  assert.equal(dwell.update('compose', 3600).activated, 'compose');
});
