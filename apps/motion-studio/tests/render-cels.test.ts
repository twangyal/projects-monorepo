import assert from 'node:assert/strict';
import test from 'node:test';
import * as renderer from '../src/render.ts';
import type { Project, ImageLayer } from '../src/model.ts';

type Context = CanvasRenderingContext2D;
type Prepared = { readonly frameCount: number; render(ctx: Context, frame: number): void };
function prepare(project: Project, assets = new Map<string, ImageBitmap>()): Prepared {
  const candidate = (renderer as unknown as { createFrameRenderer?: (project: Project, assets: Map<string, ImageBitmap>) => Prepared }).createFrameRenderer;
  assert.equal(typeof candidate, 'function', 'Prepared rendering API must be available.');
  return candidate!(project, assets);
}
function fixture(): Project {
  return { schemaVersion: 2, title: 'Three unlike holds', background: '#FFFFFF', frameCount: 24,
    layers: [{ id: 'ink', name: 'Ink', kind: 'drawing', cels: [
      { frame: 0, strokes: [{ color: '#FF0000', width: 10, points: [{ x: -20, y: 5 }, { x: 40, y: 15 }] }] },
      { frame: 6, strokes: [] },
      { frame: 12, strokes: [{ color: '#0000FF', width: 4, points: [{ x: 3, y: -2 }] }] },
    ], keys: [
      { frame: 0, x: 100, y: 80, scale: 1, rotation: 0, opacity: 1, easing: 'linear' },
      { frame: 10, x: 200, y: 180, scale: 2, rotation: 90, opacity: .5, easing: 'hold' },
    ] }],
  } as unknown as Project;
}
/** Record actual Canvas API calls, not renderer/model-derived expected values. */
function recording(failStroke = false) {
  const calls: unknown[][] = [], state: Record<string, unknown> = {};
  for (const name of ['save', 'restore', 'setTransform', 'fillRect', 'translate', 'rotate', 'scale', 'setLineDash', 'beginPath', 'arc', 'fill', 'moveTo', 'lineTo', 'stroke', 'drawImage']) {
    state[name] = (...args: unknown[]) => { calls.push([name, ...args]); if (failStroke && name === 'stroke') throw new Error('Canvas unavailable'); };
  }
  const ctx = new Proxy(state, { set(target, property, value) { calls.push(['set', property, value]); target[String(property)] = value; return true; } }) as unknown as Context;
  return { ctx, calls };
}
function colors(calls: unknown[][]) { return calls.filter(c => c[0] === 'set' && c[1] === 'strokeStyle').map(c => c[2]); }

test('a coincident multipoint path renders a round dot like the original single-point drawing', () => {
  const project = fixture(), drawing = project.layers[0];
  if (drawing.kind !== 'drawing') throw new Error('Fixture must be vector artwork');
  drawing.cels[0].strokes = [{ color: '#800080', width: 12,
    points: Array.from({ length: 64 }, () => ({ x: 50, y: 0 })) }];
  const trace = recording(); prepare(project).render(trace.ctx, 0);
  assert.ok(trace.calls.some(call => JSON.stringify(call) === JSON.stringify(['arc', 50, 0, 6, 0, Math.PI * 2])));
  assert.equal(trace.calls.filter(call => call[0] === 'fill').length, 1);
  assert.equal(trace.calls.filter(call => call[0] === 'stroke').length, 0);
});

test('held drawing bounds use only the active cel including exact fractional cuts and blank intervals', () => {
  const layer = fixture().layers[0];
  assert.deepEqual(renderer.layerBounds(layer), { width: 70, height: 20 });
  assert.deepEqual(renderer.layerBounds(layer, 5.999), { width: 70, height: 20 });
  assert.deepEqual(renderer.layerBounds(layer, 6), { width: 1, height: 1 });
  assert.deepEqual(renderer.layerBounds(layer, 11.5), { width: 1, height: 1 });
  assert.deepEqual(renderer.layerBounds(layer, 12), { width: 4, height: 4 });
  assert.deepEqual(renderer.layerBounds(layer, 200), { width: 4, height: 4 });
  assert.throws(() => renderer.layerBounds(layer, NaN), /frame/i);
});

test('prepared and direct renderer use literal held boundaries with independent interpolated pose', () => {
  const project = fixture(), prepared = prepare(project); assert.equal(prepared.frameCount, 24);
  for (const [frame, expected] of [[0, ['#FF0000']], [5.999, ['#FF0000']], [6, []], [11.5, []], [12, ['#0000FF']], [23, ['#0000FF']]] as const) {
    const direct = recording(), cached = recording();
    renderer.renderFrame(direct.ctx, project, frame, new Map()); prepared.render(cached.ctx, frame);
    assert.deepEqual(colors(cached.calls), expected); assert.deepEqual(cached.calls, direct.calls);
  }
  const middle = recording(); prepared.render(middle.ctx, 5);
  assert.ok(middle.calls.some(c => JSON.stringify(c) === '["translate",150,130]'));
  assert.ok(middle.calls.some(c => JSON.stringify(c) === '["scale",1.5,1.5]'));
  assert.ok(middle.calls.some(c => c[0] === 'rotate' && c[1] === Math.PI / 4));
  assert.ok(middle.calls.some(c => c[0] === 'set' && c[1] === 'globalAlpha' && c[2] === .75));
  const dot = recording(); prepared.render(dot.ctx, 12);
  assert.ok(dot.calls.some(c => JSON.stringify(c) === JSON.stringify(['arc', 3, -2, 2, 0, Math.PI * 2])));
  assert.equal(dot.calls.filter(c => c[0] === 'stroke').length, 0);
});

test('prepared renderer retains its admitted project when caller changes source graph and metadata', () => {
  const project = fixture(), prepared = prepare(project), before = recording(); prepared.render(before.ctx, 0);
  const drawing = project.layers[0];
  if (drawing.kind === 'drawing') drawing.cels[0].strokes[0].points[0].x = 999;
  project.layers[0].keys[0].x = -600;
  project.title = 'Changed'; project.background = '#000000'; project.frameCount = 12; project.layers.splice(0);
  const after = recording(); prepared.render(after.ctx, 0);
  assert.deepEqual(after.calls, before.calls); assert.equal(prepared.frameCount, 24);
  assert.throws(() => { (prepared as { frameCount: number }).frameCount = 1; }, TypeError);
  prepared.render(recording().ctx, 23);
});

test('prepared renderer captures image bindings and refuses closed or missing assets before painting', () => {
  const project = fixture();
  const image: ImageLayer = { id: 'photo', name: 'Photo', kind: 'image', keys: structuredClone(project.layers[0].keys), image: { dataUrl: 'data:image/png;base64,AAAA', width: 20, height: 10 } };
  project.layers.push(image);
  const bitmap = { width: 20, height: 10 } as ImageBitmap, assets = new Map([['photo', bitmap]]);
  const prepared = prepare(project, assets); assets.clear();
  const trace = recording(); prepared.render(trace.ctx, 0);
  assert.ok(trace.calls.some(c => c[0] === 'drawImage' && c[1] === bitmap && c[2] === -10 && c[3] === -5 && c[4] === 20 && c[5] === 10));
  assert.throws(() => prepare(project), /assets/i);
  Object.assign(bitmap, { width: 0, height: 0 });
  const closed = recording(); assert.throws(() => prepared.render(closed.ctx, 0), /assets/i); assert.deepEqual(closed.calls, []);
});

test('invalid frames and malformed future cels are rejected before any Canvas mutation', () => {
  const prepared = prepare(fixture());
  for (const frame of [-1, 24, NaN, Infinity]) {
    const trace = recording(); assert.throws(() => prepared.render(trace.ctx, frame), /frame/i); assert.deepEqual(trace.calls, []);
  }
  const malformed = fixture() as unknown as { layers: { cels: { frame: number }[] }[] };
  malformed.layers[0].cels[2].frame = 6;
  assert.throws(() => prepare(malformed as unknown as Project));
});

test('canvas failure restores both layer and caller state', () => {
  const prepared = prepare(fixture()), trace = recording(true);
  assert.throws(() => prepared.render(trace.ctx, 0), /Canvas unavailable/);
  assert.equal(trace.calls.filter(c => c[0] === 'save').length, 2);
  assert.equal(trace.calls.filter(c => c[0] === 'restore').length, 2);
});

test('genuine schema1 drawing retains original paths and transform through prepared rendering', () => {
  const legacy = { schemaVersion: 1, title: 'Original', background: '#FFFFFF', frameCount: 24, layers: [{ id: 'old', name: 'Old', kind: 'drawing', strokes: [{ color: '#12abCD', width: 3, points: [{ x: 1.125, y: -2.25 }, { x: 20, y: 5 }] }], keys: [{ frame: 0, x: 100, y: 50, scale: 1.5, rotation: -30, opacity: .7, easing: 'linear' }] }] };
  const original = JSON.stringify(legacy), prepared = prepare(legacy as unknown as Project), trace = recording();
  prepared.render(trace.ctx, 23);
  assert.deepEqual(colors(trace.calls), ['#12abCD']);
  assert.ok(trace.calls.some(c => JSON.stringify(c) === '["moveTo",1.125,-2.25]'));
  assert.ok(trace.calls.some(c => JSON.stringify(c) === '["lineTo",20,5]'));
  assert.ok(trace.calls.some(c => JSON.stringify(c) === '["translate",100,50]'));
  assert.equal(JSON.stringify(legacy), original);
});
