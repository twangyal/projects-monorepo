import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { garmentName, partsOf, patternPieces, teeMesh, template, topMeasurements, validateProduct, withSleeveLength } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack, measurementDiagram } from '../src/techpack.ts';

test('a tee with no sleeves is a tank top: no sleeve pieces, measurements or steps, and it stays sleeveless in every size', () => {
  const tank = template('tank-top');
  assert.equal(garmentName(tank), 'Tank top');
  assert.deepEqual(partsOf(tank), ['front', 'back', 'neckband']);
  assert.deepEqual(patternPieces(tank).map(piece => piece.part), ['front', 'back', 'neckband']);
  assert.deepEqual(teeMesh(tank, Delaunator).map(mesh => mesh.part).sort(), ['back', 'front', 'neckband']);
  const pack = buildTechPack(tank, '2026-11-02');
  assert.ok(!pack.poms.some(pom => pom.code === 'C' || pom.code === 'J'));
  assert.ok(pack.construction.some(step => step.area === 'Armholes') && !pack.construction.some(step => /Sleeve/.test(step.area)));
  assert.ok(measurementDiagram(tank).startsWith('<svg'));
  for (const size of ['XS', 'XL'] as const) assert.equal(topMeasurements(gradedProduct(tank, size)).sleeve, 0);
  // Only a tee can lose its sleeves.
  const sweat = template('crew-sweat');
  sweat.measurements = { ...topMeasurements(sweat), sleeve: 0 };
  assert.throws(() => validateProduct(sweat), /Sleeve length/);
});

test('sleeves come off and back on in every colourway, starting in the front body style', () => {
  const ringer = template('ringer');
  ringer.colorways = [{ id: 'cw1', name: 'Navy', parts: structuredClone(ringer.parts), units: 100 }] as never;
  const tank = withSleeveLength(structuredClone(ringer), 0);
  assert.equal(validateProduct(tank).parts.sleeveLeft, undefined);
  assert.equal(tank.colorways![0]!.parts.sleeveLeft, undefined);
  const back = validateProduct(withSleeveLength(tank, 21));
  assert.deepEqual(back.parts.sleeveLeft, back.parts.front);
  assert.deepEqual(back.colorways![0]!.parts.sleeveRight, back.colorways![0]!.parts.front);
});

test('descriptions read tank tops and sleeveless, and keep sleeves on garments that need them', () => {
  const read = (from: string, said: string) => readDesignPrompt(said, template(from));
  const tank = read('crew-sweat', 'black tank top');
  assert.deepEqual([tank.product.base, topMeasurements(tank.product).sleeve, garmentName(tank.product)], ['tee', 0, 'Tank top']);
  assert.equal(topMeasurements(read('blank', 'sleeveless tee in sage').product).sleeve, 0);
  const sweat = read('crew-sweat', 'sleeveless sweatshirt');
  assert.equal(topMeasurements(sweat.product).sleeve, 62);
  assert.ok(sweat.ignored.some(item => /only a T-shirt can be made sleeveless/.test(item)));
});

test('a tank top drapes on the body with its armholes open', () => {
  const tank = template('tank-top'), result = simulateGarment(tank, teeMesh(tank, Delaunator), defaultBodyChest(tank));
  assert.ok(result.metrics.minClearance >= 0.34, `clearance ${result.metrics.minClearance}`);
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
  assert.ok(result.metrics.residualSpeed < 10);
});
