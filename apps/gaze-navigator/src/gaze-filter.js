// Adaptive One Euro smoothing: strong at fixation, light during fast gaze shifts.
// See Casiez, Roussel and Vogel, "1€ Filter" (CHI 2012). Speed is shared by both
// axes so a diagonal saccade is not smoothed differently horizontally and vertically.
const TAU = 2 * Math.PI;

function smoothing(cutoffHz, seconds) {
  const rate = TAU * cutoffHz * seconds;
  return rate / (rate + 1);
}

export function createGazeFilter({ minCutoff = 1, beta = 0.005, derivativeCutoff = 1, maxGapMs = 250 } = {}) {
  let last = null;

  function reset() {
    last = null;
  }

  function filter(x, y, now) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(now)) {
      reset();
      return null;
    }
    if (last && now === last.at) return { x: last.x, y: last.y };
    if (!last || now < last.at || now - last.at > maxGapMs) {
      last = { x, y, dx: 0, dy: 0, at: now };
      return { x, y };
    }
    const seconds = (now - last.at) / 1000;
    const derivative = smoothing(derivativeCutoff, seconds);
    const dx = derivative * ((x - last.x) / seconds) + (1 - derivative) * last.dx;
    const dy = derivative * ((y - last.y) / seconds) + (1 - derivative) * last.dy;
    const position = smoothing(minCutoff + beta * Math.hypot(dx, dy), seconds);
    last = {
      x: position * x + (1 - position) * last.x,
      y: position * y + (1 - position) * last.y,
      dx, dy, at: now,
    };
    return { x: last.x, y: last.y };
  }

  return { filter, reset };
}
