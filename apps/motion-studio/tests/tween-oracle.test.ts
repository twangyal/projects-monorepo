/** Independent original scalar/graph fixtures, authored before tween producer inspection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import type { Project, DrawingLayer, Stroke, Point } from '../src/model.ts';
import { planTweenFrames, resampleStrokePoints, buildDrawingTween, previewDrawingTween, applyDrawingTween, type TweenProposal } from '../src/tween.ts';

const key = (frame = 0, x = 0) => ({ frame, x, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'linear' as const });
const stroke = (points: Point[], color = '#000000', width = 2): Stroke => ({ points, color, width });
const line = (a: Point, b: Point, color = '#000000', width = 2) => stroke([a, b], color, width);
const clone = <T>(input: T): T => structuredClone(input);
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) <= 1e-10, `${actual} != ${expected}`);
function draw(project: Project, index = 0): DrawingLayer { assert.equal(project.layers[index].kind, 'drawing'); return project.layers[index] as DrawingLayer; }
function original(): Project {
  return { schemaVersion: 2, title: 'Original oracle artwork', background: '#fFeEdD', frameCount: 96, layers: [
    { id: 'paired', name: 'Two explicit paths', kind: 'drawing', keys: [key(0, 123), { ...key(95, 456), y: 98, scale: 2, rotation: 270, opacity: 0.5 }], cels: [
      { frame: 0, strokes: [line({ x: 0, y: 0 }, { x: 63, y: 0 }, '#000001', 2), stroke([{ x: 10, y: -0 }], '#102030', 4)] },
      { frame: 6, strokes: [line({ x: 300, y: 200 }, { x: 363, y: 200 }, '#90B0d0', 8), line({ x: 63, y: 126 }, { x: 0, y: 126 }, '#010200', 10)] },
    ] },
    { id: 'other', name: 'Never touched', kind: 'drawing', keys: [key()], cels: [{ frame: 0, strokes: [stroke([{ x: -9, y: 11 }], '#aBcDef', 3)] }, { frame: 50, strokes: [] }] },
    { id: 'image', name: 'Unrelated image association', kind: 'image', keys: [key(0, 22)], image: { width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==' } },
  ] };
}
const selection = { layerId: 'paired', startFrame: 0, endFrame: 6 };
const choices = { pairs: [{ startStroke: 0, endStroke: 1, reverseEnd: true }, { startStroke: 1, endStroke: 0, reverseEnd: false }], frames: [1, 3, 5] };
const projectJSON = (p: Project) => JSON.stringify(p);

// No general resampler is used to calculate these hand-worked expected positions.
test('floor planning has explicit irregular boundaries and the22-frame endpoint95 maximum', () => {
  assert.deepEqual(planTweenFrames(0, 11, 3), [2, 5, 8]);
  assert.deepEqual(planTweenFrames(2, 15, 4), [4, 7, 9, 12]);
  assert.deepEqual(planTweenFrames(0, 95, 22), [4, 8, 12, 16, 20, 24, 28, 33, 37, 41, 45, 49, 53, 57, 61, 66, 70, 74, 78, 82, 86, 90]);
  assert.deepEqual(planTweenFrames(0, 3, 2), [1, 2]);
  for (const args of [[0, 1, 1], [0, 95, 23], [-1, 8, 1], [0, 96, 1], [0, 6, 1.5], [5, 4, 1], [0, NaN, 1]]) assert.throws(() => planTweenFrames(...args as [number, number, number]));
});

test('unequal-length right angle samples arc distance rather than input vertex index', () => {
  const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 6 }], before = JSON.stringify(points);
  const output = resampleStrokePoints(points);
  assert.equal(output.length, 64);
  for (const [k, x, y] of [[0, 0, 0], [7, 1, 0], [21, 3, 0], [42, 3, 3], [62, 3, 41 / 7], [63, 3, 6]]) { close(output[k].x, x); close(output[k].y, y); }
  assert.equal(JSON.stringify(points), before); output[21].x = 999; assert.equal(points[1].x, 3);
});

test('reversal traverses ending geometry explicitly; repeated knots do not produce NaN', () => {
  const repeated = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 6 }];
  const forward = resampleStrokePoints(repeated), reversed = resampleStrokePoints(repeated, true);
  assert.deepEqual(forward[21], { x: 3, y: 0 });
  for (const [k, x, y] of [[0, 3, 6], [7, 3, 5], [21, 3, 3], [42, 3, 0], [56, 1, 0], [63, 0, 0]]) { close(reversed[k].x, x); close(reversed[k].y, y); }
  assert.ok(forward.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('one-point and all-zero-length paths give64 independent canonical nonnegative-zero records', () => {
  for (const source of [[{ x: -0, y: -0 }], [{ x: -0, y: -0 }, { x: 0, y: 0 }, { x: 0, y: -0 }]]) {
    const output = resampleStrokePoints(source); assert.equal(output.length, 64); assert.equal(new Set(output).size, 64);
    for (const point of output) { assert.equal(Object.is(point.x, -0), false); assert.equal(Object.is(point.y, -0), false); }
    output[0].x = 1; assert.equal(output[1].x, 0); assert.equal(source[0].x, -0);
  }
});

test('resample shape/coordinate admission rejects accessors and sparse/custom/unknown data without invoking getters', () => {
  let called = 0; const getter = { x: 0, y: 0 }; Object.defineProperty(getter, 'x', { enumerable: true, get() { called++; return 0; } });
  const accessorArray = [{ x: 0, y: 0 }]; Object.defineProperty(accessorArray, '0', { enumerable: true, get() { called++; return { x: 0, y: 0 }; } });
  for (const input of [[], new Array(1), [getter], accessorArray, [{ x: 0, y: 0, extra: true }], [Object.create({ x: 0, y: 0 })], [{ x: Infinity, y: 0 }], [{ x: 1281, y: 0 }], [{ x: 0, y: NaN }], Array.from({ length: 1001 }, () => ({ x: 0, y: 0 }))]) assert.throws(() => resampleStrokePoints(input));
  assert.throws(() => resampleStrokePoints([{ x: 0, y: 0 }], 1 as unknown as boolean)); assert.equal(called, 0);
});

test('nonidentity pairing retains starting paint order, encoded RGB half rounding and irregular frame fractions', () => {
  const source = original(), before = projectJSON(source), proposal = buildDrawingTween(source, selection, choices);
  assert.deepEqual(proposal.generated.map(cel => cel.frame), [1, 3, 5]);
  const middle = proposal.generated[1]; assert.equal(middle.strokes[0].color, '#010101'); assert.equal(middle.strokes[1].color, '#506880');
  for (const path of middle.strokes) assert.equal(path.width, 6);
  for (const k of [0, 7, 21, 42, 63]) { close(middle.strokes[0].points[k].x, k); close(middle.strokes[0].points[k].y, 63); close(middle.strokes[1].points[k].x, 155 + k / 2); close(middle.strokes[1].points[k].y, 100); }
  assert.equal(proposal.generated[0].strokes[0].color, '#000001'); assert.equal(proposal.generated[2].strokes[0].color, '#010200');
  close(proposal.generated[0].strokes[0].width, 10 / 3); close(proposal.generated[2].strokes[0].width, 26 / 3);
  close(proposal.generated[0].strokes[0].points[21].y, 21); close(proposal.generated[2].strokes[0].points[21].y, 105);
  assert.equal(projectJSON(source), before);
});

test('preview and Apply keep exact endpoints, poses, title, background, unrelated layers and detached generated cels', () => {
  const source = original(), before = projectJSON(source), proposal = buildDrawingTween(source, selection, choices);
  const preview = previewDrawingTween(source, proposal), applied = applyDrawingTween(source, proposal);
  assert.deepEqual(preview, applied); assert.deepEqual(draw(applied).cels.map(cel => cel.frame), [0, 1, 3, 5, 6]);
  assert.deepEqual(draw(applied).cels[0], draw(source).cels[0]); assert.deepEqual(draw(applied).cels.at(-1), draw(source).cels[1]);
  assert.deepEqual(draw(applied).keys, draw(source).keys); assert.deepEqual(applied.layers.slice(1), source.layers.slice(1));
  assert.equal(applied.title, source.title); assert.equal(applied.background, source.background);
  draw(preview).cels[1].strokes[0].points[0].x = 888;
  assert.notEqual(draw(applied).cels[1].strokes[0].points[0].x, 888); assert.notEqual(proposal.generated[0].strokes[0].points[0].x, 888);
  const allPoints = proposal.generated.flatMap(cel => cel.strokes.flatMap(path => path.points)); assert.equal(new Set(allPoints).size, 3 * 2 * 64);
  draw(applied).cels[1].strokes[0].points[0].y = 333;
  assert.notEqual(draw(applied).cels[2].strokes[0].points[0].y, 333); assert.equal(projectJSON(source), before);
});

test('malformed pair permutations, nonadjacent endpoints and unordered/noninterior frames refuse atomically', () => {
  const source = original(), before = projectJSON(source);
  const malformed = [ { ...choices, pairs: [choices.pairs[1], choices.pairs[0]] }, { ...choices, pairs: [choices.pairs[0], { ...choices.pairs[1], endStroke: 1 }] }, { ...choices, pairs: [] }, { ...choices, pairs: new Array(2) }, { ...choices, pairs: [{ ...choices.pairs[0], unknown: true }, choices.pairs[1]] }, { ...choices, frames: [3, 1] }, { ...choices, frames: [1, 1] }, { ...choices, frames: [0] }, { ...choices, frames: [6] }, { ...choices, frames: [1.5] } ];
  for (const bad of malformed) assert.throws(() => buildDrawingTween(source, selection, bad));
  assert.throws(() => buildDrawingTween(source, { ...selection, layerId: 'image' }, choices));
  assert.throws(() => buildDrawingTween(source, { ...selection, endFrame: 7 }, choices));
  const intervening = clone(source); draw(intervening).cels.splice(1, 0, { frame: 2, strokes: clone(draw(source).cels[0].strokes) });
  assert.throws(() => buildDrawingTween(intervening, selection, choices));
  assert.equal(projectJSON(source), before);
});

test('zero or unequal endpoint strokes cannot fabricate partial stroke correspondence', () => {
  for (const count of [0, 1, 9]) {
    const source = original(); draw(source).cels[1].strokes = Array.from({ length: count }, () => stroke([{ x: 0, y: 0 }]));
    const before = projectJSON(source); assert.throws(() => buildDrawingTween(source, selection, choices)); assert.equal(projectJSON(source), before);
  }
});

test('cloned and forged receipts are never trusted even when all visible data is identical', () => {
  const source = original(), proposal = buildDrawingTween(source, selection, choices), before = projectJSON(source);
  for (const forged of [clone(proposal), JSON.parse(JSON.stringify(proposal)) as TweenProposal, { ...proposal }]) {
    assert.throws(() => previewDrawingTween(source, forged)); assert.throws(() => applyDrawingTween(source, forged));
  }
  assert.equal(projectJSON(source), before);
});

test('receipt pins every public field and whole current source, with atomic failed Apply', () => {
  const source = original();
  const changes: ((p: TweenProposal) => void)[] = [p => { p.generated[0].strokes[0].color = '#000000'; }, p => { p.generated[0].strokes[0].points[1].x += 1; }, p => { p.generated[0].strokes[0].width += 1; }, p => { p.choices.pairs[0].reverseEnd = false; }, p => { p.before.projectBytes += 1; }, p => { p.selection.layerId = 'other'; }];
  for (const change of changes) { const proposal = buildDrawingTween(source, selection, choices); change(proposal); assert.throws(() => applyDrawingTween(source, proposal)); }
  const mutations: ((p: Project) => void)[] = [p => { p.title += '!'; }, p => { p.background = '#ffffff'; }, p => { draw(p).keys[1].x += 1; }, p => { draw(p, 1).cels[0].strokes[0].color = '#123456'; }, p => { p.layers.reverse(); }];
  for (const mutate of mutations) { const proposal = buildDrawingTween(source, selection, choices), current = clone(source); mutate(current); const before = projectJSON(current); assert.throws(() => applyDrawingTween(current, proposal)); assert.equal(projectJSON(current), before); }
});

test('edited proposal accessors/cycles are rejected before getter or JSON serialization side effects', () => {
  const source = original(); let getters = 0;
  const proposal = buildDrawingTween(source, selection, choices); Object.defineProperty(proposal.generated[0], 'frame', { enumerable: true, get() { getters++; return 1; } });
  assert.throws(() => applyDrawingTween(source, proposal)); assert.equal(getters, 0);
  const cycle = buildDrawingTween(source, selection, choices); cycle.generated[0].strokes[0].points[0].x = cycle as unknown as number;
  assert.throws(() => previewDrawingTween(source, cycle));
});

function maximum(pairs: number, endpointPoints: number): Project {
  const source = original(); source.layers = source.layers.slice(0, 2);
  draw(source).cels = [0, 95].map(frame => ({ frame, strokes: Array.from({ length: pairs }, (_, index) => stroke(Array.from({ length: endpointPoints }, (_, point) => ({ x: point + (frame ? 126 : 0), y: index * 100 + (frame ? 63 : 0) })), '#102030', 2)) }));
  draw(source, 1).cels = [{ frame: 0, strokes: Array.from({ length: 4 }, (_, index) => stroke(Array.from({ length: 1000 }, (_, point) => ({ x: point, y: index })), '#abcdef', 1)) }];
  return source;
}
const maxFrames = [4, 8, 12, 16, 20, 24, 28, 33, 37, 41, 45, 49, 53, 57, 61, 66, 70, 74, 78, 82, 86, 90];
const identityPairs = (count: number) => Array.from({ length: count }, (_, index) => ({ startStroke: index, endStroke: index, reverseEnd: false }));
const maxSelection = { layerId: 'paired', startFrame: 0, endFrame: 95 };

test('combined24-cel/100-stroke/10,000-point graph has hand-predicted collinear samples, exact usage and unchanged outside graph', () => {
  const source = maximum(4, 46), before = projectJSON(source), proposal = buildDrawingTween(source, maxSelection, { pairs: identityPairs(4), frames: maxFrames });
  assert.deepEqual([proposal.before.layerCels, proposal.before.projectStrokes, proposal.before.projectPoints], [2, 12, 4368]);
  assert.deepEqual([proposal.after.layerCels, proposal.after.projectStrokes, proposal.after.projectPoints], [24, 100, 10000]);
  const applied = applyDrawingTween(source, proposal); assert.equal(draw(applied).cels.length, 24); assert.deepEqual(applied.layers[1], source.layers[1]);
  assert.equal(proposal.after.projectBytes, new TextEncoder().encode(projectJSON(applied)).length);
  for (const cel of proposal.generated) for (const [index, path] of cel.strokes.entries()) {
    assert.equal(path.points.length, 64); for (const k of [0, 21, 42, 63]) { close(path.points[k].x, 45 * k / 63 + 126 * cel.frame / 95); close(path.points[k].y, index * 100 + 63 * cel.frame / 95); }
  }
  assert.equal(projectJSON(source), before);
});

test('separate8-pair maximum reaches100 strokes/10,000 points with12 cels rather than falsely claiming24', () => {
  const source = maximum(8, 55), frames = [8, 16, 24, 32, 40, 48, 56, 64, 72, 80];
  const proposal = buildDrawingTween(source, maxSelection, { pairs: identityPairs(8), frames });
  assert.deepEqual([proposal.before.projectStrokes, proposal.before.projectPoints], [20, 4880]);
  assert.deepEqual([proposal.after.layerCels, proposal.after.projectStrokes, proposal.after.projectPoints], [12, 100, 10000]);
  const applied = applyDrawingTween(source, proposal); assert.equal(draw(applied).cels.length, 12);
  for (const k of [0, 21, 63]) close(proposal.generated[5].strokes[7].points[k].x, 54 * k / 63 + 126 * 48 / 95);
});

test('plus-one point/stroke/cel aggregate admission refuses complete proposal without reducing requested frames', () => {
  const source = maximum(4, 46), opts = { pairs: identityPairs(4), frames: maxFrames };
  const pointOver = clone(source); draw(pointOver).cels[0].strokes[0].points.push({ x: 46, y: 0 });
  const strokeOver = clone(source); draw(strokeOver, 1).cels[0].strokes[0].points.pop(); draw(strokeOver, 1).cels[0].strokes.push(stroke([{ x: 0, y: 0 }]));
  const celOver = clone(source); draw(celOver).cels[0].frame = 1; draw(celOver).cels.unshift({ frame: 0, strokes: [] });
  for (const [current, selected] of [[pointOver, maxSelection], [strokeOver, maxSelection], [celOver, { ...maxSelection, startFrame: 1 }]] as const) {
    const before = projectJSON(current); assert.throws(() => buildDrawingTween(current, selected, opts)); assert.equal(projectJSON(current), before); assert.deepEqual(opts.frames, maxFrames);
  }
});

// Actual original PNG bytes, with valid safe ancillary padding; this is a pure
// UTF-8 candidate-cap test, not a native decode or maximum-memory claim.
function paddedPng(): string {
  const crc = (bytes: Uint8Array) => { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, body: Buffer): Buffer => { const result = Buffer.alloc(body.length + 12); result.writeUInt32BE(body.length); result.write(type, 4); body.copy(result, 8); result.writeUInt32BE(crc(result.subarray(4, body.length + 8)), body.length + 8); return result; };
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const prefix = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)]);
  const pixels = chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), end = chunk('IEND', Buffer.alloc(0));
  const bytes = Buffer.concat([prefix, chunk('paDd', Buffer.alloc(1_143_750 - prefix.length - pixels.length - end.length - 12)), pixels, end]);
  assert.equal(bytes.length, 1_143_750);
  return 'data:image/png;base64,' + bytes.toString('base64');
}

test('complete valid source can fit the byte cap while its full requested candidate must be refused atomically', () => {
  const source = maximum(4, 46), dataUrl = paddedPng();
  for (let i = 0; i < 4; i++) source.layers.push({ id: `png${i}`, name: `Independent padded PNG ${i}`, kind: 'image', keys: [key()], image: { width: 1, height: 1, dataUrl } });
  const sourceRaw = projectJSON(source), cap = 6_291_624;
  assert.ok(new TextEncoder().encode(sourceRaw).length < cap);
  // Closed-form collinear positions bypass the production segment scanner.
  const predicted = clone(source);
  const cels = maxFrames.map(frame => ({ frame, strokes: Array.from({ length: 4 }, (_, index) => stroke(Array.from({ length: 64 }, (_, k) => ({ x: 45 * k / 63 + 126 * frame / 95, y: index * 100 + 63 * frame / 95 })), '#102030', 2)) }));
  draw(predicted).cels.splice(1, 0, ...cels);
  assert.ok(new TextEncoder().encode(projectJSON(predicted)).length > cap);
  assert.throws(() => buildDrawingTween(source, maxSelection, { pairs: identityPairs(4), frames: maxFrames }));
  assert.equal(projectJSON(source), sourceRaw);
});

// Original targeted probe found x=1280.0000000000002 at sample5/9.
test('constant legal coordinate boundaries remain exact through nonzero-path sampling and tweening', () => {
  for (const x of [-1280, 1280]) {
    const points = [{ x, y: 0 }, { x, y: 63 }], sampled = resampleStrokePoints(points);
    assert.equal(sampled[5].x, x); assert.equal(sampled[9].x, x);
    assert.ok(sampled.every(point => point.x === x));
    const source = original(); source.layers = source.layers.slice(0, 1);
    draw(source).cels = [0, 2].map(frame => ({ frame, strokes: [stroke(clone(points))] }));
    const proposal = buildDrawingTween(source, { layerId: 'paired', startFrame: 0, endFrame: 2 }, { pairs: identityPairs(1), frames: [1] });
    assert.ok(proposal.generated[0].strokes[0].points.every(point => point.x === x));
  }
});

// Separate original width-only probe found40.00000000000001 at t=1/7.
test('constant maximum brush width40 remains exactly40 at a nonbinary frame fraction', () => {
  const source = original(); source.layers = source.layers.slice(0, 1);
  draw(source).cels = [0, 7].map(frame => ({ frame, strokes: [line({ x: 0, y: 0 }, { x: 0, y: 63 }, '#000000', 40)] }));
  const proposal = buildDrawingTween(source, { layerId: 'paired', startFrame: 0, endFrame: 7 }, { pairs: identityPairs(1), frames: [1] });
  assert.equal(proposal.generated[0].strokes[0].width, 40);
});
