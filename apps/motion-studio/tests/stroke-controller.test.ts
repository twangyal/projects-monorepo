import assert from 'node:assert/strict';
import test from 'node:test';
import { StrokeDrag, uniformCanvas } from '../src/stroke-editor.ts';
const pose = { x: 200, y: 100, scale: 2, rotation: 90, opacity: 1 };
test('drag waits for exactly three CSS pixels and captures pose independently', () => {
  const original = { ...pose }, drag = new StrokeDrag({ x: 20, y: 30 }, original, 640); original.scale = 4;
  assert.deepEqual(drag.update({ x: 22.999, y: 30 }), { moved: false, delta: { x: 0, y: 0 } });
  const result = drag.update({ x: 23, y: 30 }); assert.equal(result.moved, true); assert.ok(Math.abs(result.delta.x) < 1e-12); assert.equal(result.delta.y, -1.5);
});
test('each move and final release uses the immutable origin, including returning to it', () => {
  const drag = new StrokeDrag({ x: 10, y: 10 }, pose, 320);
  let result = drag.update({ x: 20, y: 5 }); assert.ok(Math.abs(result.delta.x + 5) < 1e-12); assert.ok(Math.abs(result.delta.y + 10) < 1e-12);
  result = drag.update({ x: 30, y: 0 }); assert.ok(Math.abs(result.delta.x + 10) < 1e-12); assert.ok(Math.abs(result.delta.y + 20) < 1e-12);
  assert.deepEqual(drag.update({ x: 10, y: 10 }), { moved: true, delta: { x: 0, y: 0 } });
});
test('nonuniform/zero/nonfinite geometry and nonfinite pointer positions refuse safely', () => {
  assert.equal(uniformCanvas(320, 180), true); assert.equal(uniformCanvas(320, 200), false); assert.equal(uniformCanvas(0, 0), false);
  assert.throws(() => new StrokeDrag({ x: 0, y: 0 }, pose, 0)); assert.throws(() => new StrokeDrag({ x: NaN, y: 0 }, pose, 640));
  assert.throws(() => new StrokeDrag({ x: 0, y: 0 }, pose, 640).update({ x: Infinity, y: 0 }));
});
