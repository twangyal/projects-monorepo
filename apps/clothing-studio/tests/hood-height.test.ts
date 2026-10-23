import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { template, validateProduct, teeDimensions, patternPieces, teeMesh } from '../src/product.ts';
import { buildTechPack, fabricUsage } from '../src/techpack.ts';
import { buildCloth } from '../src/garment-drape.ts';

test('hood side height changes only hood pattern and actual loft with unchanged neck base', () => {
  const before = template('hoodie'), after = validateProduct({ ...before, fit: { hoodHeight: 40 } });
  assert.equal(teeDimensions(after).hoodHeight, 40);
  const pieces = patternPieces(after), oldPieces = patternPieces(before);
  assert.equal(pieces.find(p => p.part === 'hood')!.height, 40);
  assert.deepEqual(pieces.filter(p => p.part !== 'hood'), oldPieces.filter(p => p.part !== 'hood'));
  const meshes = teeMesh(after, Delaunator), old = teeMesh(before, Delaunator);
  assert.deepEqual(meshes.filter(p => p.part !== 'hood'), old.filter(p => p.part !== 'hood'));
  const hood = meshes.find(m => m.part === 'hood')!, prior = old.find(m => m.part === 'hood')!;
  const columns = hood.positions.length / 3 / 17;
  for (let vertex = 0; vertex < hood.positions.length / 3; vertex++) {
    assert.equal(hood.positions[vertex * 3], prior.positions[vertex * 3]);
    assert.equal(hood.positions[vertex * 3 + 2], prior.positions[vertex * 3 + 2]);
    assert.ok(Math.abs(hood.positions[vertex * 3 + 1] - prior.positions[vertex * 3 + 1] - 8 * Math.floor(vertex / columns) / 16) < 1e-9);
  }
  assert.equal(hood.uvs.at(-1), 40);
  const pack = buildTechPack(after, '2026-10-23');
  assert.equal(pack.poms.find(p => p.code === 'K')!.values.M, 40);
  assert.ok(fabricUsage(after).reduce((sum, row) => sum + row.areaM2, 0) > fabricUsage(before).reduce((sum, row) => sum + row.areaM2, 0));
  assert.match(pack.poms.find(p => p.code === 'K')!.howToMeasure, /side pattern/i);
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(after))), after);
});

test('omitted and explicit32 retain exact hood geometry while changed height reaches cloth rest', () => {
  const original = template('hoodie'), same = validateProduct({ ...original, fit: { hoodHeight: 32 } });
  assert.deepEqual(patternPieces(same), patternPieces(original));
  assert.deepEqual(teeMesh(same, Delaunator), teeMesh(original, Delaunator));
  const changed = validateProduct({ ...original, fit: { hoodHeight: 24 } });
  const a = buildCloth(original, teeMesh(original, Delaunator)), b = buildCloth(changed, teeMesh(changed, Delaunator));
  assert.equal(a.rest.length, b.rest.length); assert.notDeepEqual(a.rest, b.rest);
  assert.deepEqual(a.vertices.get('hood'), b.vertices.get('hood'));
  assert.ok(Array.from(b.rest).every(Number.isFinite));
});

test('hood height bounds and incompatible garments refuse without mutating input', () => {
  for (const hoodHeight of [24, 44]) assert.equal(teeDimensions(validateProduct({ ...template('hoodie'), fit: { hoodHeight } })).hoodHeight, hoodHeight);
  for (const hoodHeight of [23.99, 44.01, NaN, Infinity, '32', null]) assert.throws(() => validateProduct({ ...template('hoodie'), fit: { hoodHeight } }), /hood side height/i);
  for (const id of ['blank', 'crew-sweat', 'trousers']) {
    const product = template(id), raw = { ...product, fit: { hoodHeight: 32 } }, before = structuredClone(raw);
    assert.throws(() => validateProduct(raw), /hood|tops/i); assert.deepEqual(raw, before);
  }
});
