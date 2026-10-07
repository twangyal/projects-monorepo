import { resolveTarget } from './resolver.js';

// Radius in CSS pixels around the gaze point. Ambiguity margin and hysteresis scale with it.
export const ASSIST_RADIUS = { off: 0, standard: 48, wide: 96 };
const NONE = Object.freeze({ target: null, assisted: false, ambiguous: false });

export function distanceToRect(x, y, rect) {
  const dx = Math.max(rect.left - x, 0, x - (rect.left + rect.width));
  const dy = Math.max(rect.top - y, 0, y - (rect.top + rect.height));
  return Math.hypot(dx, dy);
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// A candidate must be visible where the user would be looking: at its nearest point or its center.
function unobscured(document, target, rect, x, y) {
  const inset = Math.min(2, rect.width / 2, rect.height / 2);
  const points = [
    [clamp(x, rect.left + inset, rect.left + rect.width - inset), clamp(y, rect.top + inset, rect.top + rect.height - inset)],
    [rect.left + rect.width / 2, rect.top + rect.height / 2],
  ];
  return points.some(([px, py]) => {
    const hit = document.elementFromPoint(px, py);
    return hit === target || Boolean(hit && target.contains(hit));
  });
}

// Exact hits always win. Otherwise choose the uniquely closest eligible target within the
// radius, keep the current target while gaze stays just outside it, and abstain when two
// targets are similarly close. The caller still requires a full dwell before activation.
export function resolveAssistedTarget(document, root, x, y, { radius = 0, current = null, eligible = () => true } = {}) {
  const direct = resolveTarget(document, root, x, y);
  if (direct) return eligible(direct) ? { target: direct, assisted: false, ambiguous: false } : NONE;
  if (!(radius > 0) || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return NONE;
  const margin = radius / 6;
  const hysteresis = radius / 4;
  const candidates = [];
  for (const target of root.querySelectorAll('[data-gaze-target]')) {
    if (target.disabled || !eligible(target)) continue;
    const rect = target.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) continue;
    const distance = distanceToRect(x, y, rect);
    const reach = target === current ? radius + hysteresis : radius;
    if (distance > reach || !unobscured(document, target, rect, x, y)) continue;
    candidates.push({ target, distance });
  }
  if (!candidates.length) return NONE;
  candidates.sort((a, b) => a.distance - b.distance);
  const kept = candidates.find(candidate => candidate.target === current);
  if (kept && kept.distance <= candidates[0].distance + hysteresis) {
    return { target: current, assisted: true, ambiguous: false };
  }
  const [best, next] = candidates.filter(candidate => candidate.distance <= radius);
  if (!best) return NONE;
  if (next && next.distance - best.distance <= margin) return { target: null, assisted: false, ambiguous: true };
  return { target: best.target, assisted: true, ambiguous: false };
}
