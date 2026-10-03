export function createDwellTracker({ dwellMs = 900, maxGapMs = 250 } = {}) {
  let current = null;
  let startedAt = 0;
  let previousAt = null;
  let confirmed = null;

  function reset() {
    current = null;
    confirmed = null;
    previousAt = null;
    startedAt = 0;
  }

  function update(target, now) {
    if (!Number.isFinite(now)) {
      reset();
      return { target: null, progress: 0, activated: null };
    }
    const interrupted = previousAt !== null && (now < previousAt || now - previousAt > maxGapMs);
    previousAt = now;
    if (!target) {
      current = null;
      confirmed = null;
      return { target: null, progress: 0, activated: null };
    }
    // Confirmation remains latched until the user leaves this target.
    if (target !== current) {
      current = target;
      confirmed = null;
      startedAt = now;
    } else if (interrupted) {
      startedAt = now;
    }
    if (confirmed === target) return { target: null, progress: 0, activated: null };
    const progress = Math.min(1, Math.max(0, (now - startedAt) / dwellMs));
    const activated = progress === 1 ? target : null;
    if (activated) confirmed = target;
    return { target, progress, activated };
  }

  return { update, reset };
}
