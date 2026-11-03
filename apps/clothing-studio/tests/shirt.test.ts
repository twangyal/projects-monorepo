import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { buildTechPack } from '../src/techpack.ts';
import { garmentName, optionsOf, partsOf, patternPieces, placketOf, teeMesh, template, topMeasurements, validateProduct, withOptions, type Product } from '../src/product.ts';

const shirt = validateProduct(template('shirt'));
const modules = (product: Product, change: Partial<NonNullable<Product['options']>>) => withOptions(product, { ...optionsOf(product), ...change });

test('a shirt is a tee with a button front and a collar in its own woven fabric', () => {
  assert.equal(garmentName(shirt), 'Button-up shirt');
  assert.deepEqual(partsOf(shirt), ['front', 'back', 'sleeveLeft', 'sleeveRight', 'collar', 'placket', 'chestPocket']);
  assert.equal(shirt.parts.collar.material, 'poplin-120');
  assert.deepEqual(placketOf(shirt), { length: 68, width: 3.2, buttons: 7 });
  assert.equal(garmentName(modules(shirt, { collar: false })), 'Collarless shirt');
  assert.equal(garmentName({ ...shirt, measurements: { ...shirt.measurements, sleeve: 22 } }), 'Short-sleeved shirt');
  assert.equal(garmentName({ ...shirt, measurements: { ...shirt.measurements, length: 100 } }), 'Shirt dress');
  // A button front on a plain tee keeps its neck rib; taking the buttons off a polo keeps its short placket.
  const buttoned = modules(template('blank'), { buttons: true });
  assert.deepEqual(partsOf(buttoned), ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband', 'placket']);
  assert.deepEqual(placketOf(template('polo')), { length: 14, width: 3, buttons: 3 });
  assert.throws(() => modules(template('crew-sweat'), { buttons: true }), /button front goes on a T-shirt/);
  assert.throws(() => validateProduct({ ...template('blank'), options: { hem: 'straight', chestPocket: false, zipOpen: true } }), /front zip or buttons/);
  // The fronts are cut as a mirrored pair and the placket as a folded pair; the tech pack lists the buttons and how it is sewn.
  const pieces = new Map(patternPieces(shirt).map(piece => [piece.part, piece]));
  assert.equal(pieces.get('front')!.cutCount, 2);
  assert.equal(pieces.get('placket')!.cutCount, 2);
  const pack = buildTechPack(shirt, '2026-11-03');
  assert.equal(pack.bom.find(row => row.item === 'B1 Buttons')?.quantity, '7');
  assert.equal(pack.poms.find(row => row.name === 'Placket length')?.values.M, 68);
  assert.match(pack.construction.find(row => row.area === 'Button front')!.detail, /7 buttonholes/);
  assert.match(pack.construction.find(row => row.area === 'Collar')!.detail, /in the shirt fabric/);
  // A chest pocket must stay clear of the placket.
  assert.throws(() => validateProduct({ ...shirt, fit: { ...shirt.fit, chestPocketX: 1 } }), /clear of the button placket/);
});

test('draped, the shirt settles closed and open, its woven collar lying down instead of fighting the neckline', () => {
  for (const product of [shirt, modules(shirt, { zipOpen: true })]) {
    const meshes = teeMesh(product, Delaunator), collar = meshes.find(mesh => mesh.part === 'collar')!, columns = collar.positions.length / 9;
    const result = simulateGarment(product, meshes, 96, { frames: 150 }), draped = result.parts.find(part => part.part === 'collar')!.positions;
    assert.ok(result.metrics.maxStrain < 0.5 && result.metrics.residualSpeed < 10, `stretch ${result.metrics.maxStrain}, still moving at ${result.metrics.residualSpeed} cm/s`);
    let fall = 0, stand = 0;
    for (let i = 0; i < columns; i++) { stand += draped[(columns + i) * 3 + 1]!; fall += draped[(2 * columns + i) * 3 + 1]!; }
    assert.ok(fall / columns < stand / columns - 2, 'the fall hangs below the stand');
  }
  // Worn open, the placket is two strips, one on each front half.
  const strips = teeMesh(modules(shirt, { zipOpen: true }), Delaunator).find(mesh => mesh.part === 'placket')!.positions;
  const xs = strips.filter((_, i) => i % 3 === 0);
  assert.ok(xs.every(x => Math.abs(x) >= 0.15 - 1e-9));
});

test('described as a shirt, a button-up or a shirt dress, a tee gets the button front and collar', () => {
  const read = (text: string, from: Product) => readDesignPrompt(text, from).product;
  assert.equal(garmentName(read('a white oxford shirt', template('crew-sweat'))), 'Button-up shirt');
  // A tee described as a shirt keeps its own short sleeves.
  assert.equal(garmentName(read('a striped shirt', template('blank'))), 'Short-sleeved shirt');
  assert.equal(garmentName(read('a black t-shirt', template('blank'))), 'T-shirt');
  assert.equal(garmentName(read('a navy polo shirt', template('blank'))), 'Polo shirt');
  assert.equal(garmentName(read('a linen shirt dress', template('blank'))), 'Shirt dress');
  assert.ok(topMeasurements(read('a dress shirt', template('blank'))).length < 85, 'a dress shirt is not a dress');
});
