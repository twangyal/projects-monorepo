import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { designDifferences } from '../src/design-diff.ts';
import { createProject } from '../src/model.ts';
import { clothFromMeshes, defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { material, optionsOf, partsOf, patternPieces, seamHalfAt, teeDimensions, teeMesh, template, topMeasurements, validateProduct, withOptions, type Product } from '../src/product.ts';
import { buildTechPack, measurementDiagram } from '../src/techpack.ts';

const dress = template('tee-dress') as Product;
const seamed = (product: Product = dress) => validateProduct(withOptions(product, { ...optionsOf(product), waistSeam: true }));
type Pt = { x: number; y: number };
const edgeAt = (outline: Pt[], y: number) => outline.filter(p => Math.abs(p.y - y) < 1e-6);
const length = (points: Pt[]) => Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x));
const area = (outline: Pt[]) => Math.abs(outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]!; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;

test('a waist seam cuts a dress into a bodice and a skirt that start in the body style and can be styled apart', () => {
  const product = seamed();
  assert.deepEqual(partsOf(product).filter(part => part.startsWith('skirt')), ['skirtFront', 'skirtBack']);
  assert.deepEqual(product.parts.skirtFront, product.parts.front);
  assert.deepEqual(product.parts.skirtBack, product.parts.back);
  // A skirt in its own fabric and colour stays through validation, and taking the seam off sews the body back in one.
  const styled = validateProduct({ ...product, parts: { ...product.parts, skirtFront: { material: 'linen-170', color: '#aa3344', print: null }, skirtBack: { material: 'linen-170', color: '#aa3344', print: null } } });
  assert.equal(styled.parts.skirtFront.material, 'linen-170');
  const plain = validateProduct(withOptions(styled, { ...optionsOf(styled), waistSeam: false }));
  assert.equal('skirtFront' in plain.parts, false);
  assert.deepEqual(patternPieces(plain).map(piece => piece.part), patternPieces(dress).map(piece => piece.part));
  // Colourways gain and lose the skirt with the seam.
  const coloured = validateProduct({ ...dress, colorways: [{ id: 'c1', name: 'Rust', parts: structuredClone(dress.parts), units: 10 }] });
  assert.ok('skirtBack' in seamed(coloured).colorways![0]!.parts);
});

test('a waist seam goes only on a dress, at a waist line inside it', () => {
  assert.throws(() => seamed(template('blank') as Product), /A waist seam goes on a T-shirt dress: lengthen it to at least 85 cm/);
  assert.throws(() => seamed(template('sweat-dress') as Product), /A waist seam goes on a T-shirt dress/);
  assert.throws(() => validateProduct({ ...seamed(), measurements: { ...topMeasurements(dress), length: 72 } }), /at least 85 cm long: lengthen it or take the waist seam off/);
  assert.throws(() => validateProduct({ ...dress, options: { hem: 'straight', chestPocket: false, waistSeam: 'yes' as unknown as boolean } }), /A waist seam must be on or off/);
  assert.throws(() => validateProduct({ ...seamed(), fit: { ...dress.fit, waistPosition: 30 } }), /Waist position must be between/);
});

test('the bodice and skirt pieces meet along a waist seam of the same length, and together are the whole body', () => {
  const product = seamed(), d = teeDimensions(product), pieces = patternPieces(product), whole = patternPieces(dress);
  for (const [bodyPart, skirtPart] of [['front', 'skirtFront'], ['back', 'skirtBack']] as const) {
    const bodice = pieces.find(piece => piece.part === bodyPart)!, skirt = pieces.find(piece => piece.part === skirtPart)!;
    assert.ok(Math.abs(bodice.height - d.waistY) < 1e-6, `${bodyPart} ends at the waist line`);
    // Both pieces are laid out from x = 0, so their sizes are their own.
    assert.ok(Math.abs(Math.min(...bodice.outline.map(q => q.x))) < 1e-9 && Math.abs(Math.min(...skirt.outline.map(q => q.x))) < 1e-9);
    assert.ok(Math.abs(skirt.height - (d.length - d.waistY)) < 1e-6, `${skirtPart} hangs from it to the hem`);
    const waistEdge = length(edgeAt(bodice.outline, d.waistY)), skirtTop = length(edgeAt(skirt.outline, 0));
    assert.ok(Math.abs(waistEdge - skirtTop) < 1e-6, `${bodyPart} ${waistEdge} against ${skirtTop}`);
    assert.ok(Math.abs(waistEdge - 2 * seamHalfAt(d, d.waistY)) < 1e-6);
    // The skirt flares from the seam to the hem width.
    assert.ok(Math.abs(skirt.width - d.hemHalf * 2) < 1e-6);
    assert.ok(Math.abs(area(bodice.outline) + area(skirt.outline) - area(whole.find(piece => piece.part === bodyPart)!.outline)) < 0.5);
  }
});

test('in 3D the skirt is sewn to the bodice, so the dress drapes as one garment', () => {
  const product = seamed(), d = teeDimensions(product), meshes = teeMesh(product, Delaunator), waistY = d.length - d.waistY;
  const vertices = (part: string) => { const mesh = meshes.find(item => item.part === part)!; return Array.from({ length: mesh.positions.length / 3 }, (_, v) => mesh.positions.slice(v * 3, v * 3 + 3)); };
  const key = (p: number[]) => p.map(value => Math.round(value * 1000)).join(',');
  for (const [bodyPart, skirtPart] of [['front', 'skirtFront'], ['back', 'skirtBack']]) {
    const bodice = new Set(vertices(bodyPart!).map(key)), seam = vertices(skirtPart!).filter(p => Math.abs(p[1]! - waistY) < 1e-6);
    assert.ok(seam.length > 10, `${skirtPart} has a waist edge`);
    assert.ok(seam.every(p => bodice.has(key(p))), `every waist point of the ${skirtPart} is a point of the ${bodyPart}`);
  }
  const cloth = clothFromMeshes(meshes, part => material(product.parts[part].material));
  const unseamed = clothFromMeshes(teeMesh(dress, Delaunator), part => material(dress.parts[part].material));
  assert.ok(cloth.positions.length / 3 - unseamed.positions.length / 3 < 60, 'the seam adds only its own points');
  const result = simulateGarment(product, meshes, defaultBodyChest(product), { frames: 90 });
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
  assert.ok(result.metrics.minClearance >= 0.3, `clearance ${result.metrics.minClearance}`);
});

test('a waist cut through a shaped side seam leaves no sliver edges, so the fit-and-flare dress drapes without overstretching', () => {
  const product = template('fit-flare') as Product;
  for (const piece of patternPieces(product).filter(item => ['front', 'back', 'skirtFront', 'skirtBack'].includes(item.part))) {
    const shortest = Math.min(...piece.outline.map((q, i) => { const next = piece.outline[(i + 1) % piece.outline.length]!; return Math.hypot(next.x - q.x, next.y - q.y); }));
    assert.ok(shortest >= 0.5, `${piece.part} has a ${shortest.toFixed(2)} cm edge`);
  }
  const result = simulateGarment(product, teeMesh(product, Delaunator), defaultBodyChest(product));
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
});

test('the tech pack lists the skirt fabric, sews the waist seam and draws the whole dress with the seam', () => {
  const product = seamed(), styled = validateProduct({ ...product, parts: { ...product.parts, skirtFront: { material: 'linen-170', color: '#aa3344', print: null }, skirtBack: { material: 'linen-170', color: '#aa3344', print: null } } });
  const pack = buildTechPack(styled, '2026-11-17'), d = teeDimensions(styled);
  assert.ok(pack.bom.some(row => /Linen/.test(row.item) && row.placement === 'Front skirt, Back skirt'), pack.bom.map(row => `${row.item}: ${row.placement}`).join(' | '));
  const seam = pack.construction.find(row => row.area === 'Waist seam')!;
  assert.match(seam.detail, new RegExp(`${d.waistY.toFixed(1)} cm below the high point shoulder, before the side seams`));
  assert.ok(pack.construction.findIndex(row => row.area === 'Waist seam') < pack.construction.findIndex(row => row.area === 'Side seams'));
  const diagram = measurementDiagram(styled);
  assert.match(diagram, /data-waist-seam="front"/);
  // The whole front is drawn, down to the hem, not just the bodice.
  assert.match(diagram, new RegExp(`viewBox="-6 -6 [\\d.]+ ${(d.length + 12).toFixed(0)}`));
  assert.doesNotMatch(measurementDiagram(dress), /data-waist-seam/);
});

test('the fit-and-flare template and descriptions cut dresses at the waist, and the skirt can be styled by name', () => {
  const template_ = template('fit-flare') as Product;
  assert.equal(optionsOf(template_).waistSeam, true);
  // Its bodice is as wide as the chest panel (50 cm), not the flared skirt.
  assert.ok(Math.abs(patternPieces(template_).find(piece => piece.part === 'front')!.width - 50) < 1e-6);
  assert.equal(teeDimensions(template_).shaped, true);
  assert.notDeepEqual(template_.parts.skirtFront, template_.parts.front);
  const skater = readDesignPrompt('skater dress with a polka dot skirt', template('blank') as Product);
  assert.equal(optionsOf(skater.product).waistSeam, true);
  assert.equal(skater.product.parts.skirtFront.print?.motif, 'dots');
  assert.equal(skater.product.parts.front.print, null);
  const seamWords = readDesignPrompt('a red dress with a waist seam and a navy skirt', template('blank') as Product);
  assert.equal(optionsOf(seamWords.product).waistSeam, true);
  assert.deepEqual([seamWords.product.parts.front.color, seamWords.product.parts.skirtBack.color], ['#b23a2e', '#1f2a4f']);
  assert.ok(readDesignPrompt('tee with a waist seam', template('blank') as Product).ignored.includes('waist seam (it goes on a dress at least 85 cm long)'));
  assert.equal(optionsOf(readDesignPrompt('no waist seam', template_).product).waistSeam, undefined);
  // A white bodice leaves the skirt as it was.
  const bodice = readDesignPrompt('white bodice', template_).product;
  assert.deepEqual([bodice.parts.front.color, bodice.parts.skirtFront.color], ['#f7f7f4', '#1f2a4f']);
  const project = (product: Product) => ({ ...createProject(), title: 'Dress', product });
  const lines = designDifferences(project(dress), project(seamed()));
  assert.ok(lines.includes('Waist seam: off → on'), lines.join(' | '));
});
