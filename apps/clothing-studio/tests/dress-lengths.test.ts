import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { FLOOR_LENGTH, LIMITS, MAXI_LENGTH, teeMesh, template, topMeasurements, validateProduct, type Product } from '../src/product.ts';

const blank = template('blank') as Product;
const read = (said: string, product: Product = blank) => readDesignPrompt(said, product);

test('maxi, ankle-length and long dresses reach the ankles, floor-length ones the floor; long sleeves stay sleeves', () => {
  for (const said of ['maxi dress', 'ankle-length dress', 'long dress', 'a long cotton dress']) assert.equal(topMeasurements(read(said).product).length, MAXI_LENGTH, said);
  assert.equal(topMeasurements(read('floor length dress').product).length, FLOOR_LENGTH);
  const sleeved = read('long sleeve dress').product;
  assert.deepEqual([topMeasurements(sleeved).length, topMeasurements(sleeved).sleeve], [100, 60]);
  assert.ok(FLOOR_LENGTH <= LIMITS.length[1]);
  assert.throws(() => validateProduct({ ...blank, measurements: { ...topMeasurements(blank), length: 151 } }), /Body length \(cm\) must be from 40 to 150/);
});

test('a floor-length dress drapes over the body and settles without overstretching', () => {
  const dress = read('floor length dress').product, result = simulateGarment(dress, teeMesh(dress, Delaunator), defaultBodyChest(dress));
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
  assert.ok(result.metrics.residualSpeed < 10, `still moving at ${result.metrics.residualSpeed} cm/s`);
  assert.ok(result.metrics.minClearance >= 0.3, `clearance ${result.metrics.minClearance}`);
});

test('dress words that cannot apply say why instead of vanishing', () => {
  assert.ok(read('dress with a pleated skirt').ignored.includes('pleated skirt (a dress skirt can be gathered into its waist seam, not pleated; skirts are pleated)'));
  // "Skirt" on a dress not cut at the waist names no part: the clause is reported with how to get one.
  assert.ok(read('midi dress with navy skirt').ignored.includes('navy skirt (a dress has a separate skirt and bodice when cut at the waist: say “waist seam”)'));
  assert.equal(read('midi dress with navy skirt').product.parts.front.color, blank.parts.front.color);
  // When nothing else applies, the reason is the error.
  assert.throws(() => read('pleated skirt', template('fit-flare') as Product), /Nothing in “pleated skirt” could be applied: pleated skirt \(a dress skirt can be gathered/);
  assert.throws(() => read('puff sleeves', template('crew-sweat') as Product), /could be applied: puff sleeves \(they go on T-shirts, shirts and tee dresses\)/);
});
