import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.ts';
import type { DrawingLayer, Project, Stroke } from '../src/model.ts';

const stroke = (x = 1): Stroke => ({ color: '#Ab12Cd', width: 3, points: [{ x, y: 2 }] });
const key = (frame = 0, x = 0) => ({ frame, x, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'linear' as const });
const legacy = () => ({ schemaVersion: 1, title: ' Legacy\ud800 title ', background: '#aBcDeF', frameCount: 48,
  ignored: 'legacy metadata', layers: [{ id: 'drawing', name: ' Legacy name ', kind: 'drawing',
    strokes: [stroke()], keys: [key(), key(30, 300)], ignored: true }] });
function drawing(project: Project, index = 0): DrawingLayer {
  const layer = project.layers[index];
  assert.equal(layer.kind, 'drawing');
  return layer as DrawingLayer;
}
function project(): Project { return model.validateProject(legacy()); }

test('genuine schema1 migration preserves known values and detaches every retained field', () => {
  const input = legacy();
  const before = JSON.stringify(input);
  const result = model.validateProject(input);
  assert.equal(result.schemaVersion, 2);
  assert.equal(model.SCHEMA_VERSION, 2);
  assert.equal(model.MAX_JSON_BYTES, 6 * 1024 * 1024 + 168);
  assert.equal(model.MAX_DRAWING_CELS, 24);
  assert.equal(result.title, input.title);
  assert.equal(result.background, input.background);
  assert.deepEqual(drawing(result).cels, [{ frame: 0, strokes: input.layers[0].strokes }]);
  assert.deepEqual(drawing(result).keys, input.layers[0].keys);
  assert.equal('ignored' in result, false);
  assert.equal('ignored' in drawing(result), false);
  drawing(result).cels[0].strokes[0].points[0].x = 99;
  drawing(result).keys[0].x = 88;
  assert.equal(JSON.stringify(input), before);
});

test('canonical2 rejects mixed versions, unknown shapes and accessors without invoking them', () => {
  const good = project();
  assert.deepEqual(model.validateProject(good), good);
  for (const invalid of [ { ...good, ignored: 1 }, { ...good, schemaVersion: 3 },
    { ...good, layers: [{ ...drawing(good), strokes: [] }] },
    { ...legacy(), layers: [{ ...legacy().layers[0], cels: [] }] },
    { ...good, layers: [{ ...drawing(good), cels: [{ frame: 0, strokes: [], ignored: 1 }] }] },
    { ...good, layers: [{ id: 'image', name: 'Image', kind: 'image', keys: [key()],
      image: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 }, cels: [] }] } ]) {
    assert.throws(() => model.validateProject(invalid));
  }
  let calls = 0;
  const accessor = { ...good };
  Object.defineProperty(accessor, 'title', { enumerable: true, get: () => { calls++; return 'Title'; } });
  assert.throws(() => model.validateProject(accessor));
  assert.equal(calls, 0);
});

test('new drawings and the unchanged original demo have one frame0 cel', () => {
  assert.deepEqual(model.createDrawingLayer().cels, [{ frame: 0, strokes: [] }]);
  const demo = model.createDemo();
  assert.equal(demo.schemaVersion, 2);
  assert.equal(demo.layers.length, 3);
  assert.deepEqual(demo.layers.map(entry => drawing({ ...demo, layers: [entry] }).cels.length), [1, 1, 1]);
  assert.deepEqual(drawing(demo).cels[0].strokes[0].points[0], { x: 180, y: 0 });
  assert.deepEqual(drawing(demo, 2).keys.map(entry => entry.frame), [0, 12, 24, 36, 47]);
});

test('held selection pins exact boundaries, fractional frames and detached return values', () => {
  const input = project();
  drawing(input).cels = [{ frame: 0, strokes: [stroke(1)] }, { frame: 6, strokes: [] }, { frame: 12, strokes: [stroke(3)] }];
  for (const [frame, expected] of [[-20, 0], [0, 0], [5.999, 0], [6, 6], [11.5, 6], [12, 12], [200, 12]]) {
    assert.equal(model.evaluateDrawingCel(drawing(input), frame).frame, expected);
  }
  assert.throws(() => model.evaluateDrawingCel(drawing(input), NaN));
  const detached = model.evaluateDrawingCel(drawing(input), 0);
  detached.strokes[0].points[0].x = 999;
  assert.equal(drawing(input).cels[0].strokes[0].points[0].x, 1);
  assert.equal(model.drawingCelIndex(drawing(input).cels, 11.999), 1);
});

test('cel admission enforces dense ordered first0 arrays and the24 boundary cap', () => {
  const good = project();
  for (const cels of [[], new Array(1), [{ frame: 1, strokes: [] }], [{ frame: 0, strokes: [] }, { frame: 0, strokes: [] }],
    [{ frame: 0, strokes: [] }, { frame: 48, strokes: [] }], [{ frame: 0, strokes: [] }, { frame: 1.5, strokes: [] }],
    [{ frame: 0, strokes: new Array(1) }], [{ frame: 0, strokes: [{ ...stroke(), points: new Array(1) }] }],
    Array.from({ length: 25 }, (_, frame) => ({ frame, strokes: [] }))]) {
    assert.throws(() => model.validateProject({ ...good, layers: [{ ...drawing(good), cels }] }));
  }
  drawing(good).cels = Array.from({ length: 24 }, (_, frame) => ({ frame, strokes: [] }));
  assert.equal(drawing(model.validateProject(good)).cels.length, 24);
  assert.throws(() => model.addBlankDrawingCel(good, 'drawing', 25), /24/);
});

test('blank and duplicate create only new boundaries, with independent full artwork', () => {
  const input = project();
  const before = JSON.stringify(input);
  const copy = model.duplicateDrawingCel(input, 'drawing', 8);
  assert.deepEqual(drawing(copy).cels.map(cel => cel.frame), [0, 8]);
  assert.deepEqual(drawing(copy).cels[1].strokes, drawing(copy).cels[0].strokes);
  drawing(copy).cels[1].strokes[0].points[0].x = 9;
  assert.equal(drawing(copy).cels[0].strokes[0].points[0].x, 1);
  const blank = model.addBlankDrawingCel(copy, 'drawing', 16);
  assert.deepEqual(drawing(blank).cels[2], { frame: 16, strokes: [] });
  assert.deepEqual(blank.layers[0].keys, input.layers[0].keys);
  for (const frame of [0, 8]) {
    assert.throws(() => model.addBlankDrawingCel(copy, 'drawing', frame));
    assert.throws(() => model.duplicateDrawingCel(copy, 'drawing', frame));
  }
  for (const frame of [-1, 1.5, 48, NaN]) assert.throws(() => model.addBlankDrawingCel(input, 'drawing', frame));
  assert.throws(() => model.addBlankDrawingCel(input, 'missing', 1));
  assert.equal(JSON.stringify(input), before);
});

test('replace targets exact existing identity, clear preserves boundary and remove extends prior hold', () => {
  const input = model.addBlankDrawingCel(model.duplicateDrawingCel(project(), 'drawing', 8), 'drawing', 16);
  const replacement = [stroke(7)];
  const changed = model.replaceDrawingCelStrokes(input, 'drawing', 8, replacement);
  replacement[0].points[0].x = 10;
  assert.equal(drawing(changed).cels[1].strokes[0].points[0].x, 7);
  assert.equal(drawing(input).cels[1].strokes[0].points[0].x, 1);
  const clear = model.replaceDrawingCelStrokes(changed, 'drawing', 8, []);
  assert.deepEqual(drawing(clear).cels[1], { frame: 8, strokes: [] });
  const removed = model.removeDrawingCel(changed, 'drawing', 8);
  assert.equal(model.evaluateDrawingCel(drawing(removed), 15).frame, 0);
  assert.equal(model.evaluateDrawingCel(drawing(removed), 16).frame, 16);
  assert.throws(() => model.removeDrawingCel(changed, 'drawing', 0), /first|frame 0/);
  assert.throws(() => model.removeDrawingCel(changed, 'drawing', 9));
  assert.throws(() => model.replaceDrawingCelStrokes(changed, 'drawing', 9, []));
});

test('stored duplicate costs count globally and every failed operation leaves the original untouched', () => {
  const input = project();
  drawing(input).cels[0].strokes = Array.from({ length: 51 }, () => stroke());
  const before = JSON.stringify(input);
  assert.throws(() => model.duplicateDrawingCel(input, 'drawing', 2), /cop|budget/i);
  assert.equal(JSON.stringify(input), before);
  drawing(input).cels[0].strokes = Array.from({ length: 10 }, () => ({ ...stroke(), points: Array.from({ length: 1000 }, () => ({ x: 0, y: 0 })) }));
  assert.doesNotThrow(() => model.validateProject(input));
  assert.throws(() => model.duplicateDrawingCel(input, 'drawing', 2), /cop|budget/i);
  const alias = drawing(input).cels[0].strokes;
  assert.throws(() => model.validateProject({ ...input, layers: [{ ...drawing(input), cels: [{ frame: 0, strokes: alias }, { frame: 1, strokes: alias }] }] }), /points/);
});

test('resize loss covers blank cels and pose keys in layer order; default refuses loss', () => {
  const input = project();
  drawing(input).cels = [{ frame: 0, strokes: [stroke()] }, { frame: 12, strokes: [] }, { frame: 24, strokes: [stroke(2)] }];
  input.layers.push({ ...model.createDrawingLayer(), id: 'second', cels: [{ frame: 0, strokes: [] }, { frame: 40, strokes: [] }], keys: [key(), key(35)] });
  assert.deepEqual(model.timelineResizeLoss(input, 24), { removedCels: [{ layerId: 'drawing', frame: 24 }, { layerId: 'second', frame: 40 }],
    removedKeys: [{ layerId: 'drawing', frame: 30 }, { layerId: 'second', frame: 35 }] });
  const before = JSON.stringify(input);
  assert.throws(() => model.resizeTimeline(input, 24), /discard|later|loss/i);
  const resized = model.resizeTimeline(input, 24, { discardLater: true });
  assert.deepEqual(drawing(resized).cels.map(cel => cel.frame), [0, 12]);
  assert.deepEqual(drawing(resized, 1).cels.map(cel => cel.frame), [0]);
  assert.deepEqual(model.evaluatePose(resized.layers[0], 23), model.evaluatePose(input.layers[0], 23));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(model.timelineResizeLoss(input, 96), { removedCels: [], removedKeys: [] });
  assert.deepEqual(model.resizeTimeline(input, 96).layers, input.layers);
});

test('resize consent does not bypass endpoint capacity, option shape or other bounds', () => {
  const input = project();
  drawing(input).keys = Array.from({ length: 24 }, (_, frame) => key(frame));
  drawing(input).cels.push({ frame: 40, strokes: [] });
  assert.throws(() => model.resizeTimeline(input, 30, { discardLater: true }), /24/);
  for (const options of [null, { discardLater: 1 }, { discardLater: true, ignored: 1 }]) {
    assert.throws(() => model.resizeTimeline(project(), 48, options as { discardLater?: boolean }));
  }
  assert.throws(() => model.timelineResizeLoss(input, 11));
});

test('legacy sixMiB canonical payload gains only its exact migration allowance', () => {
  const input = legacy();
  const drawings = Array.from({ length: 4 }, (_, index) => ({ ...input.layers[0], id: `drawing${index}` }));
  const images = Array.from({ length: 4 }, (_, index) => ({ id: `image${index}`, name: 'Image', kind: 'image',
    image: { dataUrl: `data:image/png;base64,${'A'.repeat(1_572_840)}`, width: 1, height: 1 }, keys: [key()] }));
  const source = { schemaVersion: 1, title: 'Title', background: '#000000', frameCount: 48, layers: [...drawings.map(entry => ({
    id: entry.id, name: entry.name, keys: entry.keys, kind: entry.kind, strokes: entry.strokes })), ...images] };
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const excess = bytes(source) - 6 * 1024 * 1024;
  assert.ok(excess > 0);
  const shrink = Math.ceil(excess / 4) * 4;
  images[0].image.dataUrl = images[0].image.dataUrl.slice(0, -shrink);
  source.title += 'x'.repeat(shrink - excess);
  assert.equal(bytes(source), 6 * 1024 * 1024);
  const output = model.validateProject(source);
  assert.equal(bytes(output), bytes(source) + 4 * 21);
  assert.deepEqual(output.layers.slice(4), images);
  assert.doesNotThrow(() => model.validateProject(output));
  source.title += 'x';
  assert.throws(() => model.validateProject(source), /Legacy.*6 MiB/);
});

test('data arrays cannot execute caller-provided iteration methods or inherited entries', () => {
  const input = project();
  let calls = 0;
  const cels = drawing(input).cels;
  Object.defineProperty(cels, 'map', { get: () => { calls++; return Array.prototype.map; } });
  assert.throws(() => model.validateProject(input));
  assert.equal(calls, 0);
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, { 0: { frame: 0, strokes: [] } });
  assert.throws(() => model.validateProject({ ...project(), layers: [{ ...drawing(project()), cels: inherited }] }));
});
