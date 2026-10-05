/** Literal independent #122 expectations frozen before stroke-edit producer inspection. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import type { Project, DrawingLayer, Stroke } from '../src/model.ts';
import { hitStroke, translateStroke, setStrokeAppearance, deleteStroke } from '../src/stroke-edit.ts';

const clone = <T>(value: T): T => structuredClone(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const drawing = (project: Project, index = 0) => project.layers[index] as DrawingLayer;
const target = { layerId: 'original-lines', celFrame: 0, strokeIndex: 1 };
const paths: Stroke[] = [
  { color: '#ff0000', width: 4, points: [{ x: -0, y: 0 }, { x: 20, y: 0 }] },
  { color: '#0000ff', width: 2, points: [{ x: 10, y: 0 }, { x: 30, y: 0 }] },
  { color: '#00ff00', width: 6, points: [{ x: 50, y: 10 }] },
  { color: '#112233', width: 4, points: [{ x: 60, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 10 }] },
];

// Original PNG: literal RGBA(23,45,67,255), hand-assembled chunk layout/CRC.
// Optional tEXt padding is inert real PNG metadata, not expected producer output.
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, body: Buffer): Buffer {
  const kind = Buffer.from(name), result = Buffer.alloc(body.length + 12);
  result.writeUInt32BE(body.length); kind.copy(result, 4); body.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([kind, body])), body.length + 8);
  return result;
}
function originalPng(padding = 0): string {
  const header = Buffer.from('00000001000000010806000000', 'hex');
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header)];
  if (padding) parts.push(chunk('tEXt', Buffer.concat([Buffer.from('Original\0'), Buffer.alloc(padding, 120)])));
  parts.push(chunk('IDAT', deflateSync(Buffer.from([0, 23, 45, 67, 255]))), chunk('IEND', Buffer.alloc(0)));
  return 'data:image/png;base64,' + Buffer.concat(parts).toString('base64');
}
function original(): Project {
  return {
    schemaVersion: 2, title: 'Literal retained artwork', background: '#FfEeDd', frameCount: 24,
    layers: [
      { id: 'original-lines', name: 'Selected drawing', kind: 'drawing', keys: [
        { frame: 0, x: 200, y: 100, scale: 2, rotation: 90, opacity: 1, easing: 'linear' },
        { frame: 23, x: 221, y: 133, scale: .1, rotation: 450, opacity: .25, easing: 'hold' },
      ], cels: [{ frame: 0, strokes: clone(paths) }, { frame: 8, strokes: clone(paths) }] },
      { id: 'untouched', name: 'Other drawing', kind: 'drawing', keys: [
        { frame: 0, x: 15, y: -12, scale: 4, rotation: -90, opacity: 0, easing: 'ease' },
      ], cels: [{ frame: 0, strokes: [{ color: '#AbCdEf', width: 40, points: [{ x: -9, y: 11 }] }] }, { frame: 17, strokes: [] }] },
      { id: 'original-image', name: 'Original literal pixel', kind: 'image', keys: [
        { frame: 0, x: 33, y: 44, scale: 1, rotation: 0, opacity: .75, easing: 'linear' },
      ], image: { dataUrl: originalPng(), width: 1, height: 1 } },
    ],
  };
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { for (const entry of Object.values(value)) frozen(entry); Object.freeze(value); }
  return value;
}

// Expected choices are literal, never calculated by a production geometry helper.
test('reverse paint order selects the later overlapping retained path and never mutates query input', () => {
  const source = frozen(clone(paths)), point = frozen({ x: 15, y: 0 }), before = clone(source);
  assert.equal(hitStroke(source, point, 0), 1);
  assert.equal(hitStroke(source, { x: 5, y: 0 }, 0), 0);
  assert.equal(hitStroke(source, { x: 25, y: 0 }, 0), 1);
  assert.equal(hitStroke(source, { x: 35, y: 35 }, 0), null);
  assert.equal(hitStroke([], point, 6), null);
  assert.deepEqual(source, before); assert.deepEqual(point, { x: 15, y: 0 });
});

test('round caps and inclusive half-width plus padding accept exact edge but refuse epsilon beyond', () => {
  const line: Stroke[] = [{ color: '#ff0000', width: 10, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }];
  for (const point of [{ x: -3, y: 4 }, { x: 13, y: 4 }, { x: 5, y: 5 }]) assert.equal(hitStroke(line, point, 0), 0);
  for (const point of [{ x: -3, y: 4.00000001 }, { x: 13, y: 4.00000001 }, { x: 5, y: 5.00000001 }]) assert.equal(hitStroke(line, point, 0), null);
  assert.equal(hitStroke(line, { x: 5, y: 11 }, 6), 0);
  assert.equal(hitStroke(line, { x: 5, y: 11.00000001 }, 6), null);
});

test('one-point, all-coincident and partly repeated polylines remain circular round targets', () => {
  assert.equal(hitStroke(paths, { x: 53, y: 10 }, 0), 2);
  assert.equal(hitStroke(paths, { x: 53.00000001, y: 10 }, 0), null);
  assert.equal(hitStroke(paths, { x: 62, y: 10 }, 0), 3);
  assert.equal(hitStroke(paths, { x: 62.00000001, y: 10 }, 0), null);
  const repeated: Stroke[] = [{ color: '#123456', width: 2, points: [
    { x: 70, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 10 }, { x: 70, y: 10 },
  ] }];
  assert.equal(hitStroke(repeated, { x: 70, y: -1 }, 0), 0);
  assert.equal(hitStroke(repeated, { x: 71, y: 5 }, 0), 0);
  assert.equal(hitStroke(repeated, { x: 70, y: 11.00000001 }, 0), null);
});

test('nonfinite or negative query admission rejects before changing any retained data', () => {
  const source = frozen(clone(paths)), before = clone(source);
  for (const point of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -Infinity, y: 0 }]) assert.throws(() => hitStroke(source, point, 6));
  for (const padding of [-1, NaN, Infinity]) assert.throws(() => hitStroke(source, { x: 0, y: 0 }, padding));
  assert.deepEqual(source, before);
});

test('literal inverse-pose displacement changes only one exact cel path and returns detached full graph', () => {
  // Pose(200,100,2,90): local(10,5) -> stage(190,120); stage(+20,-10) -> local(-5,-10).
  // The oracle supplies that independently worked delta, never model.localPoint.
  const source = frozen(original()), before = clone(source), choice = frozen({ ...target }), delta = frozen({ x: -5, y: -10 });
  const expected = original();
  drawing(expected).cels[0].strokes[1] = { color: '#0000ff', width: 2, points: [{ x: 5, y: -10 }, { x: 25, y: -10 }] };
  const actual = translateStroke(source, choice, delta);
  assert.deepEqual(actual, expected); assert.deepEqual(source, before);
  assert.deepEqual(choice, target); assert.deepEqual(delta, { x: -5, y: -10 });
  drawing(actual).cels[1].strokes[0].points[0].x = 999;
  assert.equal(drawing(source).cels[1].strokes[0].points[0].x, -0);
  assert.equal(drawing(actual).cels[0].strokes[0].points[0].x, -0);
});

test('exact later cel target never falls back to the first held cel or another layer', () => {
  const source = frozen(original()), expected = original();
  drawing(expected).cels[1].strokes[2] = { color: '#00ff00', width: 6, points: [{ x: 57, y: 1 }] };
  assert.deepEqual(translateStroke(source, { layerId: 'original-lines', celFrame: 8, strokeIndex: 2 }, { x: 7, y: -9 }), expected);
  for (const bad of [
    { ...target, celFrame: 7 }, { ...target, celFrame: 1 }, { ...target, layerId: 'original-image' },
    { ...target, layerId: 'missing' }, { ...target, strokeIndex: -1 }, { ...target, strokeIndex: 4 },
    { ...target, strokeIndex: .5 }, { ...target, celFrame: NaN },
  ]) {
    assert.throws(() => translateStroke(source, bad, { x: 0, y: 0 }));
    assert.throws(() => setStrokeAppearance(source, bad, { color: '#112233', width: 3 }));
    assert.throws(() => deleteStroke(source, bad));
  }
  assert.deepEqual(source, original());
});

test('appearance preserves literal color case and every point/order/pose/image while equivalent no-op is detached', () => {
  const source = frozen(original()), appearance = frozen({ color: '#aBcDef', width: 3.25 }), expected = original();
  drawing(expected).cels[0].strokes[1] = { color: '#aBcDef', width: 3.25, points: [{ x: 10, y: 0 }, { x: 30, y: 0 }] };
  const actual = setStrokeAppearance(source, target, appearance);
  assert.deepEqual(actual, expected); assert.deepEqual(source, original());
  assert.deepEqual(appearance, { color: '#aBcDef', width: 3.25 });
  const unchanged = setStrokeAppearance(source, target, { color: '#0000ff', width: 2 });
  assert.deepEqual(unchanged, source); assert.notEqual(unchanged, source);
  drawing(unchanged).cels[0].strokes[1].points[0].x = 100;
  assert.equal(drawing(source).cels[0].strokes[1].points[0].x, 10);
  for (const bad of [{ color: 'blue', width: 2 }, { color: '#0000ff', width: 0 }, { color: '#0000ff', width: 40.00000001 }, { color: '#0000ff', width: NaN }]) assert.throws(() => setStrokeAppearance(source, target, bad));
});

test('delete removes exactly the indexed path without deleting first cel or aliasing remaining paths', () => {
  const source = frozen(original()), expected = original();
  drawing(expected).cels[0].strokes = [
    { color: '#ff0000', width: 4, points: [{ x: -0, y: 0 }, { x: 20, y: 0 }] },
    { color: '#00ff00', width: 6, points: [{ x: 50, y: 10 }] },
    { color: '#112233', width: 4, points: [{ x: 60, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 10 }] },
  ];
  const actual = deleteStroke(source, target);
  assert.deepEqual(actual, expected); assert.deepEqual(source, original());
  drawing(actual).cels[0].strokes[0].points[1].y = 999;
  assert.equal(drawing(source).cels[0].strokes[0].points[1].y, 0);
  const only = original(); drawing(only).cels[0].strokes = [{ color: '#456789', width: 1, points: [{ x: 1, y: 2 }] }];
  const blank = clone(only); drawing(blank).cels[0].strokes = [];
  assert.deepEqual(deleteStroke(only, { ...target, strokeIndex: 0 }), blank);
  assert.equal(drawing(only).cels[0].strokes.length, 1);
});

test('coordinate limits accept exact rigid displacement and refuse the entire overflowing path', () => {
  const source = original();
  drawing(source).cels[0].strokes[1] = { color: '#0000ff', width: 2, points: [{ x: 1279, y: 1279 }, { x: 0, y: -1280 }] };
  frozen(source); const before = clone(source), expected = clone(source);
  drawing(expected).cels[0].strokes[1].points = [{ x: 1280, y: 1279 }, { x: 1, y: -1280 }];
  assert.deepEqual(translateStroke(source, target, { x: 1, y: 0 }), expected);
  for (const delta of [{ x: 1.00000001, y: 0 }, { x: 0, y: -0.00000001 }, { x: Infinity, y: 0 }, { x: 0, y: NaN }]) {
    assert.throws(() => translateStroke(source, target, delta)); assert.deepEqual(source, before);
  }
});

test('100-stroke/10000-point graph edits preserve point multiplicity and global quotas', () => {
  const source = original(); source.layers = source.layers.slice(0, 1);
  drawing(source).cels = [{ frame: 0, strokes: Array.from({ length: 100 }, (_, index) => ({
    color: index === 99 ? '#abcdef' : '#112233', width: 1,
    points: Array.from({ length: 100 }, () => ({ x: 0, y: 0 })),
  })) }];
  frozen(source); const expected = clone(source);
  drawing(expected).cels[0].strokes[99].points = Array.from({ length: 100 }, () => ({ x: 1, y: -1 }));
  const actual = translateStroke(source, { ...target, strokeIndex: 99 }, { x: 1, y: -1 });
  assert.deepEqual(actual, expected);
  assert.equal(drawing(actual).cels[0].strokes.length, 100);
  assert.equal(drawing(actual).cels[0].strokes.reduce((sum, path) => sum + path.points.length, 0), 10000);
  assert.equal(new Set(drawing(actual).cels[0].strokes[99].points).size, 100);
  assert.deepEqual(drawing(source).cels[0].strokes[99].points, Array.from({ length: 100 }, () => ({ x: 0, y: 0 })));
});

function nearByteLimit(): Project {
  const source = original(); source.layers = source.layers.slice(0, 1);
  drawing(source).cels = [{ frame: 0, strokes: [{ color: '#abcdef', width: 1,
    points: Array.from({ length: 1000 }, () => ({ x: 0, y: 0 })) }] }];
  for (let i = 0; i < 4; i++) source.layers.push({
    id: `literal-png-${i}`, name: 'Original padded PNG', kind: 'image', keys: [
      { frame: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, easing: 'linear' },
    ], image: { dataUrl: originalPng(i < 3 ? 1179537 : 1), width: 1, height: 1 },
  });
  const last = source.layers[4]; if (last.kind !== 'image') throw new Error('Original fixture must end in image');
  const room = 6291624 - bytes(source);
  // Three binary padding bytes add four base64 characters. Leave at most3 bytes unused.
  const fourthPadding = 1 + Math.floor(room / 4) * 3;
  last.image.dataUrl = originalPng(fourthPadding);
  assert(bytes(source) <= 6291624 && bytes(source) > 6291620, `Original fixture bytes=${bytes(source)}`);
  for (const layer of source.layers) if (layer.kind === 'image') assert(layer.image.dataUrl.length <= 1572864);
  return source;
}

test('serialized candidate overflow refuses valid geometry atomically at the unchanged full-project byte cap', () => {
  const source = frozen(nearByteLimit()), before = clone(source), selected = { ...target, strokeIndex: 0 };
  assert.deepEqual(translateStroke(source, selected, { x: 0, y: 0 }), source);
  const independentlyTooLarge = clone(source);
  drawing(independentlyTooLarge).cels[0].strokes[0].points = Array.from({ length: 1000 }, () => ({ x: 0.00000001, y: 0 }));
  assert(bytes(independentlyTooLarge) > 6291624);
  assert.throws(() => translateStroke(source, selected, { x: 0.00000001, y: 0 }));
  assert.deepEqual(source, before);
});
