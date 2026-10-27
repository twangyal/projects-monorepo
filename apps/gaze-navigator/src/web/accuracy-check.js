// After calibration, a short check measures how far the smoothed gaze lands from dots the calibration did not use,
// so the context circle can be sized to cover where this person's gaze actually falls.

// Held out from the nine calibration dots (10/50/90%), as percentages of the viewport.
export const CHECK_POINTS = [[30, 30], [70, 30], [70, 70], [30, 70]];

// Shows each dot for `settleMs` while the eyes move to it, then records gaze for `measureMs`. `sample(x, y)` takes
// the smoothed gaze in viewport pixels. `done` resolves with the distances measured, or `{ cancelled: true }`.
export function runAccuracyCheck({ window, dot, points = CHECK_POINTS, settleMs = 600, measureMs = 1400, onProgress = () => {} }) {
  const errors = points.map(() => []);
  let measuring = null, timer = null, settled = false, finish;
  const done = new Promise(resolve => { finish = resolve; });

  function end(result) {
    if (settled) return;
    settled = true;
    window.clearTimeout(timer);
    measuring = null;
    dot.className = 'calibration-dot hidden';
    finish(result);
  }

  function show(index) {
    if (index >= points.length) {
      const all = errors.flat().sort((a, b) => a - b);
      const at = fraction => Math.round(all[Math.max(0, Math.ceil(all.length * fraction) - 1)]);
      end({ cancelled: false, samples: all.length, measured: errors.filter(list => list.length).length, total: points.length,
        medianPx: all.length ? at(0.5) : null, p90Px: all.length ? at(0.9) : null });
      return;
    }
    const [px, py] = points[index];
    const x = (px / 100) * window.innerWidth, y = (py / 100) * window.innerHeight;
    Object.assign(dot.style, { left: `${x}px`, top: `${y}px` });
    dot.className = 'calibration-dot checking';
    measuring = null;
    onProgress({ point: index + 1, total: points.length });
    timer = window.setTimeout(() => {
      measuring = { index, x, y };
      timer = window.setTimeout(() => show(index + 1), measureMs);
    }, settleMs);
  }

  show(0);
  return {
    done,
    sample(x, y) {
      if (measuring && Number.isFinite(x) && Number.isFinite(y)) errors[measuring.index].push(Math.hypot(x - measuring.x, y - measuring.y));
    },
    cancel() { end({ cancelled: true }); },
  };
}

// The smallest circle (of `radii`, name to radius) that holds 9 in 10 gaze samples, with `low` when even the largest
// does not; null when too little gaze was seen (fewer than three dots or eight samples) to say.
export function recommendedSize(report, radii) {
  if (!report || report.cancelled || report.measured < 3 || report.samples < 8) return null;
  const sizes = Object.entries(radii).sort((a, b) => a[1] - b[1]);
  const fits = sizes.find(([, radius]) => radius >= report.p90Px);
  return { size: (fits ?? sizes.at(-1))[0], low: !fits };
}
