import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, MAX_JSON_BYTES, evaluatePose } from '../src/model.ts';
import type { Project, DrawingLayer, Stroke } from '../src/model.ts';
import { History } from '../src/history.ts';
import { planTweenFrames, resampleStrokePoints, buildDrawingTween, previewDrawingTween, applyDrawingTween,
  TWEEN_SAMPLES, MAX_TWEEN_PAIRS } from '../src/tween.ts';

const ink = (x = 0, color = '#000000', width = 2): Stroke => ({ color, width, points: [{ x, y: 0 }, { x: x + 63, y: 0 }] });
function source(): Project {
  return validateProject({ schemaVersion: 2, title: 'Tween ✨', background: '#ffffff', frameCount: 96,
    layers: [{ id: 'drawing', name: 'Drawing', kind: 'drawing',
      keys: [{ frame: 0, x: 100, y: 100, scale: 1, rotation: 0, opacity: 1, easing: 'linear' },
        { frame: 95, x: 195, y: 100, scale: 1, rotation: 95, opacity: 1, easing: 'linear' }],
      cels: [{ frame: 0, strokes: [ink()] }, { frame: 10, strokes: [ink(100, '#ffffff', 6)] }] }] });
}
const drawing = (project: Project) => project.layers[0] as DrawingLayer;
const selection = () => ({ layerId: 'drawing', startFrame: 0, endFrame: 10 });
const choices = () => ({ pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames: [5] });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('odd-gap planning uses exact interior floor frames and refuses invalid counts', () => {
  assert.equal(TWEEN_SAMPLES, 64); assert.equal(MAX_TWEEN_PAIRS, 8);
  assert.deepEqual(planTweenFrames(3, 12, 3), [5, 7, 9]);
  assert.deepEqual(planTweenFrames(0, 95, 22), Array.from({ length: 22 }, (_, j) => Math.floor((j + 1) * 95 / 23)));
  assert.deepEqual(planTweenFrames(0, 3, 2), [1, 2]);
  for (const args of [[0, 1, 1], [0, 95, 23], [0, 5, 0], [0, 5, 5], [3, 3, 1], [-1, 9, 1], [0, 96, 1], [0, 5, 1.5], [NaN, 5, 1]]) {
    assert.throws(() => planTweenFrames(...args as [number, number, number]));
  }
});

test('arc length samples a right-angle path by distance, with exact endpoints and reversal', () => {
  const points = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 42 }, { x: 21, y: 42 }];
  const samples = resampleStrokePoints(points);
  assert.equal(samples.length, 64);
  for (let k = 0; k < 64; k++) { close(samples[k].x, Math.min(k, 21)); close(samples[k].y, Math.max(k - 21, 0)); }
  const reversed = resampleStrokePoints(points, true);
  for (let k = 0; k < 64; k++) { close(reversed[k].x, samples[63 - k].x); close(reversed[k].y, samples[63 - k].y); }
  assert.deepEqual(samples[0], points[0]); assert.deepEqual(samples[63], points.at(-1));
  samples[0].x = 100; assert.equal(points[0].x, 0);
});

test('unequal diagonal segments sample the independently calculated distance fraction', () => {
  const samples = resampleStrokePoints([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 101, y: 1 }]);
  const firstLength = Math.sqrt(2), total = firstLength + 100;
  for (let k = 1; k < 63; k++) {
    const distance = total * k / 63;
    if (distance < firstLength) { close(samples[k].x, distance / firstLength); close(samples[k].y, distance / firstLength); }
    else { close(samples[k].x, 1 + distance - firstLength); close(samples[k].y, 1); }
  }
});

test('single and coincident points yield independent dots and normalize negative zero', () => {
  for (const input of [[{ x: -0, y: 3 }], [{ x: 1, y: 2 }, { x: 1, y: 2 }]]) {
    const samples = resampleStrokePoints(input);
    assert.equal(new Set(samples).size, 64);
    assert.deepEqual(samples[0], { x: input[0].x || 0, y: input[0].y });
    assert.deepEqual(samples[63], samples[0]);
    assert.equal(Object.is(samples[0].x, -0), false);
  }
});

test('resampling refuses malformed points and hostile arrays without invoking accessors', () => {
  let calls = 0;
  const point = { x: 0, y: 0 }; Object.defineProperty(point, 'x', { get() { calls++; return 0; } });
  const array = [{ x: 0, y: 0 }]; Object.defineProperty(array, 'map', { get() { calls++; return Array.prototype.map; } });
  for (const input of [[], new Array(1), [point], array, [{ x: 0, y: 0, extra: 1 }], [{ x: Infinity, y: 0 }],
    [{ x: 1281, y: 0 }], Array.from({ length: 1001 }, () => ({ x: 0, y: 0 })), [new Date()],
    Object.setPrototypeOf([{ x: 0, y: 0 }], null)]) {
    assert.throws(() => resampleStrokePoints(input as { x: number; y: number }[]));
  }
  assert.throws(() => resampleStrokePoints([{ x: 0, y: 0 }], 1 as unknown as boolean));
  assert.equal(calls, 0);
});

test('legal extrema remain legal at every sample and nonbinary tween fraction', () => {
  for (const x of [-1280, 1280]) {
    const samples = resampleStrokePoints([{ x, y: 0 }, { x, y: 63 }]);
    assert.ok(samples.every(p => p.x === x));
    const project = source(); drawing(project).cels[1].frame = 7;
    for (const cel of drawing(project).cels) cel.strokes = [{ color: '#000000', width: 40, points: [{ x, y: x }] }];
    const proposal = buildDrawingTween(project, { ...selection(), endFrame: 7 }, { ...choices(), frames: [1, 2, 3, 4, 5, 6] });
    for (const cel of proposal.generated) {
      assert.equal(cel.strokes[0].width, 40); assert.ok(cel.strokes[0].points.every(p => p.x === x && p.y === x));
    }
  }
});

test('unequal one-ulp boundary coordinates remain inside model bounds without clamping', () => {
  for (const [a, b] of [[-1280, -1279.9999999999998], [1280, 1279.9999999999998]]) {
    const project = source(); drawing(project).cels[1].frame = 95;
    drawing(project).cels[0].strokes = [{ color: '#000000', width: 40, points: [{ x: a, y: 0 }] }];
    drawing(project).cels[1].strokes = [{ color: '#000000', width: 39.99999999999999, points: [{ x: b, y: 0 }] }];
    const proposal = buildDrawingTween(project, { ...selection(), endFrame: 95 }, { ...choices(), frames: [2] });
    assert.equal(proposal.generated[0].strokes[0].points[0].x, a);
    assert.equal(proposal.generated[0].strokes[0].width, 40);
    const path = resampleStrokePoints([{ x: a, y: 0 }, { x: b, y: 63 }]);
    assert.ok(path.every(p => p.x >= Math.min(a, b) && p.x <= Math.max(a, b)));
    assert.equal(drawing(applyDrawingTween(project, proposal)).cels.at(-1)!.strokes[0].points[0].x, b);
  }
});

test('exact proposal receipts reject negative-zero mutations in indices and frames', () => {
  for (const mutate of [
    (p: ReturnType<typeof buildDrawingTween>) => { p.selection.startFrame = -0; },
    (p: ReturnType<typeof buildDrawingTween>) => { p.choices.pairs[0].startStroke = -0; },
    (p: ReturnType<typeof buildDrawingTween>) => { p.choices.pairs[0].endStroke = -0; },
  ]) {
    const project = source(), p = buildDrawingTween(project, selection(), choices()); mutate(p);
    assert.throws(() => applyDrawingTween(project, p));
  }
});

test('build generates exact half-frame geometry, encoded RGB rounding and complete UTF8 usage', () => {
  const project = source(), original = JSON.stringify(project);
  const proposal = buildDrawingTween(project, selection(), choices());
  assert.deepEqual(proposal.generated.map(cel => cel.frame), [5]);
  const stroke = proposal.generated[0].strokes[0];
  assert.equal(stroke.color, '#808080'); assert.equal(stroke.width, 4);
  for (let k = 0; k < 64; k++) { close(stroke.points[k].x, 50 + k); assert.equal(stroke.points[k].y, 0); }
  const candidate = previewDrawingTween(project, proposal);
  assert.deepEqual(proposal.before, { layerCels: 2, projectStrokes: 2, projectPoints: 4, projectBytes: bytes(project) });
  assert.deepEqual(proposal.after, { layerCels: 3, projectStrokes: 3, projectPoints: 68, projectBytes: bytes(candidate) });
  assert.equal(JSON.stringify(project), original);
  assert.deepEqual(applyDrawingTween(project, proposal), candidate);
  assert.deepEqual(drawing(candidate).cels[0], drawing(project).cels[0]);
  assert.deepEqual(drawing(candidate).cels[2], drawing(project).cels[1]);
  assert.deepEqual(drawing(candidate).keys, drawing(project).keys);
  assert.deepEqual(evaluatePose(candidate.layers[0], 5), evaluatePose(project.layers[0], 5));
});

test('nonidentity correspondence and explicit reversal retain starting paint order and irregular timing', () => {
  const project = source();
  drawing(project).cels[0].strokes = [ink(0, '#000000', 1), ink(100, '#ff0000', 3)];
  drawing(project).cels[1].strokes = [ink(200, '#0000ff', 7), ink(300, '#ffffff', 5)];
  const proposal = buildDrawingTween(project, selection(), { frames: [2, 7], pairs: [
    { startStroke: 0, endStroke: 1, reverseEnd: true }, { startStroke: 1, endStroke: 0, reverseEnd: false }] });
  close(proposal.generated[0].strokes[0].points[0].x, 72.6);
  close(proposal.generated[0].strokes[0].points[63].x, 110.4);
  assert.equal(proposal.generated[0].strokes[0].color, '#333333');
  close(proposal.generated[1].strokes[1].width, 5.8);
  assert.equal(proposal.generated[1].strokes[1].color, '#4d00b3');
  const result = applyDrawingTween(project, proposal);
  assert.deepEqual(drawing(result).cels.at(-1), drawing(project).cels.at(-1));
});

test('generated/source/result graphs are detached and preview cannot mutate the next Apply', () => {
  const project = source(), proposal = buildDrawingTween(project, selection(), { ...choices(), frames: [3, 6] });
  const preview = previewDrawingTween(project, proposal);
  drawing(preview).cels[1].strokes[0].points[0].x = 777;
  drawing(preview).cels[0].strokes[0].points[0].x = 555;
  const result = applyDrawingTween(project, proposal);
  close(drawing(result).cels[1].strokes[0].points[0].x, 30);
  assert.equal(drawing(result).cels[0].strokes[0].points[0].x, 0);
  assert.notEqual(proposal.generated[0].strokes[0].points, proposal.generated[1].strokes[0].points);
  assert.notEqual(drawing(result).cels[1].strokes[0].points, proposal.generated[0].strokes[0].points);
});

test('admission requires adjacent nonblank equal-count vector endpoints and complete explicit pairing', () => {
  const project = source();
  for (const sel of [{ ...selection(), layerId: 'missing' }, { ...selection(), startFrame: 1 }, { ...selection(), endFrame: 11 },
    { ...selection(), extra: 1 }, { ...selection(), startFrame: 10, endFrame: 0 }]) {
    assert.throws(() => buildDrawingTween(project, sel, choices()));
  }
  for (const choice of [{ ...choices(), pairs: [] }, { ...choices(), frames: [] }, { ...choices(), frames: [5, 5] },
    { ...choices(), frames: [7, 2] }, { ...choices(), frames: [0] }, { ...choices(), frames: [10] },
    { ...choices(), frames: [1.5] }, { ...choices(), frames: new Array(1) }, { ...choices(), extra: 1 },
    { ...choices(), pairs: [{ startStroke: 0, endStroke: 1, reverseEnd: false }] },
    { ...choices(), pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false, extra: 1 }] }]) {
    assert.throws(() => buildDrawingTween(project, selection(), choice));
  }
  drawing(project).cels.splice(1, 0, { frame: 3, strokes: [ink()] });
  assert.throws(() => buildDrawingTween(project, selection(), choices()), /adjacent/i);
  drawing(project).cels.splice(1, 1); drawing(project).cels[1].strokes = [];
  assert.throws(() => buildDrawingTween(project, selection(), choices()));
  drawing(project).cels[1].strokes = Array.from({ length: 9 }, () => ink());
  drawing(project).cels[0].strokes = Array.from({ length: 9 }, () => ink());
  assert.throws(() => buildDrawingTween(project, selection(), choices()));
});

test('receipt rejects clones, changes anywhere in public proposal and stale source edits', () => {
  const mutations = [
    (p: ReturnType<typeof buildDrawingTween>) => { p.generated[0].strokes[0].points[0].x++; },
    (p: ReturnType<typeof buildDrawingTween>) => { p.generated[0].strokes[0].color = '#808081'; },
    (p: ReturnType<typeof buildDrawingTween>) => { p.before.projectBytes++; },
    (p: ReturnType<typeof buildDrawingTween>) => { p.choices.pairs[0].reverseEnd = true; },
    (p: ReturnType<typeof buildDrawingTween>) => { p.selection.endFrame = 11; },
  ];
  for (const mutate of mutations) {
    const project = source(), p = buildDrawingTween(project, selection(), choices()); mutate(p);
    assert.throws(() => previewDrawingTween(project, p)); assert.throws(() => applyDrawingTween(project, p));
  }
  const project = source(), p = buildDrawingTween(project, selection(), choices());
  assert.throws(() => applyDrawingTween(project, JSON.parse(JSON.stringify(p))));
  for (const change of [() => { project.title += '!'; }, () => { drawing(project).keys[0].x++; },
    () => { project.background = '#000000'; }, () => { drawing(project).cels[1].strokes[0].points[0].x++; }]) {
    const original = structuredClone(project); change(); assert.throws(() => applyDrawingTween(project, p));
    Object.assign(project, original);
  }
  assert.doesNotThrow(() => applyDrawingTween(structuredClone(project), p));
});

test('modified public shapes and toJSON/accessors cannot hide receipt changes', () => {
  let calls = 0;
  for (const mutate of [
    (p: ReturnType<typeof buildDrawingTween>) => Object.defineProperty(p.generated[0].strokes[0], 'color', { get() { calls++; return '#808080'; } }),
    (p: ReturnType<typeof buildDrawingTween>) => Object.defineProperty(p, 'toJSON', { value() { calls++; return {}; }, enumerable: true }),
    (p: ReturnType<typeof buildDrawingTween>) => Object.defineProperty(p.generated[0].strokes[0].points, 'map', { get() { calls++; return Array.prototype.map; } }),
    (p: ReturnType<typeof buildDrawingTween>) => { Object.assign(p.generated[0], { extra: true }); },
  ]) {
    const project = source(), p = buildDrawingTween(project, selection(), choices()); mutate(p);
    assert.throws(() => applyDrawingTween(project, p));
  }
  assert.equal(calls, 0);
});

function maximum(pairs: number, originalPoints: number, count: number): Project {
  const project = source(); drawing(project).cels[1].frame = 95;
  for (let i = 0; i < 2; i++) drawing(project).cels[i].strokes = Array.from({ length: pairs }, (_, s) => ({
    color: '#123456', width: 3, points: Array.from({ length: originalPoints }, (_, k) => ({ x: k, y: s + i * 100 })) }));
  project.layers.push({ ...structuredClone(drawing(project)), id: 'other', keys: [drawing(project).keys[0]],
    cels: [{ frame: 0, strokes: Array.from({ length: 4 }, () => ({ color: '#abcdef', width: 2,
      points: Array.from({ length: 1000 }, (_, x) => ({ x, y: 0 })) })) }] });
  assert.equal(pairs * 2 * originalPoints + pairs * count * 64 + 4000, 10000);
  return validateProject(project);
}

test('two legal maxima admit exactly100 strokes/10000 points and count originals globally', () => {
  for (const [pairs, points, count, cels] of [[4, 46, 22, 24], [8, 55, 10, 12]]) {
    const project = maximum(pairs, points, count), original = JSON.stringify(project);
    const p = buildDrawingTween(project, { layerId: 'drawing', startFrame: 0, endFrame: 95 }, {
      pairs: Array.from({ length: pairs }, (_, s) => ({ startStroke: s, endStroke: s, reverseEnd: false })), frames: planTweenFrames(0, 95, count) });
    assert.equal(p.after.layerCels, cels); assert.equal(p.after.projectStrokes, 100); assert.equal(p.after.projectPoints, 10000);
    assert.equal(drawing(applyDrawingTween(project, p)).cels.length, cels);
    drawing(project).cels[0].strokes[0].points.push({ x: 0, y: 0 });
    assert.throws(() => buildDrawingTween(project, p.selection, p.choices), /points/i);
    assert.equal(JSON.stringify(project).slice(0, 100), original.slice(0, 100));
  }
});

test('cel and stroke overflows refuse before publication without changing source', () => {
  const project = source(); drawing(project).cels[1].frame = 95;
  drawing(project).cels.push(...Array.from({ length: 22 }, (_, i) => ({ frame: i + 1, strokes: [] }))); drawing(project).cels.sort((a, b) => a.frame - b.frame);
  drawing(project).cels[22].strokes = [ink()];
  const before = JSON.stringify(project);
  assert.throws(() => buildDrawingTween(project, { layerId: 'drawing', startFrame: 22, endFrame: 95 }, { ...choices(), frames: [30] }), /24/);
  assert.equal(JSON.stringify(project), before);
  const strokes = source(); drawing(strokes).cels[0].strokes = [ink()];
  strokes.layers.push({ ...structuredClone(drawing(strokes)), id: 'other', cels: [{ frame: 0, strokes: Array.from({ length: 98 }, () => ink()) }] });
  const original = JSON.stringify(strokes); assert.doesNotThrow(() => validateProject(strokes));
  assert.throws(() => buildDrawingTween(strokes, selection(), choices()), /strokes/i); assert.equal(JSON.stringify(strokes), original);
});

test('complete file-byte overflow is atomic even when artwork quotas permit it', () => {
  const project = source();
  project.layers.push(...Array.from({ length: 4 }, (_, i) => ({ id: `image${i}`, name: 'Image', kind: 'image' as const,
    image: { dataUrl: `data:image/png;base64,${'A'.repeat(1572840)}`, width: 1, height: 1 }, keys: [drawing(project).keys[0]] })));
  const excess = bytes(validateProject({ ...project, layers: [project.layers[0]] }));
  assert.ok(excess > 0);
  const image = project.layers[1]; assert.equal(image.kind, 'image');
  if (image.kind !== 'image') throw new Error('Fixture');
  const shrink = Math.ceil((bytes(project) - MAX_JSON_BYTES + 8) / 4) * 4;
  image.image.dataUrl = image.image.dataUrl.slice(0, -shrink);
  project.title += 'x'.repeat(MAX_JSON_BYTES - bytes(project));
  assert.equal(bytes(project), MAX_JSON_BYTES); assert.doesNotThrow(() => validateProject(project));
  const original = JSON.stringify(project);
  assert.throws(() => buildDrawingTween(project, selection(), choices()), /JSON|MiB|byte/i);
  assert.equal(JSON.stringify(project), original);
});

test('one complete candidate is one reversible history edit and normal schema2 backup', () => {
  const project = source(), history = new History(project), proposal = buildDrawingTween(project, selection(), choices());
  const candidate = applyDrawingTween(project, proposal);
  assert.equal(history.commit(candidate), true); assert.deepEqual(history.current, candidate);
  assert.deepEqual(history.undo(), project); assert.deepEqual(history.redo(), candidate);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(candidate))), candidate);
});
