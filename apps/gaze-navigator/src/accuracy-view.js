import { createAccuracyCheck } from './accuracy.js';

export function setupAccuracyCheck(document, window, onReset) {
  const node = id => document.querySelector(`#${id}`);
  const dot = node('accuracyDot');
  const result = node('accuracyResult');
  let check = null;
  let frame = null;
  let bounds;
  let mode;
  let setup;
  let completedReport = null;
  const protocol = { targetMs: 2000, settleMs: 500, targetCount: 5, units: 'CSS pixels' };

  function paint(state) {
    if (state.done) {
      const report = {
        format: 'gaze-accuracy-report', schemaVersion: 1, mode,
        ...setup, completedAt: new Date().toISOString(), protocol: { ...protocol },
        ...state.report,
        limitations: [
          ...(mode === 'simulation' ? ['Pointer simulation is not webcam accuracy.'] : ['Webcam estimates are experimental; this check does not establish assistive-device performance.']),
          'Errors use CSS pixels within this measurement area, not the whole screen.',
          'Sample interval is not end-to-end latency.',
          'Missing samples remain unmeasured; calibration points are not this held-out check.',
          'This report contains aggregates and target coordinates, no camera frames or raw prediction stream.',
        ],
      };
      const display = value => value === null ? 'unavailable' : value.toFixed(1);
      result.textContent = `${mode === 'simulation' ? 'SIMULATION — not webcam accuracy. ' : ''}` +
        `${report.measuredTargets}/5 targets measured; ${report.samples} samples. ` +
        `Mean error: ${display(report.meanErrorPx)} px; median: ${display(report.medianErrorPx)} px; ` +
        `90th percentile: ${display(report.p90ErrorPx)} px. ` +
        `Mean sample interval: ${display(report.meanSampleIntervalMs)} ms (not end-to-end latency).`;
      node('accuracyData').textContent = JSON.stringify(report, null, 2);
      completedReport = report;
      node('downloadAccuracy').disabled = false;
      check = null;
      dot.classList.add('hidden');
      node('accuracyPanel').classList.add('report-complete');
      onReset();
      return;
    }
    dot.style.left = `${state.target.x - bounds.left}px`;
    dot.style.top = `${state.target.y - bounds.top}px`;
    dot.textContent = `${state.index + 1}`;
  }

  function tick(now) {
    frame = null;
    if (!check) return;
    paint(check.update(null, now));
    if (check) frame = window.requestAnimationFrame(tick);
  }

  function cancel() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (check) {
      result.textContent = 'Check cancelled. Run again with a stable window and uninterrupted tracking.';
      completedReport = null;
      node('downloadAccuracy').disabled = true;
      node('accuracyData').textContent = '';
    }
    check = null;
    dot.classList.add('hidden');
  }

  node('cancelAccuracy').addEventListener('click', () => {
    cancel();
    node('accuracyPanel').classList.add('hidden');
    onReset();
  });
  node('downloadAccuracy').addEventListener('click', () => {
    if (!completedReport || check) return;
    const blob = new window.Blob([JSON.stringify(completedReport, null, 2) + '\n'], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gaze-accuracy-${completedReport.mode}.json`;
    link.click();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  });
  return {
    get active() { return check !== null; },
    start(trackingMode) {
      cancel();
      mode = trackingMode;
      completedReport = null;
      node('downloadAccuracy').disabled = true;
      node('accuracyPanel').classList.remove('report-complete');
      node('accuracyPanel').classList.remove('hidden');
      const content = node('accuracyContent');
      if (content) content.scrollTop = 0;
      bounds = node('accuracyStage').getBoundingClientRect();
      setup = {
        startedAt: new Date().toISOString(),
        viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
        measurementArea: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      };
      const points = [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]]
        .map(([x, y]) => ({ x: bounds.left + bounds.width * x, y: bounds.top + bounds.height * y }));
      check = createAccuracyCheck(points, performance.now(), protocol);
      dot.classList.remove('hidden');
      result.textContent = 'Look at each numbered dot until it moves. Do not click. Navigation is suspended for ten seconds.';
      node('accuracyData').textContent = '';
      paint(check.update(null, performance.now()));
      frame = window.requestAnimationFrame(tick);
    },
    sample(point, now) { if (check) paint(check.update(point, now)); },
    cancel,
  };
}
