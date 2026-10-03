// Hit testing remains a separate boundary from gaze estimation and execution.
export function resolveTarget(document, root, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null;
  const target = document.elementFromPoint(x, y)?.closest?.('[data-gaze-target]');
  return target && !target.disabled && root.contains(target) ? target : null;
}
