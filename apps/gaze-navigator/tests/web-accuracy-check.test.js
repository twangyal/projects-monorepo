import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_POINTS, recommendedSize, runAccuracyCheck } from '../src/web/accuracy-check.js';

const RADII = { small: 60, medium: 90, large: 130 };

function manualClock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    window: {
      innerWidth: 1000, innerHeight: 500,
      setTimeout(callback, ms) { timers.set(++id, { callback, at: now + ms }); return id; },
      clearTimeout(timer) { timers.delete(timer); },
    },
    // Runs due timers in order; `each(now)` is called every 50 ms of the way, as gaze samples arrive.
    advance(ms, each = () => {}) {
      const end = now + ms;
      while (now < end) {
        const step = Math.min(end, now + 50);
        for (;;) {
          const due = [...timers].filter(([, timer]) => timer.at <= step).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          timers.delete(due[0]);
          now = due[1].at;
          due[1].callback();
        }
        now = step;
        each(now);
      }
    },
  };
}

test('the check shows four held-out dots and measures the gaze only after it settles on each', async () => {
  const clock = manualClock();
  const dot = { style: {}, className: '' };
  const progress = [];
  const check = runAccuracyCheck({ window: clock.window, dot, onProgress: event => progress.push(event) });
  assert.equal(CHECK_POINTS.length, 4);
  assert.deepEqual([dot.style.left, dot.style.top, dot.className], ['300px', '150px', 'calibration-dot checking']);
  // Gaze 40 px right of each dot while measuring; far away while the eyes are still moving to it.
  const shown = () => ({ x: parseFloat(dot.style.left), y: parseFloat(dot.style.top) });
  let phase = 0;
  clock.advance(8000, now => {
    phase = now % 2000;
    const target = shown();
    if (phase > 600) check.sample(target.x + 40, target.y);
    else check.sample(target.x + 400, target.y);
  });
  const report = await check.done;
  assert.deepEqual(progress.map(event => event.point), [1, 2, 3, 4]);
  assert.equal(report.measured, 4);
  assert.ok(report.samples >= 100, `${report.samples} samples`);
  assert.deepEqual([report.medianPx, report.p90Px], [40, 40], 'nothing from the settling time is counted');
  assert.equal(dot.className, 'calibration-dot hidden');
  assert.deepEqual(recommendedSize(report, RADII), { size: 'small', low: false });
});

test('the circle covers 9 in 10 gaze samples, or is the largest with a warning when none does', () => {
  const report = (p90Px, measured = 4, samples = 100) => ({ cancelled: false, measured, samples, p90Px });
  assert.deepEqual(recommendedSize(report(60), RADII), { size: 'small', low: false });
  assert.deepEqual(recommendedSize(report(61), RADII), { size: 'medium', low: false });
  assert.deepEqual(recommendedSize(report(120), RADII), { size: 'large', low: false });
  assert.deepEqual(recommendedSize(report(200), RADII), { size: 'large', low: true });
  // Too little gaze seen to say: fewer than three dots or eight samples, or a cancelled check.
  assert.equal(recommendedSize(report(40, 2), RADII), null);
  assert.equal(recommendedSize(report(40, 4, 7), RADII), null);
  assert.equal(recommendedSize({ cancelled: true }, RADII), null);
});

test('cancelling the check hides its dot and stops measuring', async () => {
  const clock = manualClock();
  const dot = { style: {}, className: '' };
  const check = runAccuracyCheck({ window: clock.window, dot });
  clock.advance(700);
  check.sample(10, 10);
  check.cancel();
  assert.deepEqual(await check.done, { cancelled: true });
  assert.equal(dot.className, 'calibration-dot hidden');
  clock.advance(8000);
  assert.equal(dot.className, 'calibration-dot hidden', 'no later dot appears');
});
