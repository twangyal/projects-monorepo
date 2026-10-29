import test from 'node:test';
import assert from 'node:assert/strict';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';
import { SIZES, withSkirtWaistband, patternPieces, fitValues, legMeasurements, template, topMeasurements, type Product } from '../src/product.ts';

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

test('shorts and trousers grade by waist, hip, rise and leg opening', () => {
  const large = legMeasurements(gradedProduct(template('trousers'), 'L')), sample = legMeasurements(template('trousers'));
  assert.deepEqual([large.waist - sample.waist, large.hip - sample.hip, large.rise - sample.rise, large.inseam - sample.inseam, large.legOpening - sample.legOpening], [5, 5, 0.5, 0, 1]);
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


test('skirt grades preserve the sample and band while its strip follows the graded waist', () => {
  const design: Product = { ...withSkirtWaistband(template('flared-skirt'),6), spec:{styleNumber:'SK1',season:'Summer',sampleSize:'S'} };
  const before=structuredClone(design), xl=gradedProduct(design,'XL');
  assert.deepEqual(xl.measurements,{waist:92,hem:158,slant:60,waistbandHeight:6});
  assert.deepEqual(gradedProduct(design,'XS').measurements,{waist:76,hem:134,slant:60,waistbandHeight:6});
  assert.deepEqual(xl.spec,{styleNumber:'SK1',season:'Summer',sampleSize:'XL'});
  const band=patternPieces(xl).find(p=>p.part==='waistband')!;
  assert.equal(band.width,92); assert.equal(band.height,12);
  assert.equal(gradedProduct(design,'S'),design);
  xl.parts.waistband.color='#123456'; assert.deepEqual(design,before);
  assert.deepEqual(gradedProduct(template('flared-skirt'),'L').measurements,{waist:84,hem:146,slant:60});
});

test('skirt charts grade every size and keep fixed lengths and band heights', () => {
  const design=withSkirtWaistband(template('flared-skirt'),6);
  const pack=buildTechPack(design,'2026-10-29');
  assert.deepEqual(SIZES.map(s=>pack.poms[0].values[s]),[72,76,80,84,88]);
  assert.deepEqual(SIZES.map(s=>pack.poms[1].values[s]),[128,134,140,146,152]);
  assert.deepEqual(SIZES.map(s=>pack.poms[2].values[s]),[60,60,60,60,60]);
  assert.deepEqual(SIZES.map(s=>pack.poms[3].values[s]),[6,6,6,6,6]);
  assert.doesNotMatch(pack.notes.join(' '),/repeat the measured sample/);
});

test('unsupported skirt grades refuse rather than returning the sample and charts explain fallback', () => {
  const small: Product={...template('flared-skirt'),measurements:{waist:50,hem:140,slant:60}};
  assert.throws(()=>gradedProduct(small,'XS'),/Size XS would be outside/);
  const pack=buildTechPack(small,'2026-10-29');
  assert.match(pack.notes.at(-1)!,/Sizes XS, S would fall outside/);
  assert.equal(pack.poms[0].values.XS,42);
  const wide: Product={...template('flared-skirt'),measurements:{waist:80,hem:300,slant:60}};
  assert.throws(()=>gradedProduct(wide,'L'),/Size L would be outside/);
});

test('skirt size charts retain admitted decimal measurements instead of rounding them to half centimetres',()=>{
  const design=withSkirtWaistband({...template('flared-skirt'),measurements:{waist:80.2,hem:140.2,slant:60.234}},6.234);
  const large=gradedProduct(design,'L');
  assert.deepEqual(large.measurements,{waist:84.2,hem:146.2,slant:60.234,waistbandHeight:6.234});
  const pack=buildTechPack(design,'2026-10-29');
  assert.deepEqual(pack.poms.map(p=>p.values.M),[80.2,140.2,60.234,6.234]);
  assert.deepEqual(pack.poms.map(p=>p.values.L),[84.2,146.2,60.234,6.234]);
});
