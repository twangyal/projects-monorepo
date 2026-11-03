import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { CROP_LENGTH, garmentName, teeMesh, template, topMeasurements, validateProduct } from '../src/product.ts';
import { buildTechPack } from '../src/techpack.ts';

test('a top that ends above the waist is a crop top, and descriptions make one', () => {
  assert.equal(garmentName(template('crop-top')), 'Crop top');
  assert.equal(buildTechPack(template('crop-top'), '2026-11-03').base, 'Crop top');
  const short = template('crew-sweat');
  short.measurements = { ...topMeasurements(short), length: CROP_LENGTH };
  assert.equal(garmentName(validateProduct(short)), 'Cropped sweatshirt');
  const read = (from: string, said: string) => readDesignPrompt(said, template(from));
  const black = read('blank', 'black crop top');
  assert.deepEqual([garmentName(black.product), topMeasurements(black.product).length], ['Crop top', 46]);
  assert.deepEqual(black.scopes[0]!.understood, ['garment: Crop top, 46 cm long']);
  assert.equal(read('trousers', 'white crop top').scopes[0]!.understood[0], 'garment: Crop top, started from its template');
  assert.equal(topMeasurements(read('hoodie', 'cropped hoodie').product).length, 52);
  assert.equal(garmentName(read('blank', 'cropped tank top').product), 'Cropped tank top');
  // The shortest tee the studio makes is still a garment: its armhole ends above the hem.
  const tiny = template('blank');
  tiny.measurements = { ...topMeasurements(tiny), length: 40 };
  assert.equal(garmentName(validateProduct(tiny)), 'Crop top');
  tiny.measurements = { ...topMeasurements(tiny), length: 39 };
  assert.throws(() => validateProduct(tiny), /Body length/);
});

test('a crop top drapes with its hem above the hip', () => {
  const top = template('crop-top'), result = simulateGarment(top, teeMesh(top, Delaunator), defaultBodyChest(top));
  assert.ok(result.metrics.fit!.hemBelowHip! < 0, `hem ${result.metrics.fit!.hemBelowHip} cm below the hip`);
  assert.ok(result.metrics.minClearance >= 0.34, `clearance ${result.metrics.minClearance}`);
  assert.ok(result.metrics.maxStrain < 0.5);
});
