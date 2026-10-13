import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { motifPlacements } from '../src/fabric-texture.ts';
import { validateProject, createProject } from '../src/model.ts';
import { MATERIALS, PART_IDS, TEMPLATES, panelSize, patternPieces, teeMesh, teeSilhouette, template, validateProduct, type Product } from '../src/product.ts';

const ringer = () => template('ringer');

test('templates are valid remixable products and validation refuses anything outside the library or limits', () => {
  for (const item of TEMPLATES) assert.deepEqual(validateProduct(structuredClone(item.product)), template(item.id));
  assert.equal(template('ringer').parts.sleeveLeft.color, '#b23a2e');
  assert.equal(new Set(MATERIALS.map(m => m.id)).size, MATERIALS.length);
  const good = ringer();
  const bad: [string, (p: Product) => void][] = [
    ['fabric', p => { p.parts.front.material = 'silk-999'; }],
    ['color', p => { p.parts.back.color = 'red'; }],
    ['print', p => { p.parts.front.print = { motif: 'plaid' as never, color: '#000000', scaleCm: 5, layout: 'grid' }; }],
    ['repeat', p => { p.parts.front.print = { motif: 'dots', color: '#000000', scaleCm: 1, layout: 'grid' }; }],
    ['chest', p => { p.measurements.chest = 300; }],
    ['part', p => { delete (p.parts as Record<string, unknown>).neckband; }],
    ['extra', p => { (p as unknown as Record<string, unknown>).price = 1; }],
    ['sample size', p => { p.spec = { styleNumber: 'A', season: 'B', sampleSize: 'XXL' as never }; }],
    ['style number', p => { p.spec = { styleNumber: 'x'.repeat(41), season: '', sampleSize: 'M' }; }],
    ['season', p => { p.spec = { styleNumber: '', season: 'SS\u000027', sampleSize: 'M' }; }],
    ['artwork', p => { p.artwork = [{ part: 'front', dataUrl: 'javascript:alert(1)', width: 1, height: 1, name: 'x', xCm: 0, yCm: 0, widthCm: 10 }]; }],
  ];
  for (const [label, mutate] of bad) { const p = structuredClone(good); mutate(p); assert.throws(() => validateProduct(p), Error, label); }
  assert.deepEqual(validateProduct({ ...structuredClone(good), spec: { styleNumber: ' CS-1 ', season: 'SS27', sampleSize: 'L' } }).spec, { styleNumber: 'CS-1', season: 'SS27', sampleSize: 'L' });
  // Projects keep the design; older projects without one stay valid.
  const project = validateProject({ ...createProject(), product: good });
  assert.deepEqual(project.product, good);
  assert.equal(validateProject(createProject()).product, undefined);
});

test('pattern pieces follow the measurements', () => {
  const p = ringer(), pieces = patternPieces(p);
  assert.deepEqual(pieces.map(piece => piece.part), [...PART_IDS]);
  const front = pieces[0];
  assert.equal(front.width, panelSize(p.measurements).width);
  assert.equal(front.height, p.measurements.length);
  const wider = patternPieces({ ...p, measurements: { ...p.measurements, chest: p.measurements.chest + 20 } });
  assert.ok(wider[0].areaCm2 > front.areaCm2 && wider[2].areaCm2 > pieces[2].areaCm2);
  const v = patternPieces({ ...p, neckline: 'v' });
  assert.ok(Math.max(...v[0].outline.slice(10).map(pt => pt.y)) === 15, 'the V-neck front dips 15 cm');
});

test('the 3D garment joins front and back exactly along the seams, leaves hem, cuffs and neck open, and uses cm UVs', () => {
  const p = ringer(), meshes = teeMesh(p, Delaunator);
  assert.deepEqual(meshes.map(m => m.part), [...PART_IDS]);
  const front = teeSilhouette(p, 'front');
  for (const mesh of meshes) {
    assert.equal(mesh.positions.length / 3, mesh.uvs.length / 2);
    assert.ok(mesh.indices.length > 30 && mesh.indices.every(i => i < mesh.positions.length / 3), mesh.part);
  }
  const body = meshes.find(m => m.part === 'front')!, back = meshes.find(m => m.part === 'back')!;
  const points = (mesh: typeof body) => Array.from({ length: mesh.positions.length / 3 }, (_, i) => ({ x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] }));
  const f = points(body), b = points(back), half = panelSize(p.measurements).width / 2, top = p.measurements.length;
  assert.ok(f.every(q => q.z >= 0) && b.every(q => q.z <= 0), 'front faces the viewer, back faces away');
  // Side seams: vertices on x = ±half are pinned at z = 0 on both sides, so the shell is closed there.
  const side = (pts: typeof f) => pts.filter(q => Math.abs(Math.abs(q.x) - half) < 1e-9 && q.y < top - 35);
  assert.ok(side(f).length > 10 && side(f).every(q => Math.abs(q.z) < 1e-9) && side(b).every(q => Math.abs(q.z) < 1e-9));
  // The hem stays open: away from the sides, hem vertices stand off the seam plane.
  const hem = f.filter(q => Math.abs(q.y) < 1e-9 && Math.abs(q.x) < half - 8);
  assert.ok(hem.length > 5 && hem.every(q => q.z > 5), 'open hem');
  // Each sleeve shares its armhole vertices with the body, so there is no gap at the seam.
  const sleeve = points(meshes.find(m => m.part === 'sleeveLeft')!);
  const key = (q: { x: number; y: number; z: number }) => `${q.x.toFixed(6)},${q.y.toFixed(6)},${q.z.toFixed(6)}`;
  const bodyKeys = new Set(f.map(key)), shared = sleeve.filter(q => bodyKeys.has(key(q)));
  assert.ok(shared.length >= 15, `shared armhole vertices: ${shared.length}`);
  // UVs are flat cm: across the front they span the silhouette width.
  const us = body.uvs.filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - 2 * half) < 1e-9, 'front body UVs span its flat width in cm');
  assert.equal(front.points.length, 21, '12 corners and 9 neckline points');
  // Measurements reshape the garment.
  const long = teeMesh({ ...p, measurements: { ...p.measurements, sleeve: 60 } }, Delaunator).find(m => m.part === 'sleeveLeft')!;
  assert.ok(Math.max(...long.positions.filter((_, i) => i % 3 === 0)) > Math.max(...sleeve.map(q => q.x)) + 25);
});

test('repeat layouts place four motifs per tile with the documented offsets', () => {
  assert.deepEqual(motifPlacements('grid').map(m => [m.x, m.y]), [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]);
  assert.deepEqual(motifPlacements('half-drop').map(m => [m.x, m.y]), [[0.25, 0.25], [0.75, 0.5], [0.25, 0.75], [0.75, 0]]);
  assert.deepEqual(motifPlacements('half-brick').map(m => [m.x, m.y]), [[0.25, 0.25], [0.75, 0.25], [0.5, 0.75], [0, 0.75]]);
  assert.deepEqual(motifPlacements('mirror').map(m => [m.flipX, m.flipY]), [[false, false], [true, false], [false, true], [true, true]]);
});
