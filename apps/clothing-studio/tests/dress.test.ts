import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { DRESS_LENGTH, garmentName, teeMesh, template, topMeasurements } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';

test('a top long enough to pass the hips is a dress, in the tech pack too', () => {
  assert.equal(garmentName(template('tee-dress')), 'T-shirt dress');
  assert.equal(garmentName(template('sweat-dress')), 'Sweatshirt dress');
  assert.equal(garmentName(template('blank')), 'T-shirt');
  const longTee = template('blank');
  longTee.measurements = { ...topMeasurements(longTee), length: DRESS_LENGTH };
  assert.equal(garmentName(longTee), 'T-shirt dress');
  assert.equal(buildTechPack(template('tee-dress'), '2026-11-02').base, 'T-shirt dress');
  // Grading keeps it a dress in every size.
  for (const size of ['XS', 'XL'] as const) assert.equal(garmentName(gradedProduct(template('tee-dress'), size)), 'T-shirt dress');
});

test('descriptions name dresses, their kind and their length', () => {
  const read = (from: string, said: string) => readDesignPrompt(said, template(from)).product;
  const navy = read('blank', 'navy t-shirt dress');
  assert.deepEqual([navy.base, topMeasurements(navy).length, navy.fit?.hemWidth], ['tee', 100, 64]);
  assert.equal(topMeasurements(read('blank', 'black mini dress with long sleeves')).length, DRESS_LENGTH);
  assert.equal(read('trousers', 'oatmeal sweatshirt dress').base, 'sweatshirt');
  // A plain "dress" keeps the top it is said about, and starts from the T-shirt dress after bottoms.
  const midi = read('crew-sweat', 'a midi dress');
  assert.deepEqual([midi.base, topMeasurements(midi).length], ['sweatshirt', 115]);
  assert.equal(read('hoodie', 'grey hoodie dress').base, 'hoodie');
  assert.equal(garmentName(read('flared-skirt', 'dress in forest green')), 'T-shirt dress');
  assert.deepEqual(readDesignPrompt('knee-length dress', template('blank')).scopes[0]!.understood, ['garment: T-shirt dress, 100 cm long']);
});

test('a T-shirt dress hangs from the shoulders over the hips, settled and barely stretched', () => {
  const product = template('tee-dress'), result = simulateGarment(product, teeMesh(product, Delaunator), defaultBodyChest(product));
  const { metrics } = result, front = result.parts.find(part => part.part === 'front')!.positions;
  let low = Infinity;
  for (let i = 1; i < front.length; i += 3) low = Math.min(low, front[i]!);
  assert.ok(low > -4 && low < 2, `hem at ${low}`);
  assert.ok(metrics.fit!.hemBelowHip! > 30, `hem ${metrics.fit!.hemBelowHip} cm below the hip`);
  assert.ok(metrics.minClearance >= 0.34, `clearance ${metrics.minClearance}`);
  assert.ok(metrics.maxStrain < 0.5, `stretch ${metrics.maxStrain}`);
  assert.ok(metrics.residualSpeed < 10, `still moving at ${metrics.residualSpeed} cm/s`);
});
