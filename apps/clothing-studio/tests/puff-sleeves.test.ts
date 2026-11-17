import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { designDifferences } from '../src/design-diff.ts';
import { createProject } from '../src/model.ts';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { SIZES, patternPieces, sleeveCap, teeMesh, template, topMeasurements, validateProduct, withSleeveLength, type Product } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';

const tee = template('blank') as Product;
const puffed = (gather: number, product: Product = tee) => validateProduct({ ...product, measurements: { ...topMeasurements(product), sleeveGather: gather } });
type Pt = { x: number; y: number };
const span = (points: Pt[]) => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));

test('a puff sleeve cap is cut that many times as long as its armhole, spread most at the top, the opening as drafted', () => {
  const plain = sleeveCap(tee);
  assert.ok(Math.abs(plain.cut / plain.armhole - 1.03) < 1e-6, 'a plain cap is eased 3%');
  for (const gather of [1.2, 1.5, 1.7]) {
    const cap = sleeveCap(puffed(gather));
    assert.ok(Math.abs(cap.cut / cap.armhole - gather) < 1e-3, `${gather}: ${cap.cut} against ${cap.armhole}`);
    assert.ok(Math.abs(cap.armhole - plain.armhole) < 1e-9, 'the armhole is unchanged');
  }
  const piece = patternPieces(puffed(1.5)).find(item => item.part === 'sleeveLeft')!, drafted = patternPieces(tee).find(item => item.part === 'sleeveLeft')!;
  // Wider than the plain sleeve at the cap, the same at the opening.
  assert.ok(piece.width > drafted.width + 5, `${piece.width} against ${drafted.width}`);
  const bottom = (outline: Pt[]) => span(outline.filter(p => Math.abs(p.y - Math.max(...outline.map(q => q.y))) < 1e-6));
  assert.ok(Math.abs(bottom(piece.outline) - bottom(drafted.outline)) < 1e-6);
});

test('puff sleeves go on T-shirts with sleeves, within their range, and go when the sleeves do', () => {
  assert.throws(() => puffed(1.5, template('crew-sweat') as Product), /Puff sleeves go on T-shirts, shirts and tee dresses/);
  assert.throws(() => validateProduct({ ...tee, measurements: { ...topMeasurements(tee), sleeve: 0, sleeveGather: 1.5 } }), /A sleeveless top has no sleeves to puff/);
  assert.throws(() => puffed(1.8), /Sleeve cap gathering \(× armhole\) must be from 1\.2 to 1\.7/);
  const product = puffed(1.5);
  assert.equal(topMeasurements(withSleeveLength(structuredClone(product), 0)).sleeveGather, undefined);
  for (const size of SIZES) assert.equal(topMeasurements(gradedProduct(product, size)).sleeveGather, 1.5, size);
  // A shirt's long sleeves and a dress's are puffed the same way.
  for (const id of ['shirt', 'fit-flare']) { const cap = sleeveCap(puffed(1.5, template(id) as Product)); assert.ok(Math.abs(cap.cut / cap.armhole - 1.5) < 1e-3, id); }
});

test('in 3D the sleeve is sewn to the armhole at its length and puffs out from it in the drape, settled', () => {
  const product = puffed(1.5), meshes = teeMesh(product, Delaunator);
  // The sleeve's first row is the armhole, while its flat cap is the spread one.
  const sleeve = meshes.find(mesh => mesh.part === 'sleeveLeft')!, plain = teeMesh(tee, Delaunator).find(mesh => mesh.part === 'sleeveLeft')!;
  assert.deepEqual(sleeve.positions.slice(0, 30), plain.positions.slice(0, 30));
  const uSpan = (mesh: typeof sleeve, rows: number) => { const us = Array.from({ length: rows }, (_, i) => mesh.uvs[i * 2]!); return Math.max(...us) - Math.min(...us); };
  assert.ok(uSpan(sleeve, 20) > uSpan(plain, 20) * 1.2, 'the cap is cut wider than it is sewn');
  const depth = (product: Product) => {
    const result = simulateGarment(product, teeMesh(product, Delaunator), defaultBodyChest(product));
    const points = [...result.parts.find(part => part.part === 'sleeveLeft')!.positions];
    let near = Infinity; for (let i = 0; i < points.length; i += 3) near = Math.min(near, points[i]!);
    const zs: number[] = []; for (let i = 0; i < points.length; i += 3) if (points[i]! < near + 8) zs.push(points[i + 2]!);
    return { depth: Math.max(...zs) - Math.min(...zs), metrics: result.metrics };
  };
  const flat = depth(tee), puff = depth(product);
  for (const { metrics } of [flat, puff]) {
    assert.ok(metrics.maxStrain < 0.5, `stretch ${metrics.maxStrain}`);
    assert.ok(metrics.residualSpeed < 10, `still moving at ${metrics.residualSpeed} cm/s`);
    assert.ok(metrics.minClearance >= 0.3, `clearance ${metrics.minClearance}`);
  }
  assert.ok(puff.depth > flat.depth + 3, `the sleeve top stands ${puff.depth} cm deep against ${flat.depth}`);
});

test('the tech pack gathers each cap into its armhole, and the change list names it', () => {
  const product = puffed(1.5), cap = sleeveCap(product);
  const row = buildTechPack(product, '2026-11-17').construction.find(step => step.area === 'Sleeves')!;
  assert.match(row.operation, /Run two gathering rows over each sleeve cap, draw it up to the armhole/);
  assert.match(row.detail, new RegExp(`each cap is cut 1\\.5× its armhole \\(${cap.cut.toFixed(1)} cm against ${cap.armhole.toFixed(1)} cm\\)`));
  assert.equal(buildTechPack(tee, '2026-11-17').construction.find(step => step.area === 'Sleeves')!.operation, '4-thread overlock (set in flat)');
  const project = (design: Product) => ({ ...createProject(), title: 'Tee', product: design });
  assert.ok(designDifferences(project(tee), project(product)).includes('Sleeve cap gathering: none → 1.5 times'));
});

test('descriptions puff a top\'s sleeves, and plain sleeves take the puff out', () => {
  const read = (said: string, product: Product = tee) => readDesignPrompt(said, product);
  assert.equal(topMeasurements(read('puff sleeves').product).sleeveGather, 1.5);
  // Styling the sleeves in the same words still styles them.
  const styled = read('white tee with puffed sleeves and navy sleeves').product;
  assert.deepEqual([topMeasurements(styled).sleeveGather, styled.parts.sleeveLeft.color], [1.5, '#1f2a4f']);
  const dress = read('a dress with puff sleeves and a gathered skirt').product;
  assert.deepEqual([topMeasurements(dress).sleeveGather, topMeasurements(dress).gather], [1.5, 1.5]);
  assert.equal(topMeasurements(read('plain sleeves', puffed(1.5)).product).sleeveGather, undefined);
  assert.ok(read('tank top with puff sleeves').ignored.includes('puff sleeves (a sleeveless top has no sleeves)'));
});
