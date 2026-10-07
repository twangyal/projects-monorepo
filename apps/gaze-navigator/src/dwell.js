export function createDwellTracker({ dwellMs = 900, maxGapMs = 250 } = {}) {
  let current = null;
  let startedAt = 0;
  let previousAt = null;
  let confirmed = null;

  function reset({ preserveConfirmation = false } = {}) {
    if (!preserveConfirmation || !confirmed) {
      current = null;
      confirmed = null;
    }
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

  function setDwellMs(milliseconds) {
    if (![900, 1500, 2500].includes(milliseconds)) {
      throw new RangeError('Choose a confirmation hold of 900, 1500 or 2500 milliseconds.');
    }
    if (milliseconds === dwellMs) return false;
    dwellMs = milliseconds;
    reset({ preserveConfirmation: true });
    return true;
  }

  return { update, reset, setDwellMs };
}
