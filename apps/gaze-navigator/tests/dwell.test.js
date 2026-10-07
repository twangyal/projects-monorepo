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

test('changing confirmation timing retires partial progress and preserves confirmed latches', () => {
  const dwell = createDwellTracker();
  for (let now = 0; now <= 800; now += 100) dwell.update('compose', now);
  assert.equal(dwell.setDwellMs(1500), true);
  assert.equal(dwell.update('compose', 900).progress, 0);
  for (let now = 1000; now < 2400; now += 100) assert.equal(dwell.update('compose', now).activated, null);
  assert.equal(dwell.update('compose', 2400).activated, 'compose');
  dwell.setDwellMs(900);
  for (let now = 2500; now <= 3600; now += 100) assert.equal(dwell.update('compose', now).activated, null);
  dwell.update(null, 3700);
  for (let now = 3800; now < 4700; now += 100) assert.equal(dwell.update('compose', now).activated, null);
  assert.equal(dwell.update('compose', 4700).activated, 'compose');
});

test('unchanged or invalid timing does not reset progress; slow holds still reject sample gaps', () => {
  const dwell = createDwellTracker();
  for (let now = 0; now <= 800; now += 100) dwell.update('compose', now);
  assert.equal(dwell.setDwellMs(900), false);
  for (const value of [0, -1, NaN, Infinity, '1500', 901]) assert.throws(() => dwell.setDwellMs(value), RangeError);
  assert.equal(dwell.update('compose', 900).activated, 'compose');
  dwell.update(null, 1000);
  dwell.setDwellMs(2500);
  for (let now = 1100; now <= 3500; now += 100) assert.equal(dwell.update('compose', now).activated, null);
  assert.equal(dwell.update('compose', 4000).progress, 0);
  for (let now = 4100; now < 6500; now += 100) assert.equal(dwell.update('compose', now).activated, null);
  assert.equal(dwell.update('compose', 6500).activated, 'compose');
});
