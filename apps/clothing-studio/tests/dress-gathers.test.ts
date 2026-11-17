import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { designDifferences } from '../src/design-diff.ts';
import { createProject } from '../src/model.ts';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { SIZES, optionsOf, patternPieces, seamHalfAt, teeDimensions, teeMesh, template, topMeasurements, validateProduct, withOptions, type Product } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';

const flare = template('fit-flare') as Product;
const gathered = (gather: number, product: Product = flare) => validateProduct({ ...product, measurements: { ...topMeasurements(product), gather } });
type Pt = { x: number; y: number };
const span = (points: Pt[]) => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
const near = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} against ${expected}`);

test('a gathered skirt is cut wider at the waist than the seam it is gathered into, easing to the hem', () => {
  const product = gathered(1.5), d = teeDimensions(product), seam = 2 * seamHalfAt(d, d.waistY);
  const pieces = patternPieces(product), smooth = patternPieces(flare);
  const edge = (outline: Pt[], y: number) => span(outline.filter(p => Math.abs(p.y - y) < 1e-6));
  for (const part of ['skirtFront', 'skirtBack']) {
    const skirt = pieces.find(piece => piece.part === part)!, plain = smooth.find(piece => piece.part === part)!;
    // The smooth skirt's waist edge is the seam (to the outline's precision); the gathered one is half as long again.
    assert.ok(Math.abs(edge(plain.outline, 0) - seam) < 0.01);
    near(edge(skirt.outline, 0), edge(plain.outline, 0) * 1.5, `${part} waist edge`);
    near(edge(skirt.outline, skirt.height), edge(plain.outline, plain.height), `${part} hem`);
    near(skirt.height, plain.height);
  }
  // The bodice is cut as before: only the skirt carries the extra fabric.
  for (const part of ['front', 'back']) assert.deepEqual(pieces.find(piece => piece.part === part)!.outline, smooth.find(piece => piece.part === part)!.outline);
});

test('gathering needs a waist seam and a hem at least as long as the gathered edge, and follows the seam', () => {
  assert.throws(() => gathered(1.5, template('tee-dress') as Product), /Skirt gathering goes on a dress cut at the waist: add the waist seam first/);
  assert.throws(() => gathered(2), /A gathered skirt's waist edge \(80\.0 cm a piece\) must be no longer than its hem \(76\.0 cm\)/);
  assert.throws(() => gathered(1.05), /Skirt gathering \(× waist seam\) must be from 1\.1 to 2/);
  // Taking the seam off sews the body in one piece again, without gathers; grading keeps them.
  const product = gathered(1.5);
  assert.equal(topMeasurements(validateProduct(withOptions(product, { ...optionsOf(product), waistSeam: false }))).gather, undefined);
  assert.equal(topMeasurements(gradedProduct(product, 'L')).gather, 1.5);
});

test('every size of a gathered dress has the hem to gather its waist edge from, even cut at the limit', () => {
  // A described gathered T-shirt dress is cut with its gathered edge exactly as long as its hem.
  const dress = readDesignPrompt('gathered dress', template('blank') as Product).product;
  for (const size of SIZES) {
    const graded = gradedProduct(dress, size), d = teeDimensions(graded);
    assert.ok(2 * seamHalfAt(d, d.waistY) * 1.5 <= 2 * d.hemHalf + 1e-9, `${size}: ${2 * seamHalfAt(d, d.waistY) * 1.5} against ${2 * d.hemHalf}`);
  }
  assert.equal(gradedProduct(dress, 'XL').fit?.hemWidth, 81 + 2 * 3.75);
});

test('in 3D the gathered skirt starts on the seam at its finished length and drapes into gathers, settled', () => {
  const product = gathered(1.5), d = teeDimensions(product), meshes = teeMesh(product, Delaunator), waistY = d.length - d.waistY;
  const skirt = meshes.find(mesh => mesh.part === 'skirtFront')!, row: { x: number; u: number }[] = [];
  for (let v = 0; v < skirt.positions.length / 3; v++) if (Math.abs(skirt.positions[v * 3 + 1]! - waistY) < 1e-6) row.push({ x: skirt.positions[v * 3]!, u: skirt.uvs[v * 2]! });
  // The waist row is sewn at the seam's length, while its flat pattern positions are one and a half times as far apart.
  const xs = row.map(p => p.x), us = row.map(p => p.u);
  near((Math.max(...us) - Math.min(...us)) / (Math.max(...xs) - Math.min(...xs)), 1.5, 'cut against sewn waist edge');
  const smooth = simulateGarment(flare, teeMesh(flare, Delaunator), defaultBodyChest(flare));
  const full = simulateGarment(product, meshes, defaultBodyChest(product));
  for (const result of [smooth, full]) {
    assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
    assert.ok(result.metrics.residualSpeed < 10, `still moving at ${result.metrics.residualSpeed} cm/s`);
    assert.ok(result.metrics.minClearance >= 0.3, `clearance ${result.metrics.minClearance}`);
  }
  // The extra fabric stands off the body in folds rather than lying on it.
  assert.ok(full.metrics.contact < smooth.metrics.contact * 0.85, `contact ${full.metrics.contact} against ${smooth.metrics.contact}`);
});

test('the tech pack gathers the skirt into the seam, and the change list names the gathering', () => {
  const product = gathered(1.5), d = teeDimensions(product);
  const seam = buildTechPack(product, '2026-11-17').construction.find(row => row.area === 'Waist seam')!;
  assert.match(seam.operation, /Run two gathering rows along each skirt’s waist edge, draw it up to the bodice’s/);
  assert.match(seam.detail, new RegExp(`cut 1\\.5× the seam \\(${(2 * seamHalfAt(d, d.waistY) * 1.5).toFixed(1)} cm against ${(2 * seamHalfAt(d, d.waistY)).toFixed(1)} cm\\)`));
  assert.doesNotMatch(buildTechPack(flare, '2026-11-17').construction.find(row => row.area === 'Waist seam')!.operation, /gathering/);
  const project = (design: Product) => ({ ...createProject(), title: 'Dress', product: design });
  assert.ok(designDifferences(project(flare), project(product)).includes('Gathering: none → 1.5 times'));
});

test('descriptions gather a dress skirt into a waist seam, widening the hem a straight dress needs', () => {
  const read = (said: string, product: Product = template('blank') as Product) => readDesignPrompt(said, product).product;
  // A fit-and-flare dress has the hem for it.
  assert.equal(topMeasurements(read('gathered skirt', flare)).gather, 1.5);
  assert.equal(read('gathered skirt', flare).fit?.hemWidth, 76);
  // A T-shirt dress is cut at the waist, kept to the chest's width there, and its hem widened to the gathered edge.
  for (const said of ['dress with a gathered skirt', 'gathered dress in navy', 'dirndl dress']) {
    const dress = read(said);
    assert.deepEqual([optionsOf(dress).waistSeam, topMeasurements(dress).gather, dress.fit?.waistWidth, dress.fit?.hemWidth], [true, 1.5, 54, 81], said);
  }
  assert.equal(topMeasurements(read('gathered skirt', template('tee-dress') as Product)).gather, 1.5);
  assert.equal(topMeasurements(read('smooth skirt', gathered(1.5))).gather, undefined);
  // "Skirt" on a dress cut at the waist is its skirt, not a separate skirt.
  const navy = read('navy skirt', flare);
  assert.equal(navy.base, 'tee');
  assert.equal(navy.parts.skirtFront.color, '#1f2a4f');
  // A top too short for a skirt, and gathers said without a seam, are not applied.
  assert.ok(readDesignPrompt('gathered dress with no waist seam', template('blank') as Product).ignored.some(word => /^gathered dress \(a gathered skirt goes on a T-shirt dress at least 85 cm long/.test(word)));
  assert.equal(topMeasurements(read('tee with gathered sleeves')).length, 72);
});
