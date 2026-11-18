// Construction grain, independent of print/artwork orientation. Pattern y increases downwards.
export type GrainPoint = { x: number; y: number };
export const grainAngleOf = (style: { grainAngle?: number }): number => style.grainAngle ?? 0;
/** Clockwise from the upward pattern vertical; the grain is an undirected axis. */
export function grainDirection(angle: number): GrainPoint {
  const radians = angle * Math.PI / 180;
  const snap = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;
  return { x: snap(Math.sin(radians)), y: snap(-Math.cos(radians)) };
}

/** A useful arrow wholly within a simple sewing polygon, including concave pieces and narrow trims. */
export function grainLine(outline: readonly GrainPoint[], angle: number): [GrainPoint, GrainPoint] {
  const d = grainDirection(angle), n = { x: -d.y, y: d.x };
  const points = outline.map(p => ({ u: p.x * n.x + p.y * n.y, t: p.x * d.x + p.y * d.y }));
  const levels = [...new Set(points.map(p => p.u))].sort((a, b) => a - b);
  const low = levels[0]!, high = levels.at(-1)!;
  // Try the middle first, then each interval between vertices. Intervals avoid vertex tangencies and cover thin arms.
  const offsets = [(low + high) / 2, ...levels.slice(1).map((value, i) => (value + levels[i]!) / 2)];
  let best: { u: number; from: number; to: number } | null = null;
  for (const u of offsets) {
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      if ((a.u > u) !== (b.u > u)) crossings.push(a.t + (b.t - a.t) * (u - a.u) / (b.u - a.u));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = crossings[i]!, to = crossings[i + 1]!;
      if (to - from > 1e-8 && (!best || to - from > best.to - best.from + 1e-8)) best = { u, from, to };
    }
  }
  if (!best) throw new Error('The pattern piece has no interior for a grainline.');
  const at = (fraction: number) => {
    const t = best.from + (best.to - best.from) * fraction;
    return { x: n.x * best.u + d.x * t, y: n.y * best.u + d.y * t };
  };
  return [at(0.2), at(0.8)];
}
