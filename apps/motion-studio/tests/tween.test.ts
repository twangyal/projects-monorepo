import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingLayer, MAX_JSON_BYTES, validateProject, type DrawingLayer, type Point, type Project, type Stroke } from '../src/model.ts';
import { History } from '../src/history.ts';
import { applyDrawingTween, buildDrawingTween, MAX_TWEEN_PAIRS, planTweenFrames, previewDrawingTween, resampleStrokePoints, TWEEN_SAMPLES, type TweenChoices, type TweenProposal } from '../src/tween.ts';

const line = (y = 0, color = '#000000', width = 2): Stroke => ({ color, width, points: [{ x: 0, y }, { x: 63, y }] });
function fixture(): Project {
  const layer = createDrawingLayer(); layer.id = 'drawing'; layer.name = 'Literal endpoints';
  layer.cels = [{ frame: 0, strokes: [line()] }, { frame: 10, strokes: [line(10, '#ffffff', 4)] }];
  return validateProject({ schemaVersion: 2, title: 'Tween', background: '#ffffff', frameCount: 96, layers: [layer] });
}
const selection = { layerId: 'drawing', startFrame: 0, endFrame: 10 };
const choices = (frames = [5]): TweenChoices => ({ pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames });
const drawing = (p: Project): DrawingLayer => p.layers[0] as DrawingLayer;
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} versus ${expected}`); }

test('frame planning is exact floor distribution, with strict finite integer bounds', () => {
  assert.equal(TWEEN_SAMPLES, 64); assert.equal(MAX_TWEEN_PAIRS, 8);
  assert.deepEqual(planTweenFrames(0, 5, 2), [1, 3]);
  assert.deepEqual(planTweenFrames(7, 11, 3), [8, 9, 10]);
  assert.deepEqual(planTweenFrames(0, 95, 22), Array.from({ length: 22 }, (_, i) => Math.floor((i + 1) * 95 / 23)));
  for (const [a, b, n] of [[0, 1, 1], [1, 1, 1], [-1, 5, 1], [0, 96, 1], [0, 5, 0], [0, 95, 23], [0, 5, 1.5], [NaN, 5, 1], [0, Infinity, 1]]) assert.throws(() => planTweenFrames(a, b, n));
});

test('64 arc-length samples preserve endpoints and weight unequal segments rather than vertices', () => {
  const input = [{ x: 0, y: 0 }, { x: 21, y: 0 }, { x: 21, y: 42 }];
  const output = resampleStrokePoints(input);
  assert.equal(output.length, 64);
  assert.deepEqual(output[0], input[0]); assert.deepEqual(output[63], input[2]);
  assert.deepEqual(output[21], { x: 21, y: 0 });
  close(output[42].x, 21); close(output[42].y, 21);
  output[0].x = 999; assert.equal(input[0].x, 0);
  const reverse = resampleStrokePoints(input, true);
  assert.deepEqual(reverse[0], input[2]); assert.deepEqual(reverse[63], input[0]);
  close(reverse[21].y, 21);
});

test('repeated zero segments and single-point paths produce finite independent samples without negative zero', () => {
  const output = resampleStrokePoints([{ x: -0, y: -0 }, { x: 0, y: 0 }]);
  assert.equal(output.length, 64);
  for (const point of output) { assert.deepEqual(point, { x: 0, y: 0 }); assert.equal(Object.is(point.x, -0), false); }
  output[0].x = 1; assert.equal(output[1].x, 0);
  assert.deepEqual(resampleStrokePoints([{ x: 4, y: 5 }], true), Array.from({ length: 64 }, () => ({ x: 4, y: 5 })));
  const repeated = resampleStrokePoints([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 63, y: 0 }, { x: 63, y: 0 }]);
  close(repeated[31].x, 31); assert.deepEqual(repeated[63], { x: 63, y: 0 });
});

test('sampling rejects malformed arrays and point accessors without executing them', () => {
  assert.equal(resampleStrokePoints([{ x: 0, y: 0 }]).length, 64);
  let reads = 0; const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { reads++; return 0; } });
  Object.defineProperty(getter, 'y', { enumerable: true, value: 0 });
  const arrayGetter: Point[] = []; Object.defineProperty(arrayGetter, '0', { enumerable: true, get() { reads++; return { x: 0, y: 0 }; } });
  for (const points of [[], new Array(1), arrayGetter, [getter], [{ x: 0, y: 0, extra: true }], [{ x: Infinity, y: 0 }], [{ x: 1281, y: 0 }], [Object.create({ x: 0, y: 0 })], Array.from({ length: 1001 }, () => ({ x: 0, y: 0 }))]) assert.throws(() => resampleStrokePoints(points as Point[]));
  assert.equal(reads, 0);
  assert.throws(() => resampleStrokePoints([{ x: 0, y: 0 }], 1 as unknown as boolean));
});

test('review interpolation admits before/after usage and preserves exact source endpoints and poses', () => {
  const base = fixture(), original = structuredClone(base);
  drawing(base).keys.push({ ...drawing(base).keys[0], frame: 10, x: 500, rotation: 30 });
  const before = structuredClone(base);
  const proposal = buildDrawingTween(base, selection, choices([3, 5, 7]));
  assert.deepEqual(proposal.generated.map(cel => cel.frame), [3, 5, 7]);
  assert.equal(proposal.generated[1].strokes[0].color, '#808080'); assert.equal(proposal.generated[1].strokes[0].width, 3);
  close(proposal.generated[1].strokes[0].points[42].x, 42); close(proposal.generated[1].strokes[0].points[42].y, 5);
  assert.equal(proposal.before.projectPoints, 4); assert.equal(proposal.after.projectPoints, 196);
  assert.equal(proposal.before.layerCels, 2); assert.equal(proposal.after.layerCels, 5);
  const preview = previewDrawingTween(base, proposal), applied = applyDrawingTween(base, proposal);
  assert.deepEqual(preview, applied); assert.deepEqual(base, before);
  assert.deepEqual(drawing(applied).cels[0], drawing(original).cels[0]); assert.deepEqual(drawing(applied).cels.at(-1), drawing(original).cels[1]);
  assert.deepEqual(drawing(applied).keys, drawing(base).keys);
  assert.equal(proposal.after.projectBytes, new TextEncoder().encode(JSON.stringify(applied)).length);
  drawing(preview).cels[1].strokes[0].points[0].y = 999;
  assert.equal(drawing(applied).cels[1].strokes[0].points[0].y, 3);
  assert.equal(proposal.generated[0].strokes[0].points[0].y, 3);
});

test('explicit nonidentity pairing and reversal keep starting paint order', () => {
  const base = fixture(); drawing(base).cels[0].strokes.push(line(20, '#010101', 6));
  drawing(base).cels[1].strokes.unshift(line(30, '#020202', 10));
  const paired = { pairs: [{ startStroke: 0, endStroke: 1, reverseEnd: true }, { startStroke: 1, endStroke: 0, reverseEnd: false }], frames: [5] };
  const proposal = buildDrawingTween(base, selection, paired);
  assert.equal(proposal.generated[0].strokes.length, 2);
  close(proposal.generated[0].strokes[0].points[0].x, 31.5);
  assert.equal(proposal.generated[0].strokes[1].width, 8);
  assert.equal(proposal.generated[0].strokes[1].color, '#020202');
  assert.equal(drawing(applyDrawingTween(base, proposal)).cels.at(-1)!.strokes[0].color, '#020202');
});

test('adjacency, blank/mismatched endpoints, missing layer, strict interior frames and exact pairing reject atomically', () => {
  const base = fixture(), before = JSON.stringify(base);
  buildDrawingTween(base, selection, choices());
  for (const selected of [{ ...selection, endFrame: 9 }, { ...selection, startFrame: 1 }, { ...selection, layerId: 'missing' }, { ...selection, extra: true }]) assert.throws(() => buildDrawingTween(base, selected, choices()));
  for (const selectedChoices of [{ ...choices(), frames: [] }, choices([0]), choices([10]), choices([5, 5]), choices([7, 3]), choices([4.5]), { ...choices(), extra: true }, { ...choices(), pairs: [] }, { ...choices(), pairs: [{ startStroke: 0, endStroke: 1, reverseEnd: false }] }, { ...choices(), pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: 0 }] }]) assert.throws(() => buildDrawingTween(base, selection, selectedChoices as TweenChoices));
  for (const edit of [(p: Project) => drawing(p).cels.splice(1, 0, { frame: 5, strokes: [] }), (p: Project) => { drawing(p).cels[1].strokes = []; }, (p: Project) => drawing(p).cels[1].strokes.push(line())]) {
    const changed = structuredClone(base); edit(changed); assert.throws(() => buildDrawingTween(changed, selection, choices()));
  }
  assert.equal(JSON.stringify(base), before);
});

test('source, choices, proposed cels and separate returned candidates never share mutable arrays', () => {
  const base = fixture(), request = choices([2, 4]), selected = { ...selection };
  const proposal = buildDrawingTween(base, selected, request);
  request.frames[0] = 8; request.pairs[0].reverseEnd = true; selected.endFrame = 20;
  assert.deepEqual(proposal.choices.frames, [2, 4]); assert.equal(proposal.choices.pairs[0].reverseEnd, false); assert.equal(proposal.selection.endFrame, 10);
  const a = applyDrawingTween(base, proposal), b = applyDrawingTween(base, proposal);
  drawing(a).cels[1].strokes[0].points[0].x = 123;
  assert.equal(drawing(b).cels[1].strokes[0].points[0].x, 0);
  proposal.generated[0].strokes[0].points[0].x = 999;
  assert.equal(proposal.generated[1].strokes[0].points[0].x, 0);
  assert.equal(drawing(base).cels[0].strokes[0].points[0].x, 0);
});

test('private receipt rejects JSON clones, changed public fields and stale source, without changing current state', () => {
  const base = fixture(), before = JSON.stringify(base), proposal = buildDrawingTween(base, selection, choices());
  assert.throws(() => applyDrawingTween(base, JSON.parse(JSON.stringify(proposal))));
  for (const edit of [(p: TweenProposal) => { p.after.projectBytes++; }, (p: TweenProposal) => { p.generated[0].strokes[0].color = '#808081'; }, (p: TweenProposal) => { p.generated[0].strokes[0].points[0].x = -0; }, (p: TweenProposal) => { Object.assign(p, { extra: true }); }]) {
    const fresh = buildDrawingTween(base, selection, choices()); edit(fresh);
    assert.throws(() => previewDrawingTween(base, fresh)); assert.throws(() => applyDrawingTween(base, fresh));
  }
  for (const edit of [(p: Project) => { p.title += ' changed'; }, (p: Project) => { drawing(p).keys[0].opacity = 0; }, (p: Project) => { drawing(p).cels[0].strokes[0].color = '#ABCDEF'; }]) {
    const changed = structuredClone(base); edit(changed);
    assert.throws(() => applyDrawingTween(changed, proposal));
  }
  assert.equal(JSON.stringify(base), before);
});

test('Apply is one existing history edit and redo preserves the complete ordinary project', () => {
  const base = fixture(), history = new History(base), proposal = buildDrawingTween(base, selection, choices([2, 8]));
  const applied = applyDrawingTween(history.current, proposal);
  assert.equal(history.canUndo, false); history.commit(applied);
  assert.deepEqual(history.undo(), base); assert.deepEqual(history.redo(), applied);
});

function maximum(pairs: number, endpointPoints: number): Project {
  const base = fixture(), chosen = drawing(base);
  chosen.cels = [0, 95].map(frame => ({ frame, strokes: Array.from({ length: pairs }, (_, index) => ({ color: '#010203', width: 2, points: Array.from({ length: endpointPoints }, (_, i) => ({ x: i, y: index + frame })) })) }));
  const other = createDrawingLayer(); other.id = 'other'; other.cels[0].strokes = Array.from({ length: 4 }, () => ({ color: '#020304', width: 2, points: Array.from({ length: 1000 }, (_, i) => ({ x: i, y: 0 })) }));
  base.layers.push(other); return validateProject(base);
}
function maximumChoices(pairs: number, count: number): TweenChoices {
  return { pairs: Array.from({ length: pairs }, (_, index) => ({ startStroke: index, endStroke: index, reverseEnd: false })), frames: planTweenFrames(0, 95, count) };
}

test('24 cels,100 strokes and10000 points admit exactly and one extra retained point fails atomically', () => {
  const base = maximum(4, 46), selected = { ...selection, endFrame: 95 };
  const proposal = buildDrawingTween(base, selected, maximumChoices(4, 22));
  assert.equal(proposal.after.layerCels, 24); assert.equal(proposal.after.projectStrokes, 100); assert.equal(proposal.after.projectPoints, 10000);
  assert.equal(drawing(applyDrawingTween(base, proposal)).cels.length, 24);
  const extraPoint = structuredClone(base); drawing(extraPoint).cels[0].strokes[0].points.push({ x: 0, y: 0 });
  assert.throws(() => buildDrawingTween(extraPoint, selected, maximumChoices(4, 22)));
  assert.equal(drawing(base).cels.length, 2);
});

test('eight pairs have their own exact global maximum and nine never become an implicit subset', () => {
  const base = maximum(8, 55), selected = { ...selection, endFrame: 95 };
  const proposal = buildDrawingTween(base, selected, maximumChoices(8, 10));
  assert.equal(proposal.after.projectStrokes, 100); assert.equal(proposal.after.projectPoints, 10000);
  const tooMany = fixture(); drawing(tooMany).cels.forEach(cel => { cel.strokes = Array.from({ length: 9 }, () => line()); });
  assert.throws(() => buildDrawingTween(tooMany, selection, maximumChoices(9, 1)));
  assert.throws(() => buildDrawingTween(base, selected, maximumChoices(8, 11)));
});

test('candidate byte ceiling is exact UTF8; oversized candidate cannot mutate an admitted smaller source', () => {
  const base = fixture(), pngPrefix = 'data:image/png;base64,';
  for (let i = 0; i < 4; i++) base.layers.push({ id: `image${i}`, name: 'Image', kind: 'image', keys: structuredClone(drawing(base).keys), image: { dataUrl: pngPrefix + 'AAAA', width: 1, height: 1 } });
  let remaining = MAX_JSON_BYTES - buildDrawingTween(base, selection, choices()).after.projectBytes;
  for (const layer of base.layers) if (layer.kind === 'image') {
    const padding = Math.min(Math.floor((1.5 * 1024 * 1024 - layer.image.dataUrl.length) / 4) * 4, Math.floor(remaining / 4) * 4);
    layer.image.dataUrl += 'A'.repeat(padding); remaining -= padding;
  }
  assert.ok(remaining < 4); base.title += 'x'.repeat(remaining);
  const proposal = buildDrawingTween(base, selection, choices()); assert.equal(proposal.after.projectBytes, MAX_JSON_BYTES);
  assert.equal(new TextEncoder().encode(JSON.stringify(applyDrawingTween(base, proposal))).length, MAX_JSON_BYTES);
  base.title += 'x'; validateProject(base); const original = JSON.stringify(base);
  assert.throws(() => buildDrawingTween(base, selection, choices())); assert.equal(JSON.stringify(base), original);
});
