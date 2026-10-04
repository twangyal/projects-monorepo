import assert from 'node:assert/strict';
import test from 'node:test';
import { createDrawingLayer, type Point, type Project } from '../src/model.ts';
import { createFrameRenderer, renderFrame } from '../src/render.ts';

function drawing(points: Point[]): Project {
  const layer = createDrawingLayer();
  layer.cels[0].strokes = [{ color: '#00FF00', width: 12, points }];
  return { schemaVersion: 2, title: 'Exact dot', background: '#FFFFFF', frameCount: 12, layers: [layer] };
}
function recording() {
  const calls: unknown[][] = [];
  const target: Record<string, unknown> = {};
  for (const name of ['save', 'restore', 'setTransform', 'fillRect', 'translate', 'rotate', 'scale', 'setLineDash', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke']) {
    target[name] = (...args: unknown[]) => { calls.push([name, ...args]); };
  }
  return { calls, ctx: target as unknown as CanvasRenderingContext2D };
}

test('64 identical samples paint the same filled dot as a single original point', () => {
  const single = recording(), repeated = recording();
  renderFrame(single.ctx, drawing([{ x: 3, y: -2 }]), 0, new Map());
  createFrameRenderer(drawing(Array.from({ length: 64 }, () => ({ x: 3, y: -2 }))), new Map()).render(repeated.ctx, 0);
  assert.deepEqual(repeated.calls, single.calls);
  assert.ok(repeated.calls.some(call => call[0] === 'arc' && call[1] === 3 && call[2] === -2 && call[3] === 6));
  assert.equal(repeated.calls.filter(call => call[0] === 'stroke').length, 0);
});

test('an exactly nonzero segment remains a stroke even at tiny coordinate separation', () => {
  const trace = recording();
  renderFrame(trace.ctx, drawing([{ x: 0, y: 0 }, { x: Number.EPSILON, y: 0 }]), 0, new Map());
  assert.equal(trace.calls.filter(call => call[0] === 'arc').length, 0);
  assert.equal(trace.calls.filter(call => call[0] === 'stroke').length, 1);
  assert.ok(trace.calls.some(call => call[0] === 'lineTo' && call[1] === Number.EPSILON));
});
