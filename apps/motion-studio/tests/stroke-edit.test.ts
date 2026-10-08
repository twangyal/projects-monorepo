import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_JSON_BYTES, validateProject, type DrawingLayer, type Project, type Stroke } from '../src/model.ts';
import { deleteStroke, hitStroke, setStrokeAppearance, translateStroke, type StrokeTarget } from '../src/stroke-edit.ts';

const red: Stroke = { color: '#ff0000', width: 4, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }] };
const blue: Stroke = { color: '#0000ff', width: 2, points: [{ x: 10, y: -5 }, { x: 10, y: 5 }] };
function fixture(): Project {
  const keys = [{ frame: 0, x: 200, y: 100, scale: 2, rotation: 90, opacity: 1, easing: 'linear' as const },
    { frame: 23, x: 250, y: 120, scale: 1, rotation: 180, opacity: .5, easing: 'ease' as const }];
  return validateProject({ schemaVersion: 2, title: 'Original artwork', background: '#ffffff', frameCount: 24, layers: [
    { id: 'selected', name: 'Selected', kind: 'drawing', keys, cels: [{ frame: 0, strokes: [red, blue] }, { frame: 12, strokes: [red] }] },
    { id: 'other', name: 'Other', kind: 'drawing', keys, cels: [{ frame: 0, strokes: [blue] }] },
    { id: 'image', name: 'Original embedded image', kind: 'image', keys, image: { dataUrl: 'data:image/png;base64,AAAA', width: 1, height: 1 } },
  ] });
}
const selected = (project: Project): DrawingLayer => project.layers[0] as DrawingLayer;
const target: StrokeTarget = { layerId: 'selected', celFrame: 0, strokeIndex: 0 };

test('round segments include caps/boundary, topmost overlap and explicit coincident dots', () => {
  assert.equal(hitStroke([red], { x: 10, y: 2 }, 0), 0);
  assert.equal(hitStroke([red], { x: 10, y: 2.000000001 }, 0), null);
  assert.equal(hitStroke([red], { x: -2, y: 0 }, 0), 0);
  assert.equal(hitStroke([red], { x: -2.000000001, y: 0 }, 0), null);
  assert.equal(hitStroke([red, blue], { x: 10, y: 0 }, 0), 1);
  assert.equal(hitStroke([red], { x: 10, y: 8 }, 6), 0);
  const dot: Stroke = { color: '#00ff00', width: 6, points: [{ x: 30, y: 40 }] };
  assert.equal(hitStroke([dot], { x: 33, y: 40 }, 0), 0);
  assert.equal(hitStroke([{ ...dot, points: [{ x: 30, y: 40 }, { x: 30, y: 40 }] }], { x: 30, y: 43 }, 0), 0);
  assert.equal(hitStroke([], { x: 0, y: 0 }, 6), null);
});

test('literal nearest point query covers diagonal segments, repeated vertices and input ownership', () => {
  const path: Stroke = { color: '#010203', width: 6, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 4 }] };
  const before = structuredClone(path);
  assert.equal(hitStroke([path], { x: 0, y: 5 }, 0), 0);
  assert.equal(hitStroke([path], { x: 0, y: 5.001 }, 0), null);
  assert.deepEqual(path, before);
  for (const [point, padding] of [[{ x: NaN, y: 0 }, 0], [{ x: 0, y: Infinity }, 0], [{ x: 0, y: 0 }, -1], [{ x: 0, y: 0 }, NaN]] as const) {
    assert.throws(() => hitStroke([path], point, padding));
  }
});

test('translation is rigid/detached and preserves other cels/layers/image/poses/order', () => {
  const base = fixture(), before = structuredClone(base);
  const output = translateStroke(base, target, { x: -5, y: -10 });
  const expected = structuredClone(base);
  selected(expected).cels[0].strokes[0].points = [{ x: -5, y: -10 }, { x: 15, y: -10 }];
  assert.deepEqual(output, expected); assert.deepEqual(base, before);
  selected(output).cels[0].strokes[0].points[0].x = 999;
  assert.deepEqual(base, before);
  assert.deepEqual(translateStroke(base, target, { x: 0, y: 0 }), before);
});

test('appearance changes only exact selected color/width and deletion retains a blank first cel', () => {
  const base = fixture(), before = structuredClone(base);
  const appearance = { color: '#12AbCD', width: 40 };
  const output = setStrokeAppearance(base, target, appearance);
  const expected = structuredClone(base);
  Object.assign(selected(expected).cels[0].strokes[0], appearance);
  assert.deepEqual(output, expected);
  const removed = deleteStroke(base, target);
  assert.deepEqual(selected(removed).cels[0].strokes, [blue]);
  const blank = deleteStroke(removed, target);
  assert.deepEqual(selected(blank).cels[0], { frame: 0, strokes: [] });
  assert.deepEqual(blank.layers.slice(1), base.layers.slice(1));
  assert.deepEqual(selected(blank).cels[1], selected(base).cels[1]);
  assert.deepEqual(base, before);
});

test('exact boundary targeting and invalid options refuse without modifying the complete graph', () => {
  const base = fixture(), before = structuredClone(base);
  for (const bad of [{ ...target, celFrame: 1 }, { ...target, celFrame: 12.5 }, { ...target, strokeIndex: 2 }, { ...target, strokeIndex: -1 }, { ...target, layerId: 'image' }, { ...target, layerId: 'missing' }]) {
    assert.throws(() => translateStroke(base, bad, { x: 1, y: 0 }));
    assert.throws(() => deleteStroke(base, bad));
  }
  for (const appearance of [{ color: 'red', width: 2 }, { color: '#ffffff', width: 0 }, { color: '#ffffff', width: 40.00000001 }, { color: '#ffffff', width: NaN }]) {
    assert.throws(() => setStrokeAppearance(base, target, appearance));
  }
  for (const delta of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: 1281, y: 0 }]) assert.throws(() => translateStroke(base, target, delta));
  assert.deepEqual(base, before);
});

test('exact coordinate edge admits and any single overflowing translated point refuses atomically', () => {
  const base = fixture();
  selected(base).cels[0].strokes[0].points = [{ x: 1270, y: -1280 }, { x: 1280, y: -1270 }];
  const before = structuredClone(base);
  assert.deepEqual(translateStroke(base, target, { x: -2550, y: 0 }).layers[0], { ...selected(base), cels: [
    { frame: 0, strokes: [{ ...red, points: [{ x: -1280, y: -1280 }, { x: -1270, y: -1270 }] }, blue] }, selected(base).cels[1]] });
  assert.throws(() => translateStroke(base, target, { x: .000000001, y: 0 }));
  assert.throws(() => translateStroke(base, target, { x: 0, y: -.000000001 }));
  assert.deepEqual(base, before);
});

test('100 strokes/10000 points remain complete and numeric spelling overflow obeys unchanged file cap', () => {
  const base = fixture(); base.layers.splice(1);
  selected(base).cels = [{ frame: 0, strokes: Array.from({ length: 100 }, () => ({ color: '#010203', width: 1,
    points: Array.from({ length: 100 }, (_, x) => ({ x, y: 0 })) })) }];
  const admitted = validateProject(base), before = structuredClone(admitted);
  const translated = translateStroke(admitted, target, { x: .25, y: -.5 });
  assert.equal(selected(translated).cels[0].strokes.length, 100);
  assert.equal(selected(translated).cels[0].strokes.reduce((n, stroke) => n + stroke.points.length, 0), 10000);
  assert.deepEqual(admitted, before);
  const large = fixture();
  const key = selected(large).keys[0];
  large.layers = [selected(large), ...Array.from({ length: 4 }, (_, index) => ({ id: `image${index}`, name: 'Image', kind: 'image' as const,
    keys: [key], image: { dataUrl: 'data:image/png;base64,' + 'A'.repeat(1572840), width: 1, height: 1 } }))];
  selected(large).cels = [{ frame: 0, strokes: [
    { color: '#000000', width: 1, points: [{ x: 9, y: 0 }] },
    { color: '#000000', width: 1, points: Array.from({ length: 1000 }, () => ({ x: 0, y: 0 })) },
  ] }];
  // Fill four bounded opaque image spellings in base64 quanta, then use
  // the title's remaining ASCII capacity for an exact canonical byte cap.
  const bytes = new TextEncoder().encode(JSON.stringify(validateProject({ ...large,
    layers: large.layers.map(layer => layer.kind === 'image' ? { ...layer, image: { ...layer.image, dataUrl: layer.image.dataUrl.slice(0, -20000) } } : layer) }))).length;
  const gap = MAX_JSON_BYTES - bytes;
  const candidate = { ...large, layers: large.layers.map(layer => layer.kind === 'image'
    ? { ...layer, image: { ...layer.image, dataUrl: layer.image.dataUrl.slice(0, -20000) } } : layer) };
  let remaining = Math.floor(gap / 4) * 4;
  for (const image of candidate.layers) {
    if (image.kind !== 'image') continue;
    const addition = Math.min(remaining, 20000);
    image.image.dataUrl += 'A'.repeat(addition); remaining -= addition;
  }
  assert.equal(remaining, 0);
  candidate.title += 'x'.repeat(gap % 4);
  const valid = validateProject(candidate);
  assert.equal(new TextEncoder().encode(JSON.stringify(valid)).length, MAX_JSON_BYTES);
  const oneExtraByte = structuredClone(valid); selected(oneExtraByte).cels[0].strokes[0].points[0].x = 10;
  assert.equal(new TextEncoder().encode(JSON.stringify(oneExtraByte)).length, MAX_JSON_BYTES + 1);
  assert.throws(() => translateStroke(valid, target, { x: 1, y: 0 }), /JSON.*limit/i);
  assert.equal(selected(valid).cels[0].strokes[0].points[0].x, 9);
});
