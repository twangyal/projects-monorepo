import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingLayer, validateProject, type DrawingLayer, type Project } from '../src/model.ts';
import { setStrokeAppearance, hitStroke, duplicateStroke, translateStroke } from '../src/stroke-edit.ts';
import { buildDrawingTween, previewDrawingTween } from '../src/tween.ts';
const target = { layerId: 'shape', celFrame: 0, strokeIndex: 0 };
function fixture(fill = true): Project {
  const layer = createDrawingLayer(); layer.id = 'shape';
  layer.cels[0].strokes = [{ color: '#112233', width: 2, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
  if (fill) Object.assign(layer.cels[0].strokes[0], { fill: '#FF0000' });
  return { schemaVersion: 2, title: 'Filled shape', background: '#ffffff', frameCount: 12, layers: [layer] };
}
const stroke = (p: Project) => (p.layers[0] as DrawingLayer).cels[0].strokes[0];
test('strict optional fill survives admission copy and transforms while old unfilled graphs stay exact', () => {
  const raw = fixture(), before = structuredClone(raw), safe = validateProject(raw);
  assert.deepEqual(safe, before); assert.deepEqual(validateProject(fixture(false)), fixture(false));
  const copy = duplicateStroke(safe, target); assert.equal(JSON.parse(JSON.stringify(copy)).layers[0].cels[0].strokes[1].fill, '#FF0000');
  assert.equal(JSON.parse(JSON.stringify(translateStroke(safe, target, { x: 2, y: 3 }))).layers[0].cels[0].strokes[0].fill, '#FF0000');
  assert.deepEqual(raw, before);
});
test('appearance atomically adds changes and removes fill without altering literal paths', () => {
  const original = fixture(false), before = structuredClone(original);
  const next = setStrokeAppearance(original, target, { color: '#112233', width: 2, ...{ fill: '#ABCDEF' } });
  assert.equal(JSON.parse(JSON.stringify(next)).layers[0].cels[0].strokes[0].fill, '#ABCDEF');
  const removed = setStrokeAppearance(next, target, { color: '#112233', width: 2, ...{ fill: null } });
  assert.deepEqual(removed, before); assert.deepEqual(original, before);
});
test('malformed or accessor fill refuses without reading accessors', () => {
  for (const fill of [null, undefined, '#fff', 'red', 0]) { const p = fixture(); Object.assign(stroke(p), { fill }); assert.throws(() => validateProject(p)); }
  let reads = 0; const p = fixture(); Object.defineProperty(stroke(p), 'fill', { enumerable: true, get() { reads++; return '#000000'; } });
  assert.throws(() => validateProject(p)); assert.equal(reads, 0);
});
test('filled interior uses nonzero winding and paint order while an unfilled center does not select', () => {
  assert.equal(hitStroke([stroke(fixture())], { x: 50, y: 50 }, 0), 0);
  assert.equal(hitStroke([stroke(fixture(false))], { x: 50, y: 50 }, 0), null);
  assert.equal(hitStroke([stroke(fixture()), stroke(fixture())], { x: 50, y: 50 }, 0), 1);
  assert.equal(hitStroke([stroke(fixture())], { x: 150, y: 50 }, 0), null);
});
test('in-betweens retain interpolated fill and proposal replay refuses mixed endpoint fill states', () => {
  const p = fixture(), layer = p.layers[0] as DrawingLayer;
  const end = structuredClone(layer.cels[0]); end.frame = 10; Object.assign(end.strokes[0], { fill: '#0000FF' }); layer.cels.push(end);
  const selection = { layerId: 'shape', startFrame: 0, endFrame: 10 }, choices = { pairs: [{ startStroke: 0, endStroke: 0, reverseEnd: false }], frames: [5] };
  const proposal = buildDrawingTween(p, selection, choices);
  assert.equal(JSON.parse(JSON.stringify(proposal)).generated[0].strokes[0].fill, '#800080');
  assert.equal(JSON.parse(JSON.stringify(previewDrawingTween(p, proposal))).layers[0].cels[1].strokes[0].fill, '#800080');
  Object.assign(proposal.generated[0].strokes[0], { fill: '#00ff00' });
  assert.throws(() => previewDrawingTween(p, proposal), /review|changed|modified/i);
  delete (end.strokes[0] as unknown as Record<string, unknown>).fill;
  assert.throws(() => buildDrawingTween(p, selection, choices), /fill/i);
});

test('filled loops use nonzero winding and private admission retains canonical fill bytes', async () => {
  const p = fixture(), shape = stroke(p); shape.points = [...shape.points, ...structuredClone(shape.points)];
  assert.equal(hitStroke([shape], { x: 50, y: 50 }, 0), 0, 'winding two remains filled, unlike even-odd');
  const safe = validateProject(p), { admitPortableProject } = await import('../server/project-admission.ts');
  const admitted = await admitPortableProject(Buffer.from(JSON.stringify(safe)));
  assert.deepEqual(admitted.project, safe); assert.equal(Buffer.from(admitted.json).toString(), JSON.stringify(safe));
});
