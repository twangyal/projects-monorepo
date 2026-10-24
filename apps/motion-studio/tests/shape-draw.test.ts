import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapePoints } from '../src/shape-draw.ts';

test('line retains exact endpoints and rectangle closes its four local corners in reversed drags', () => {
  const a = { x: 80, y: 45 }, b = { x: -20, y: -15 };
  assert.deepEqual(shapePoints('line', a, b), [a, b]);
  const rect = shapePoints('rectangle', a, b);
  assert.deepEqual(rect, [{ x: -20, y: -15 }, { x: 80, y: -15 }, { x: 80, y: 45 }, { x: -20, y: 45 }, { x: -20, y: -15 }]);
  assert.notEqual(rect[0], rect[4]);
  rect[0].x = 0; assert.equal(rect[4].x, -20); assert.deepEqual(a, { x: 80, y: 45 });
});
test('ellipse has64 segments, exact closure and correct local radii without duplicate shape state', () => {
  const points = shapePoints('ellipse', { x: 80, y: 45 }, { x: -20, y: -15 });
  assert.equal(points.length, 65); assert.deepEqual(points[0], { x: 80, y: 15 }); assert.deepEqual(points[64], points[0]);
  assert.notEqual(points[64], points[0]);
  for (const p of points) assert.ok(Math.abs(((p.x - 30) / 50) ** 2 + ((p.y - 15) / 30) ** 2 - 1) < 1e-12);
});
test('clicks and zero-area shapes are no-ops; straight lines remain valid', () => {
  for (const kind of ['line', 'rectangle', 'ellipse'] as const) assert.deepEqual(shapePoints(kind, { x: 1, y: 2 }, { x: 1, y: 2 }), []);
  for (const kind of ['rectangle', 'ellipse'] as const) assert.deepEqual(shapePoints(kind, { x: 1, y: 2 }, { x: 1, y: 20 }), []);
  assert.deepEqual(shapePoints('line', { x: 1, y: 2 }, { x: 1, y: 20 }), [{ x: 1, y: 2 }, { x: 1, y: 20 }]);
});
test('all local points must be finite and inside existing artwork bounds', () => {
  for (const x of [NaN, Infinity, -Infinity, 1280.001, -1280.001]) {
    assert.throws(() => shapePoints('ellipse', { x, y: 0 }, { x: 1, y: 1 }));
    assert.throws(() => shapePoints('rectangle', { x: 0, y: 0 }, { x: 1, y: x }));
  }
  assert.equal(shapePoints('rectangle', { x: -1280, y: -1280 }, { x: 1280, y: 1280 }).length, 5);
});
