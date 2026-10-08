import test from 'node:test';
import assert from 'node:assert/strict';
import { createGazeFilter } from '../src/gaze-filter.js';

function spread(points) {
  const xs = points.map(point => point.x);
  return Math.max(...xs) - Math.min(...xs);
}

test('fixation jitter is reduced while the first sample passes through unchanged', () => {
  const filter = createGazeFilter();
  assert.deepEqual(filter.filter(500, 300, 0), { x: 500, y: 300 });
  const raw = [];
  const smoothed = [];
  for (let i = 1; i <= 60; i++) {
    const x = 500 + (i % 2 ? 40 : -40);
    raw.push({ x });
    smoothed.push(filter.filter(x, 300, i * 33));
  }
  assert.ok(spread(smoothed.slice(10)) < spread(raw) / 4, 'alternating 80 px jitter shrinks by at least 4x');
  for (const point of smoothed) assert.ok(Math.abs(point.y - 300) < 1e-9);
});

test('a large gaze shift converges quickly instead of lagging behind', () => {
  const filter = createGazeFilter();
  for (let i = 0; i <= 10; i++) filter.filter(100, 100, i * 33);
  let point;
  for (let i = 11; i <= 20; i++) point = filter.filter(900, 100, i * 33);
  assert.ok(point.x > 850, `after ~330 ms the estimate is within 50 px of the new fixation (${point.x})`);
});

test('gaps, clock reversal and invalid samples restart from the raw sample', () => {
  const filter = createGazeFilter({ maxGapMs: 250 });
  filter.filter(100, 100, 0);
  filter.filter(120, 100, 33);
  assert.deepEqual(filter.filter(800, 600, 400), { x: 800, y: 600 }, 'gap over 250 ms');
  assert.deepEqual(filter.filter(10, 20, 300), { x: 10, y: 20 }, 'clock moved backwards');
  assert.equal(filter.filter(NaN, 20, 330), null);
  assert.deepEqual(filter.filter(50, 60, 360), { x: 50, y: 60 }, 'invalid input resets');
  const repeated = filter.filter(70, 60, 360);
  assert.deepEqual(repeated, { x: 50, y: 60 }, 'duplicate timestamps do not divide by zero');
  filter.reset();
  assert.deepEqual(filter.filter(5, 5, 370), { x: 5, y: 5 });
});
