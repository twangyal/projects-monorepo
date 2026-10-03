import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createDemo, createDrawingLayer, validateProject, evaluatePose,
  upsertKeyframe, removeKeyframe, resizeTimeline, localPoint } from '../src/model.ts';
import type { DrawingLayer, Pose } from '../src/model.ts';

const pose = (x = 0): Pose => ({ x, y: 0, scale: 1, rotation: 0, opacity: 1 });
function layer(): DrawingLayer {
  return { ...createDrawingLayer('Test'), keys: [
    { ...pose(0), frame: 0, easing: 'linear' },
    { ...pose(100), y: 100, scale: 2, rotation: 360, opacity: 0, frame: 20, easing: 'linear' },
  ] };
}

test('blank and original demo projects are valid and independent', () => {
  const blank = createProject();
  assert.equal(blank.frameCount, 48);
  assert.equal(blank.layers.length, 1);
  assert.equal(blank.layers[0].kind, 'drawing');
  assert.deepEqual(validateProject(blank), blank);
  const demo = createDemo();
  assert.deepEqual(validateProject(demo), demo);
  assert.ok(demo.layers.some(item => item.kind === 'drawing' && item.strokes.length > 0));
  assert.ok(demo.layers.some(item => JSON.stringify(evaluatePose(item, 0)) !== JSON.stringify(evaluatePose(item, 12))));
  assert.notEqual(createProject().layers[0].id, blank.layers[0].id);
});

test('validation reconstructs fields and independently copies nested artwork', () => {
  const project = createProject();
  const drawing = project.layers[0] as DrawingLayer;
  drawing.strokes.push({ color: '#Ab12Cd', width: 4, points: [{ x: 1, y: 2 }] });
  const result = validateProject({ ...project, ignored: 'not retained' });
  assert.equal('ignored' in result, false);
  (result.layers[0] as DrawingLayer).strokes[0].points[0].x = 99;
  result.layers[0].keys[0].x = 88;
  assert.equal(drawing.strokes[0].points[0].x, 1);
  assert.equal(drawing.keys[0].x, 320);
});

test('project, layer, key, pose and stroke bounds reject invalid data', () => {
  const good = createProject();
  for (const change of [ { schemaVersion: 2 }, { frameCount: 11 }, { frameCount: 97 },
    { frameCount: 12.5 }, { title: '' }, { title: ' ' }, { title: 'x'.repeat(81) },
    { background: 'red' }, { layers: Array(9).fill(good.layers[0]) },
    { layers: [good.layers[0], good.layers[0]] } ]) {
    assert.throws(() => validateProject({ ...good, ...change }));
  }
  for (const change of [ { id: '../unsafe' }, { name: '' }, { kind: 'other' }, { keys: [] },
    { keys: [{ ...pose(), frame: 1, easing: 'linear' }] },
    { keys: [{ ...pose(), frame: 0, easing: 'other' }] },
    { keys: [{ ...pose(), x: NaN, frame: 0, easing: 'linear' }] },
    { keys: [{ ...pose(), scale: 0, frame: 0, easing: 'linear' }] },
    { keys: [{ ...pose(), frame: 0, easing: 'linear' }, { ...pose(), frame: 0, easing: 'ease' }] },
    { strokes: [{ color: '#000000', width: 41, points: [{ x: 0, y: 0 }] }] },
    { strokes: [{ color: '#000000', width: 1, points: [] }] },
    { strokes: [{ color: '#000000', width: 1, points: [{ x: 1281, y: 0 }] }] } ]) {
    assert.throws(() => validateProject({ ...good, layers: [{ ...good.layers[0], ...change }] }));
  }
});

test('aggregate stroke and point limits apply across layers', () => {
  const make = (count: number, points: number): DrawingLayer => ({ ...createDrawingLayer(),
    strokes: Array.from({ length: count }, () => ({ color: '#000000', width: 1,
      points: Array.from({ length: points }, () => ({ x: 0, y: 0 })) })) });
  const project = createProject();
  assert.doesNotThrow(() => validateProject({ ...project, layers: [make(10, 1000)] }));
  assert.throws(() => validateProject({ ...project, layers: [make(5, 1000), make(6, 1000)] }), /points/i);
  assert.throws(() => validateProject({ ...project, layers: [make(51, 1), make(50, 1)] }), /strokes/i);
  assert.throws(() => validateProject({ ...project, layers: [make(1, 1001)] }), /points/i);
});

test('image fields reject external URLs, excessive dimensions, bytes and counts', () => {
  const project = createProject();
  const image = { ...createDrawingLayer(), kind: 'image', image: {
    dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 } };
  assert.doesNotThrow(() => validateProject({ ...project, layers: [image] }));
  for (const change of [{ dataUrl: 'https://example.invalid/image.png' }, { dataUrl: 'data:image/svg+xml;base64,AAAA' },
    { dataUrl: 'data:image/png;base64,????' }, { width: 801 }, { height: 0 },
    { dataUrl: `data:image/png;base64,${'A'.repeat(1_572_864)}` }]) {
    assert.throws(() => validateProject({ ...project, layers: [{ ...image, image: { ...image.image, ...change } }] }));
  }
  assert.throws(() => validateProject({ ...project, layers: Array.from({ length: 5 }, (_, i) => ({ ...image, id: `image${i}` })) }), /images/i);
});

test('linear interpolation preserves endpoints, fractional frames and whole spins', () => {
  const original = layer();
  assert.deepEqual(evaluatePose(original, -10), pose(0));
  assert.deepEqual(evaluatePose(original, 10), { x: 50, y: 50, scale: 1.5, rotation: 180, opacity: 0.5 });
  assert.equal(evaluatePose(original, 2.5).x, 12.5);
  assert.equal(evaluatePose(original, 20).rotation, 360);
  assert.equal(evaluatePose(original, 95).x, 100);
  assert.throws(() => evaluatePose(original, Infinity));
});

test('hold and smoothstep easing belong to the starting key', () => {
  const original = layer();
  original.keys[0].easing = 'hold';
  assert.equal(evaluatePose(original, 19.99).x, 0);
  assert.equal(evaluatePose(original, 20).x, 100);
  original.keys[0].easing = 'ease';
  assert.equal(evaluatePose(original, 5).x, 15.625);
  assert.equal(evaluatePose(original, 0).x, 0);
});

test('upsert and removal are immutable, ordered and preserve existing easing', () => {
  const original = layer();
  original.keys[0].easing = 'hold';
  const replaced = upsertKeyframe(original, 0, pose(25));
  assert.equal(replaced.keys[0].easing, 'hold');
  assert.equal(original.keys[0].x, 0);
  const inserted = upsertKeyframe(replaced, 10, pose(50), 'ease');
  assert.deepEqual(inserted.keys.map(key => key.frame), [0, 10, 20]);
  assert.deepEqual(removeKeyframe(inserted, 10).keys.map(key => key.frame), [0, 20]);
  assert.throws(() => removeKeyframe(inserted, 0), /first|frame 0/i);
  assert.throws(() => removeKeyframe(inserted, 5), /keyframe/i);
  assert.throws(() => upsertKeyframe(original, 96, pose()));
  assert.throws(() => upsertKeyframe(original, 1.5, pose()));
  assert.throws(() => upsertKeyframe(original, 10, { ...pose(), opacity: 2 }));
});

test('keyframe cap permits replacement but prevents a 25th key', () => {
  const full = { ...createDrawingLayer(), keys: Array.from({ length: 24 }, (_, frame) => ({ ...pose(), frame, easing: 'linear' as const })) };
  assert.equal(upsertKeyframe(full, 12, pose(1)).keys.length, 24);
  assert.throws(() => upsertKeyframe(full, 30, pose(1)), /24/);
});

test('shortening preserves each evaluated endpoint and removes inaccessible keys', () => {
  const project = { ...createProject(), layers: [layer()] };
  const expected = evaluatePose(project.layers[0], 11);
  const short = resizeTimeline(project, 12);
  assert.equal(short.frameCount, 12);
  assert.deepEqual(short.layers[0].keys.map(key => key.frame), [0, 11]);
  assert.deepEqual(evaluatePose(short.layers[0], 11), expected);
  assert.equal(project.frameCount, 48);
  assert.deepEqual(project.layers[0].keys.map(key => key.frame), [0, 20]);
  assert.deepEqual(resizeTimeline(project, 96).layers[0].keys, project.layers[0].keys);
  assert.deepEqual(resizeTimeline(project, 48), project);
});

test('timeline shortening never silently exceeds the keyframe cap', () => {
  const full = { ...createDrawingLayer(), keys: Array.from({ length: 24 }, (_, frame) => ({ ...pose(), frame, easing: 'linear' as const })) };
  assert.throws(() => resizeTimeline({ ...createProject(), layers: [full] }, 30), /24/);
});

test('inverse coordinates recover local artwork after translation rotation and scale', () => {
  const transform = { x: 300, y: 200, scale: 2.5, rotation: 135, opacity: 0.5 };
  const original = { x: 12, y: -8 };
  const angle = transform.rotation * Math.PI / 180;
  const global = { x: transform.x + transform.scale * (original.x * Math.cos(angle) - original.y * Math.sin(angle)),
    y: transform.y + transform.scale * (original.x * Math.sin(angle) + original.y * Math.cos(angle)) };
  const result = localPoint(global, transform);
  assert.ok(Math.abs(result.x - original.x) < 1e-10);
  assert.ok(Math.abs(result.y - original.y) < 1e-10);
  assert.throws(() => localPoint(global, { ...transform, scale: 0 }));
});

test('whole-project JSON limit includes metadata beyond per-image limits', () => {
  const project = createProject();
  const dataUrl = `data:image/png;base64,${'A'.repeat(1_572_840)}`;
  assert.ok(dataUrl.length <= 1.5 * 1024 * 1024);
  const images = Array.from({ length: 4 }, (_, index) => ({ id: `image${index}`, name: 'Large image', kind: 'image',
    image: { dataUrl, width: 1, height: 1 }, keys: project.layers[0].keys }));
  assert.throws(() => validateProject({ ...project, layers: images }), /6 MiB/);
});

test('sparse arrays cannot bypass validation of required entries', () => {
  const project = createProject();
  const sparse = new Array(1);
  assert.throws(() => validateProject({ ...project, layers: sparse }));
  assert.throws(() => validateProject({ ...project, layers: [{ ...project.layers[0], keys: sparse }] }));
  assert.throws(() => validateProject({ ...project, layers: [{ ...project.layers[0], strokes: sparse }] }));
  assert.throws(() => validateProject({ ...project, layers: [{ ...project.layers[0],
    strokes: [{ color: '#000000', width: 2, points: sparse }] }] }));
});
