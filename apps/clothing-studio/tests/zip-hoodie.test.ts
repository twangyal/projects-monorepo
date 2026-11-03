import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { garmentName, optionsOf, patternPieces, teeMesh, template, validateProduct, zipLength } from '../src/product.ts';
import { buildTechPack } from '../src/techpack.ts';

test('a zip hoodie is cut with its front, pocket and hem band as mirrored halves', () => {
  const zip = template('zip-hoodie'), pullover = template('hoodie');
  assert.equal(garmentName(zip), 'Zip hoodie');
  const cut = (product: typeof zip) => Object.fromEntries(patternPieces(product).map(piece => [piece.part, [piece.cutCount, Math.round(piece.width * 10) / 10]]));
  const zipped = cut(zip), whole = cut(pullover);
  for (const part of ['front', 'pocket', 'hemBand']) {
    assert.equal(zipped[part]![0], 2, `${part} is cut twice`);
    assert.ok(Math.abs(zipped[part]![1] * 2 - whole[part]![1]) < 0.2, `${part} halves are half as wide`);
  }
  assert.deepEqual(zipped.back, whole.back);
  // In 3D, the pocket halves leave the centre front clear for the zip.
  const pocket = teeMesh(zip, Delaunator).find(part => part.part === 'pocket')!;
  let nearest = Infinity;
  for (let i = 0; i < pocket.positions.length; i += 3) nearest = Math.min(nearest, Math.abs(pocket.positions[i]!));
  assert.ok(nearest >= 1.1, `pocket reaches ${nearest.toFixed(2)} cm from the centre`);
});

test('only a hoodie takes a front zip, and saved designs without one stay as they were', () => {
  assert.throws(() => validateProduct({ ...template('blank'), options: { hem: 'straight', chestPocket: false, zip: true } }), /Only a hoodie/);
  assert.throws(() => validateProduct({ ...template('hoodie'), options: { hem: 'straight', chestPocket: false, zip: 'yes' } }), /Front zip must be on or off/);
  assert.deepEqual(validateProduct({ ...template('hoodie'), options: { hem: 'straight', chestPocket: false, zip: false } }).options, { hem: 'straight', chestPocket: false });
  assert.equal(optionsOf(template('hoodie')).zip, undefined);
});

test('the tech pack lists the zip and how it is set', () => {
  const pack = buildTechPack(template('zip-hoodie'), '2026-11-03');
  assert.equal(pack.base, 'Zip hoodie');
  const zip = pack.bom.find(row => row.item === 'Z1 Zip')!;
  assert.equal(zip.quantity, `1 × ${zipLength(template('zip-hoodie')).toFixed(1)} cm`);
  assert.ok(pack.construction.some(row => row.area === 'Centre-front zip'));
  assert.ok(!buildTechPack(template('hoodie'), '2026-11-03').bom.some(row => row.item === 'Z1 Zip'));
});

test('descriptions add or remove the zip', () => {
  const zipped = readDesignPrompt('grey zip hoodie', template('blank'));
  assert.equal(garmentName(zipped.product), 'Zip hoodie');
  assert.ok(zipped.scopes[0]!.understood.includes('garment: Zip hoodie, started from its template'));
  assert.equal(optionsOf(readDesignPrompt('make it a full-zip', template('hoodie')).product).zip, true);
  assert.equal(optionsOf(readDesignPrompt('navy pullover hoodie', template('zip-hoodie')).product).zip, undefined);
  assert.ok(readDesignPrompt('zip tee', template('blank')).ignored.some(item => item.startsWith('front zip')));
});
