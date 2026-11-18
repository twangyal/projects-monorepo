import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateOutfit } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import { shownThrough } from './helpers/shown-through.ts';
import {
  COAT_LENGTH, canWearTogether, garmentName, layerOrder, layeredSleeveAngle, optionsOf, sleeveAngleOf, teeMesh, template,
  topMeasurements, validateProduct, withOptions, withSleeveAngle, withSleeveLength, type Product,
} from '../src/product.ts';

const coat = template('coat') as Product, shirt = template('shirt') as Product, tee = template('blank') as Product;
const sweatshirt = template('crew-sweat') as Product, hoodie = template('hoodie') as Product;

test('a coat is a long shirt with a collar, and a shirt cut too short or given short sleeves is not one', () => {
  assert.equal(garmentName(coat), 'Coat');
  assert.equal(validateProduct(coat).options?.coat, true);
  const long = { ...shirt, measurements: { ...topMeasurements(shirt), length: 90 } };
  assert.equal(garmentName(withOptions(long, { ...optionsOf(long), coat: true })), 'Coat');
  const cropped = { ...shirt, measurements: { ...topMeasurements(shirt), length: COAT_LENGTH - 10 } };
  assert.throws(() => withOptions(cropped, { ...optionsOf(cropped), coat: true }), /A coat is a long shirt/);
  assert.throws(() => withOptions(tee, { ...optionsOf(tee), coat: true }), /A coat is a long shirt/);
  assert.throws(() => validateProduct({ ...coat, measurements: { ...topMeasurements(coat), length: COAT_LENGTH - 5 } }), /A coat is a shirt at least/);
  // Given short sleeves, a coat is a shirt again.
  const short = withSleeveLength(structuredClone(coat), 30);
  assert.equal(short.options?.coat, undefined);
  assert.notEqual(garmentName(short), 'Coat');
});

test('a coat goes over a T-shirt, shirt, polo, dress or sweatshirt, and nothing goes over a coat', () => {
  for (const inner of [tee, shirt, template('polo') as Product, template('tee-dress') as Product, sweatshirt, template('bomber') as Product, template('sweat-dress') as Product]) {
    assert.deepEqual(layerOrder(inner, coat), { inner, outer: coat }, garmentName(inner));
    assert.ok(canWearTogether(coat, inner));
  }
  // A hoodie does not go under it (its hood would lie out over the collar), and a coat is not worn under anything.
  for (const other of [hoodie, template('zip-hoodie') as Product, structuredClone(coat)]) assert.equal(layerOrder(other, coat), null, garmentName(other));
  assert.equal(layerOrder(coat, template('trousers') as Product), null);
  // The other pairs keep their order: a shirt over a tee, and a sweatshirt over a shirt.
  assert.deepEqual(layerOrder(tee, shirt), { inner: tee, outer: shirt });
  assert.equal(layerOrder(sweatshirt, shirt)?.outer, sweatshirt);
});

test('a coat has coat buttons, bound seams and blind-stitched hems', () => {
  const pack = buildTechPack(coat, '2026-11-18'), rows = new Map(pack.construction.map(row => [row.area, row]));
  assert.match(rows.get('Body hem')!.operation, /blind-stitch/);
  assert.match(rows.get('Seams')!.detail, /Unlined/);
  assert.ok(pack.bom.some(item => /coat buttons/.test(item.description)));
  // A shirt keeps its own finishing.
  assert.match(buildTechPack(shirt, '2026-11-18').construction.find(row => row.area === 'Body hem')!.operation, /coverstitch/);
});

test('a top described as a coat becomes one in its own styling; another garment starts from the coat template', () => {
  const made = readDesignPrompt('make it a coat', shirt).product;
  assert.equal(garmentName(made), 'Coat');
  assert.ok(topMeasurements(made).length >= topMeasurements(coat).length);
  assert.equal(made.parts.front.color, shirt.parts.front.color);
  const fromTee = readDesignPrompt('a long coat', tee).product;
  assert.equal(garmentName(fromTee), 'Coat');
  assert.ok(topMeasurements(fromTee).chest >= topMeasurements(coat).chest, 'cut roomy enough to go over a top');
  assert.equal(garmentName(readDesignPrompt('an overcoat', sweatshirt).product), 'Coat');
  assert.throws(() => readDesignPrompt('a waistcoat', tee), /could be applied/, 'a waistcoat is a vest, not a coat');
});

test('a top under a longer or shorter one meets its shoulders', () => {
  // A T-shirt under a coat 24 cm longer, and a T-shirt dress under a hoodie 28 cm shorter.
  const highest = (parts: { part: string; positions: ArrayLike<number> }[]) => {
    const front = parts.find(part => part.part === 'front')!;
    let top = -Infinity;
    for (let i = 1; i < front.positions.length; i += 3) top = Math.max(top, front.positions[i]!);
    return top;
  };
  for (const [outer, under] of [[coat, tee], [hoodie, template('tee-dress') as Product]] as const) {
    const inner = withSleeveAngle(under, sleeveAngleOf(outer));
    const result = simulateOutfit(outer, teeMesh(outer, Delaunator), inner, teeMesh(inner, Delaunator), 94, { frames: 60 });
    assert.ok(Math.abs(highest(result.parts) - highest(result.companion!.parts)) < 4, `${garmentName(under)} under ${garmentName(outer)}: ${highest(result.companion!.parts)} against ${highest(result.parts)}`);
  }
});

test('a sweatshirt goes under a coat: both are made for its lower arms, and none of it shows through the coat', () => {
  const pose = layeredSleeveAngle(sweatshirt, coat);
  assert.equal(pose, sleeveAngleOf(sweatshirt));
  assert.equal(layeredSleeveAngle(tee, coat), sleeveAngleOf(coat), 'a T-shirt under a coat keeps the coat\'s pose');
  const outer = withSleeveAngle(coat, pose), inner = withSleeveAngle(sweatshirt, pose), outerMeshes = teeMesh(outer, Delaunator);
  const result = simulateOutfit(outer, outerMeshes, inner, teeMesh(inner, Delaunator), 102, { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.8 && result.companion!.metrics.maxStrain < 0.8, `strain ${result.metrics.maxStrain}, ${result.companion!.metrics.maxStrain}`);
  // Its sleeves (once seen between the coat's sleeves and sides) and its body below the armholes stay under the coat.
  const armpit = result.body.torso[1]!.y, seen = shownThrough(result.parts, outerMeshes, result.companion!.parts, ['sleeveLeft', 'sleeveRight', 'cuffLeft', 'cuffRight', 'front', 'back', 'hemBand'], -Infinity, armpit, armpit + 30);
  assert.equal(seen, 0, `${seen} points of the sweatshirt show through the coat`);
});

test('a coat drapes over a T-shirt and settles', () => {
  const inner = withSleeveAngle(tee, sleeveAngleOf(coat));
  const result = simulateOutfit(coat, teeMesh(coat, Delaunator), inner, teeMesh(inner, Delaunator), 94, { frames: 150 });
  assert.ok(result.metrics.maxStrain < 0.6 && result.metrics.residualSpeed < 10, `strain ${result.metrics.maxStrain}, speed ${result.metrics.residualSpeed}`);
  assert.ok(result.companion!.parts.length > 0);
});
