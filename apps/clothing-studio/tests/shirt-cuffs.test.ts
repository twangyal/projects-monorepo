import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import { CUFFED_SLEEVE, SHIRT_CUFF_CM, optionsOf, partsOf, patternPieces, teeDimensions, teeMesh, template, topMeasurements, validateProduct, withOptions, withSleeveLength, type Product } from '../src/product.ts';

const shirt = template('shirt') as Product;
const cuffed = withOptions(shirt, { ...optionsOf(shirt), cuffs: true });

test('a long-sleeved shirt\'s cuffs are their own parts, woven in the sleeves\' style, and only such a shirt has them', () => {
  assert.ok(partsOf(cuffed).includes('cuffLeft') && partsOf(cuffed).includes('cuffRight') && !partsOf(shirt).includes('cuffLeft'));
  assert.deepEqual(cuffed.parts.cuffLeft, shirt.parts.sleeveLeft);
  assert.equal(validateProduct(cuffed).options?.cuffs, true);
  assert.equal(withOptions(cuffed, { ...optionsOf(cuffed), cuffs: false }).parts.cuffLeft, undefined);
  assert.throws(() => withOptions(template('blank'), { ...optionsOf(template('blank')), cuffs: true }), /Cuffs go on a long-sleeved shirt/);
  assert.throws(() => validateProduct({ ...cuffed, measurements: { ...topMeasurements(cuffed), sleeve: 30 } }), /Cuffs go on a long-sleeved shirt/);
  // Shortened below CUFFED_SLEEVE, the sleeves lose their cuffs.
  const short = withSleeveLength(structuredClone(cuffed), CUFFED_SLEEVE - 10);
  assert.equal(short.options?.cuffs, undefined);
  assert.equal(short.parts.cuffLeft, undefined);
});

test('each sleeve stops a cuff short of its length, cut wider, and the cuff is a folded piece as long as the opening', () => {
  const dims = teeDimensions(cuffed), plain = teeDimensions(shirt);
  assert.equal(dims.cuffHeight, SHIRT_CUFF_CM);
  assert.equal(plain.cuffHeight, 0);
  const sleeve = (product: Product) => patternPieces(product).find(piece => piece.part === 'sleeveLeft')!;
  assert.ok(sleeve(cuffed).height < sleeve(shirt).height - SHIRT_CUFF_CM + 1, `${sleeve(cuffed).height} against ${sleeve(shirt).height}`);
  const cuff = patternPieces(cuffed).find(piece => piece.part === 'cuffLeft')!;
  assert.ok(Math.abs(cuff.width - (dims.cuffHalf * 2 + 2)) < 1e-9 && Math.abs(cuff.height - SHIRT_CUFF_CM * 2) < 1e-9);
  // In 3D the woven cuff is as round as the opening, not cut shorter like a rib cuff.
  const mesh = teeMesh(cuffed, Delaunator).find(part => part.part === 'cuffLeft')!;
  const us = mesh.uvs.filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.max(...us) - Math.min(...us) - dims.cuffHalf * 2) < 0.01, `${Math.max(...us) - Math.min(...us)} against ${dims.cuffHalf * 2}`);
});

test('a cuffed shirt drapes and settles, and the tech pack sets the cuffs instead of hemming the sleeves', () => {
  const result = simulateGarment(cuffed, teeMesh(cuffed, Delaunator), 94, { frames: 120 });
  assert.equal(result.parts.filter(part => part.part.startsWith('cuff')).length, 2);
  assert.ok(result.metrics.maxStrain < 0.5 && result.metrics.residualSpeed < 10, `strain ${result.metrics.maxStrain}, speed ${result.metrics.residualSpeed}`);
  const rows = buildTechPack(cuffed, '2026-11-18').construction.map(row => row.area);
  assert.ok(rows.includes('Cuffs') && !rows.includes('Sleeve hems'), rows.join(', '));
  assert.ok(buildTechPack(shirt, '2026-11-18').construction.some(row => row.area === 'Sleeve hems'));
});

test('cuffs are described by name and colour, and a short-sleeved shirt is told why it has none', () => {
  const white = readDesignPrompt('white cuffs', shirt).product;
  assert.ok(optionsOf(white).cuffs);
  assert.equal(white.parts.cuffLeft!.color, '#f7f7f4');
  assert.equal(white.parts.sleeveLeft.color, shirt.parts.sleeveLeft.color);
  assert.notEqual(readDesignPrompt('contrast cuffs', shirt).product.parts.cuffRight!.color, shirt.parts.sleeveRight.color);
  assert.ok(optionsOf(readDesignPrompt('barrel cuffs', shirt).product).cuffs);
  assert.equal(optionsOf(readDesignPrompt('no cuffs', white).product).cuffs, undefined);
  const short = readDesignPrompt('short sleeves', shirt).product;
  assert.throws(() => readDesignPrompt('white cuffs', short), /cuffs \(they go on a long-sleeved shirt: make the sleeves at least 45 cm\)/);
});
