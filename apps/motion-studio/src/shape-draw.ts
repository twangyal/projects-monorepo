import type { Point } from './model.ts';

export type ShapeKind = 'line' | 'rectangle' | 'ellipse';

/** Ordinary retained paths in drawing-local axes; no new saved shape format. */
export function shapePoints(kind: ShapeKind, start: Point, end: Point): Point[] {
  for (const point of [start, end]) {
    if (![point.x, point.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1280)) throw new Error('Shape points must be finite and within the artwork bounds.');
  }
  if (start.x === end.x && start.y === end.y) return [];
  if (kind === 'line') return [{ ...start }, { ...end }];
  if (start.x === end.x || start.y === end.y) return [];
  const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y);
  const points: Point[] = [];
  if (kind === 'rectangle') points.push({ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom });
  else {
    const x = (left + right) / 2, y = (top + bottom) / 2, rx = (right - left) / 2, ry = (bottom - top) / 2;
    for (let i = 0; i < 64; i++) points.push({ x: x + rx * Math.cos(i * Math.PI / 32), y: y + ry * Math.sin(i * Math.PI / 32) });
  }
  return [...points, { ...points[0] }];
}
