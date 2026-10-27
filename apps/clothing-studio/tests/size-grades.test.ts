import test from 'node:test';
import assert from 'node:assert/strict';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';
import { SIZES, fitValues, legMeasurements, template, topMeasurements, type Product } from '../src/product.ts';

test('a size step grades a top by its chest, length and sleeve, and edited fit points by their own increments', () => {
  const tee: Product = { ...template('blank'), fit: { shoulderWidth: 46, backNeckDrop: 2.5 } };
  assert.equal(gradedProduct(tee, 'M'), tee, 'the sample size is the design itself');
  const large = gradedProduct(tee, 'L'), small = gradedProduct(tee, 'XS');
  assert.deepEqual(large.measurements, { chest: 109, length: 73.5, sleeve: 21.5 });
  assert.deepEqual(small.measurements, { chest: 94, length: 69, sleeve: 20 });
  assert.equal(large.fit?.shoulderWidth, 47.5); assert.equal(small.fit?.shoulderWidth, 43);
  assert.equal(large.fit?.backNeckDrop, 2.5, 'a point without an increment stays');
  assert.equal(large.spec?.sampleSize, 'L', 'the graded design is its own sample');
  // A point left at a fixed default grades by its own increment; proportional ones follow the chest.
  const hoodie = template('hoodie');
  assert.equal(fitValues(gradedProduct(hoodie, 'XL')).hoodHeight, fitValues(hoodie).hoodHeight + 1);
  assert.ok(fitValues(gradedProduct(hoodie, 'L')).armholeDepth > fitValues(hoodie).armholeDepth);
  // Long sleeves grade more than short ones.
  assert.equal(topMeasurements(gradedProduct(template('breton'), 'L')).sleeve, 59);
});

test('shorts and trousers grade by waist, hip, rise and leg opening; skirts are not graded', () => {
  const large = legMeasurements(gradedProduct(template('trousers'), 'L')), sample = legMeasurements(template('trousers'));
  assert.deepEqual([large.waist - sample.waist, large.hip - sample.hip, large.rise - sample.rise, large.inseam - sample.inseam, large.legOpening - sample.legOpening], [5, 5, 0.5, 0, 1]);
  assert.throws(() => gradedProduct(template('flared-skirt'), 'L'), /not graded/);
  assert.equal(gradedProduct(template('flared-skirt'), 'M').base, 'skirt');
});

test('the tech pack measures every size from the graded design', () => {
  for (const id of ['blank', 'hoodie', 'trousers']) {
    const design = template(id), pack = buildTechPack(design, '2026-10-27');
    for (const size of SIZES) {
      const own = buildTechPack(gradedProduct(design, size), '2026-10-27');
      for (const pom of pack.poms) assert.equal(pom.values[size], own.poms.find(other => other.code === pom.code)!.values[size], `${id} ${size} ${pom.code}`);
    }
    // Sizes still grow in order.
    const first = pack.poms[0]!;
    for (let i = 1; i < SIZES.length; i++) assert.ok(first.values[SIZES[i]!] > first.values[SIZES[i - 1]!]);
  }
});

test('a size outside the supported measurements keeps fixed increments and says so', () => {
  const big: Product = { ...template('blank'), measurements: { chest: 146, length: 72, sleeve: 21 } };
  assert.throws(() => gradedProduct(big, 'XL'), /Size XL would be outside the supported measurements/);
  const pack = buildTechPack(big, '2026-10-27');
  assert.match(pack.notes.at(-1)!, /^Sizes L, XL would fall outside the supported measurements, so their columns use fixed grade increments\.$/);
  assert.equal(pack.poms[0]!.values.XL, pack.poms[0]!.values.M + 5, 'two fixed steps of the half chest');
});
