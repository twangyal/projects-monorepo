import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { buildTechPack } from '../src/techpack.ts';
import { STAND_COLLAR_CM, canWearTogether, garmentName, optionsOf, partsOf, patternPieces, teeMesh, template, validateProduct, withOptions, type Product } from '../src/product.ts';

const bomber = validateProduct(template('bomber'));
const modules = (product: Product, change: Partial<NonNullable<Product['options']>>) => withOptions(product, { ...optionsOf(product), ...change });

test('a bomber jacket is a sweatshirt with a front zip, a rib stand collar and a nylon shell', () => {
  assert.equal(garmentName(bomber), 'Bomber jacket');
  assert.deepEqual(partsOf(bomber), ['front', 'back', 'sleeveLeft', 'sleeveRight', 'cuffLeft', 'cuffRight', 'hemBand', 'collar']);
  assert.equal(bomber.parts.front.material, 'nylon-150');
  assert.equal(bomber.parts.collar.material, 'rib-220');
  // Either module alone, and a short one, are named for what they are.
  assert.equal(garmentName(modules(bomber, { collar: false })), 'Zip sweatshirt');
  assert.equal(garmentName(modules(bomber, { zip: false })), 'Funnel-neck sweatshirt');
  assert.equal(garmentName({ ...bomber, measurements: { ...bomber.measurements, length: 48 } }), 'Cropped bomber jacket');
  // Taking the collar off gives the neck rib back in its style; a V-neck takes no collar, and neither does a hoodie.
  const ribbed = modules(bomber, { collar: false });
  assert.deepEqual(ribbed.parts.neckband, bomber.parts.collar);
  assert.equal(ribbed.parts.collar, undefined);
  assert.throws(() => modules({ ...template('crew-sweat'), neckline: 'v' }, { collar: true }), /crew neckline/);
  assert.throws(() => validateProduct({ ...template('hoodie'), options: { hem: 'straight', chestPocket: false, collar: true } }), /collar goes on/);
  // The fronts and hem band are cut as mirrored pairs for the zip; the collar is cut on the fold.
  const pieces = new Map(patternPieces(bomber).map(piece => [piece.part, piece]));
  assert.equal(pieces.get('front')!.cutCount, 2);
  assert.equal(pieces.get('hemBand')!.cutCount, 2);
  assert.ok(!pieces.has('neckband'));
  const collar = pieces.get('collar')!.outline, height = Math.max(...collar.map(p => p.y)) - Math.min(...collar.map(p => p.y));
  assert.ok(Math.abs(height - STAND_COLLAR_CM * 2) < 1e-6);
  const pack = buildTechPack(bomber, '2026-11-03');
  assert.equal(pack.poms.find(row => row.name === 'Collar height')?.values.M, STAND_COLLAR_CM);
  assert.match(pack.construction.find(row => row.area === 'Centre-front zip')!.detail, /top of the collar/);
  assert.ok(pack.construction.some(row => row.area === 'Collar') && !pack.construction.some(row => row.area === 'Neck rib' || row.area === 'Placket'));
  assert.ok(pack.bom.some(row => row.item === 'Z1 Zip'));
  // A T-shirt can be worn under it.
  assert.ok(canWearTogether(template('blank'), bomber));
});

test('the collar and neck rib run from one side of the zip round the back to the other, and stand when draped', () => {
  const band = (product: Product) => teeMesh(product, Delaunator).find(mesh => mesh.part === 'collar' || mesh.part === 'neckband')!;
  const ends = (product: Product) => { const positions = band(product).positions, last = positions.length - 6; return [positions[0]!, positions[last]!]; };
  // Zipped up the ends meet at the centre front; worn open they follow the parted halves; without a zip it is a ring.
  assert.deepEqual(ends(bomber).map(x => Math.abs(x)), [0, 0]);
  assert.deepEqual(ends(modules(bomber, { zipOpen: true })).map(x => Math.abs(x)), [0.15, 0.15]);
  const ring = band(modules(bomber, { zip: false })), columns = ring.positions.length / 6;
  assert.equal(ring.indices.length / 6, columns, 'a funnel neck closes round');
  assert.equal(band(modules(bomber, { collar: false })).part, 'neckband');
  for (const product of [bomber, modules(bomber, { zipOpen: true })]) {
    const meshes = teeMesh(product, Delaunator), result = simulateGarment(product, meshes, 96, { frames: 150 });
    const draped = result.parts.find(part => part.part === 'collar')!.positions, count = draped.length / 6;
    let stand = 0;
    for (let c = 0; c < count; c++) stand += draped[c * 6 + 4]! - draped[c * 6 + 1]!;
    assert.ok(stand / count > STAND_COLLAR_CM * 0.6, `the collar stands ${(stand / count).toFixed(1)} cm`);
    assert.ok(result.metrics.maxStrain < 0.5 && result.metrics.residualSpeed < 10, `stretch ${result.metrics.maxStrain}, still moving at ${result.metrics.residualSpeed} cm/s`);
  }
});

test('described as a bomber, a zip-up or a funnel neck, a sweatshirt gets the matching modules', () => {
  const read = (text: string, from: Product) => readDesignPrompt(text, from).product;
  assert.equal(garmentName(read('a black bomber jacket', template('blank'))), 'Bomber jacket');
  assert.equal(read('a black bomber jacket', template('blank')).base, 'sweatshirt');
  const sweat = template('crew-sweat');
  assert.equal(garmentName(read('a zip-up sweatshirt', sweat)), 'Zip sweatshirt');
  assert.equal(garmentName(read('a funnel neck sweatshirt', sweat)), 'Funnel-neck sweatshirt');
  const restyled = read('a bomber jacket', sweat);
  assert.equal(garmentName(restyled), 'Bomber jacket');
  assert.equal(restyled.parts.front.material, sweat.parts.front.material, 'a sweatshirt keeps its own fabric');
  assert.equal(read('olive nylon sweatshirt', sweat).parts.front.material, 'nylon-150');
  assert.equal(read('bomber with a red collar', bomber).parts.collar.color.toLowerCase(), read('red', bomber).parts.front.color.toLowerCase());
});
