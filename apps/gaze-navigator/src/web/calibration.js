// Hands-free calibration: the user looks at each dot; no clicking is required.
// Samples are kept only when the estimator actually had eye features to learn from.
import { recordCalibrationSample } from '../camera-calibration.js';

export const CALIBRATION_POINTS = [
  [10, 12], [50, 12], [90, 12],
  [10, 50], [50, 50], [90, 50],
  [10, 88], [50, 88], [90, 88],
];

export function runCalibration({ api, window, dot, points = CALIBRATION_POINTS, settleMs = 900, samples = 4, sampleMs = 250,
  minSamples = 2, attempts = 2, minPoints = 7, onProgress = () => {} }) {
  let cancelled = false;
  let pending = null;
  const wait = ms => new Promise((resolve, reject) => {
    if (cancelled) {
      reject(new Error('cancelled'));
      return;
    }
    const timer = window.setTimeout(() => {
      pending = null;
      resolve();
    }, ms);
    pending = { timer, reject };
  });

  async function calibratePoint([px, py], index) {
    const x = (px / 100) * window.innerWidth;
    const y = (py / 100) * window.innerHeight;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      Object.assign(dot.style, { left: `${x}px`, top: `${y}px` });
      dot.className = 'calibration-dot settling';
      onProgress({ point: index + 1, total: points.length, attempt, phase: 'settle' });
      await wait(settleMs);
      dot.className = 'calibration-dot sampling';
      let accepted = 0;
      for (let sample = 0; sample < samples; sample++) {
        if (recordCalibrationSample(api, x, y)) accepted++;
        await wait(sampleMs);
      }
      if (accepted >= minSamples) return true;
      onProgress({ point: index + 1, total: points.length, attempt, phase: 'retry' });
    }
    return false;
  }

  const done = (async () => {
    let calibrated = 0;
    try {
      for (const [index, point] of points.entries()) {
        if (await calibratePoint(point, index)) calibrated++;
      }
    } catch (error) {
      if (cancelled) return { ok: false, cancelled: true, calibrated };
      throw error;
    } finally {
      dot.className = 'calibration-dot hidden';
    }
    return { ok: calibrated >= minPoints, cancelled: false, calibrated, total: points.length };
  })();

  return {
    done,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (pending) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('cancelled'));
        pending = null;
      }
    },
  };
}
