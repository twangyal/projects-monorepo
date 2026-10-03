import type { Point } from './calibration';

export interface Target {
  id: string;
  label: string;
  rect: { x: number; y: number; width: number; height: number };
}
export interface Decision { target: Target | null; reason: string }
export interface Selection extends Decision { progress: number; ready: boolean }

/** Local baseline; replace this boundary to compare a context-aware AI model. */
export function chooseTarget(point: Point, targets: Target[]): Decision {
  if (![point.x, point.y].every(Number.isFinite)) return { target: null, reason: 'No valid gaze signal.' };
  const ranked = targets.map(target => {
    const r = target.rect;
    const distance = Math.hypot(Math.max(r.x - point.x, 0, point.x - r.x - r.width),
      Math.max(r.y - point.y, 0, point.y - r.y - r.height));
    const center = Math.hypot(point.x - r.x - r.width / 2, point.y - r.y - r.height / 2);
    return { target, distance, score: distance + center * 0.08 };
  }).filter(r => Number.isFinite(r.score) && r.distance <= 72 && r.target.rect.width > 0 && r.target.rect.height > 0)
    .sort((a, b) => a.score - b.score);
  const best = ranked[0];
  if (!best) return { target: null, reason: 'Look toward a control in the workspace.' };
  if (ranked[1] && ranked[1].score - best.score < 18) {
    return { target: null, reason: 'Ambiguous targets. Look closer to the center of one control.' };
  }
  return { target: best.target, reason: best.distance === 0
    ? 'Gaze falls inside this visible control.' : 'This is the nearest visible control to your gaze.' };
}

export class DwellSelector {
  private id: string | null = null;
  private since = 0;
  constructor(private dwellMs = 900) {}

  reset() { this.id = null; this.since = 0; }

  update(decision: Decision, now: number): Selection {
    if (decision.target?.id !== this.id) {
      this.id = decision.target?.id ?? null;
      this.since = now;
    }
    if (!decision.target) { this.reset(); return { ...decision, progress: 0, ready: false }; }
    const progress = Math.min(1, Math.max(0, (now - this.since) / this.dwellMs));
    return { ...decision, progress, ready: progress === 1 };
  }
}
