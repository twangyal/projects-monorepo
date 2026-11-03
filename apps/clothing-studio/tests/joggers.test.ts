import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { garmentName, legMeasurements, partName, partsOf, patternPieces, template, teeMesh, trouserDimensions, validateProduct, withLegCuffs } from '../src/product.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';

test('ankle cuffs make trousers joggers, measured to the cuff edge, and come off again', () => {
  const joggers = template('joggers'), plain = template('trousers');
  assert.equal(garmentName(joggers), 'Joggers');
  assert.deepEqual(partsOf(joggers), ['front', 'back', 'waistband', 'cuffLeft', 'cuffRight']);
  assert.equal(partName(joggers, 'cuffLeft'), 'Left ankle cuff');
  const cuffed = withLegCuffs(plain, 8);
  assert.equal(garmentName(cuffed), 'Joggers');
  assert.equal(cuffed.parts.cuffLeft.material, 'rib-220');
  assert.equal(cuffed.parts.cuffLeft.color, plain.parts.front.color);
  // The inseam is to the cuff edge: the leg panels are the cuff's height shorter, the outseam the same.
  assert.equal(trouserDimensions(cuffed).inseam, legMeasurements(plain).inseam - 8);
  assert.equal(trouserDimensions(cuffed).outseam, trouserDimensions(plain).outseam);
  const back = withLegCuffs(cuffed, 0);
  assert.deepEqual(back, plain);
  assert.throws(() => withLegCuffs(template('shorts'), 8), /Shorts have no ankle cuffs/);
  assert.throws(() => validateProduct({ ...joggers, measurements: { ...joggers.measurements, cuffHeight: 20 } }), /Cuff height/);
  assert.throws(() => withLegCuffs(template('blank'), 8), /Choose trousers/);
});

test('the cuffs are cut a third shorter than the leg opening and listed in the tech pack', () => {
  const joggers = template('joggers'), d = trouserDimensions(joggers);
  const cuffs = patternPieces(joggers).filter(piece => piece.part === 'cuffLeft' || piece.part === 'cuffRight');
  assert.equal(cuffs.length, 2);
  for (const cuff of cuffs) {
    assert.ok(Math.abs(cuff.width - d.legOpening * 0.66) < 1e-9);
    assert.equal(cuff.height, d.cuffHeight * 2);
  }
  const pack = buildTechPack(joggers, '2026-11-03');
  assert.ok(pack.construction.some(row => row.area === 'Ankle cuffs'));
  assert.ok(!pack.construction.some(row => row.area === 'Leg hems'));
  assert.ok(pack.poms.some(pom => pom.name === 'Cuff height'));
  assert.equal(pack.poms.find(pom => pom.name === 'Inseam')!.howToMeasure, 'Crotch seam to the cuff edge along the inside leg');
});

test('draped, each leg gathers into its cuff and the joggers settle', () => {
  const joggers = template('joggers'), result = simulateGarment(joggers, teeMesh(joggers, Delaunator), 100);
  const width = (part: string, low: number, high: number) => {
    const p = result.parts.find(item => item.part === part)!.positions;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < p.length; i += 3) if (p[i + 1]! > low && p[i + 1]! < high && p[i]! > 0) { min = Math.min(min, p[i]!); max = Math.max(max, p[i]!); }
    return max - min;
  };
  const d = trouserDimensions(joggers);
  assert.ok(width('cuffLeft', -d.cuffHeight, -d.cuffHeight + 4) < width('front', 2, 8) * 0.8, 'the cuff is narrower than the leg above it');
  assert.ok(result.metrics.residualSpeed < 10, `still moving at ${result.metrics.residualSpeed}`);
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
  // The template's cuffs end at the ankle, a little above the floor.
  const hem = result.metrics.fit!.hemAboveFloor!;
  assert.ok(hem > 0 && hem < 6, `hem ${hem} above the floor`);
});

test('described as joggers or sweatpants, trousers get ankle cuffs; as shorts, they lose them', async () => {
  const { readDesignPrompt } = await import('../src/design-prompt.ts');
  const fromTrousers = readDesignPrompt('grey sweatpants', template('trousers'));
  assert.equal(garmentName(fromTrousers.product), 'Joggers');
  const fromTee = readDesignPrompt('black joggers', template('blank'));
  assert.equal(garmentName(fromTee.product), 'Joggers');
  const shorts = readDesignPrompt('shorts', template('joggers'));
  assert.equal(garmentName(shorts.product), 'Pull-on shorts');
  assert.equal(legMeasurements(shorts.product).cuffHeight, undefined);
});
