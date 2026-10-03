// A timed check does not train the estimator or execute interface actions.
export function createAccuracyCheck(points, startedAt, { targetMs = 2000, settleMs = 500 } = {}) {
  if (!points.length || !Number.isFinite(startedAt) || targetMs <= settleMs || settleMs < 0) {
    throw new Error('Invalid accuracy check configuration.');
  }
  const targets = points.map(point => ({ x: point.x, y: point.y, errors: [], intervals: [], previousAt: null }));
  let finished = null;
  let latestAt = startedAt;

  function summarize() {
    const errors = targets.flatMap(target => target.errors).sort((a, b) => a - b);
    const intervals = targets.flatMap(target => target.intervals);
    const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const percentile = fraction => errors.length ? errors[Math.max(0, Math.ceil(errors.length * fraction) - 1)] : null;
    return {
      samples: errors.length,
      meanErrorPx: mean(errors), medianErrorPx: percentile(.5), p90ErrorPx: percentile(.9),
      meanSampleIntervalMs: mean(intervals),
      measuredTargets: targets.filter(target => target.errors.length).length,
      targets: targets.map(target => ({ x: target.x, y: target.y, samples: target.errors.length, meanErrorPx: mean(target.errors) })),
      durationMs: targetMs * targets.length,
    };
  }

  return {
    update(point, now) {
      if (finished) return { done: true, report: finished };
      if (!Number.isFinite(now) || now < latestAt) {
        now = latestAt;
        point = null;
      }
      latestAt = now;
      const elapsed = now - startedAt;
      const index = Math.max(0, Math.floor(elapsed / targetMs));
      if (index >= targets.length) {
        finished = summarize();
        return { done: true, report: finished };
      }
      const target = targets[index];
      if (Number.isFinite(now) && elapsed >= 0 && elapsed % targetMs >= settleMs &&
          Number.isFinite(point?.x) && Number.isFinite(point?.y) &&
          (target.previousAt === null || now > target.previousAt)) {
        target.errors.push(Math.hypot(point.x - target.x, point.y - target.y));
        if (target.previousAt !== null) target.intervals.push(now - target.previousAt);
        target.previousAt = now;
      }
      return { done: false, index, target: { x: target.x, y: target.y } };
    },
  };
}
