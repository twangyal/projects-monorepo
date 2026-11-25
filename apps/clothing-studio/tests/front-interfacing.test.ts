import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { artworkDefaults, material, optionsOf, patternPieces, patternKey, patternLabel, patternFabric, template, teeMesh, topMeasurements, validateProduct, withOptions, withSleeveLength, type Product } from '../src/product.ts';
import { pngUrl } from './helpers/raster.ts';
import { buildCloth, clothFromMeshes, simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack, fabricUsage } from '../src/techpack.ts';
import { readStylePrompt } from '../src/style-prompt.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { patternSvg, patternDxf, layoutPattern } from '../src/pattern-export.ts';
import { tiledProductPatternHtml } from '../src/product-print-pattern.ts';
import { gradedProduct } from '../src/size-grades.ts';

const fused = (p: Product) => withOptions(p, { ...optionsOf(p), interfacing: true });
const support = (p: Product) => patternPieces(p).filter(piece => patternKey(piece) === 'frontInterfacing');
const mass = (cloth: ReturnType<typeof buildCloth>) => [...cloth.inverseMass].reduce((sum, inverse) => sum + (inverse ? 1 / inverse : 0), 0);

test('coat-front interfacing is optional, atomic and retained by portable product data', () => {
  const base = template('blazer'), before = structuredClone(base), p = fused(base);
  assert.equal(p.options?.interfacing, true);
  assert.equal(validateProduct(JSON.parse(JSON.stringify(p))).options?.interfacing, true);
  assert.deepEqual(withOptions(p, { ...optionsOf(p), interfacing: false }), base);
  assert.equal(withOptions(p, { ...optionsOf(p), coat: false, lapels: false }).options?.interfacing, undefined);
  for (const id of ['blank', 'shirt', 'hoodie', 'jeans'] as const) assert.throws(() => fused(template(id)), /interfacing.*coat/i);
  assert.throws(() => validateProduct({ ...p, options: { ...p.options, interfacing: 'yes' } }), /interfacing.*on or off/i);
  assert.deepEqual(base, before);
});

test('support cuts match the actual darted front at every grade and have separate material identity', () => {
  const source = template('blazer'), base = validateProduct({ ...source, measurements: { ...topMeasurements(source), bustDart: 2, waistDart: 2 } });
  for (const lapels of [false, true]) for (const size of ['XS', 'M', 'XL'] as const) {
    const p = gradedProduct(fused(withOptions(base, { ...optionsOf(base), lapels, lining: true })), size);
    const front = patternPieces(p).find(piece => piece.part === 'front' && !piece.auxiliary)!;
    const [cut] = support(p);
    assert.equal(support(p).length, 1);
    assert.ok(front.darts && front.darts.length > 0);
    assert.deepEqual(cut.outline, front.outline); assert.deepEqual(cut.darts, front.darts);
    assert.equal(cut.cutCount, 2); assert.equal(cut.areaCm2, front.areaCm2);
    assert.equal(patternLabel(p, cut), 'Front interfacing');
    assert.match(patternFabric(p, cut), /cotton.*75 gsm/i);
    const plain = withOptions(p, { ...optionsOf(p), interfacing: false });
    assert.deepEqual(fabricUsage(p), fabricUsage(plain), 'support must not be counted as shell or lining cloth');
    const pack = buildTechPack(p, '2026-11-25'), row = pack.bom.find(row => /interfacing/i.test(row.item))!;
    assert.match(row.quantity, /2 pcs/);
    assert.match(row.quantity, new RegExp((cut.areaCm2 * 2 * 1.15 / 10000).toFixed(2)));
    assert.match(pack.construction.find(row => row.area === 'Front interfacing')!.operation, /before.*sew|before.*dart/i);
  }
});

test('cutting exports label the unprinted support without changing the main front pattern', () => {
  const p = fused(template('blazer'));
  p.artwork = [{ part: 'front', dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(p, 'front') }];
  for (const text of [patternSvg(p), patternDxf(p), tiledProductPatternHtml(p, 'a4')]) {
    assert.match(text, /Front interfacing/); assert.match(text, /75 gsm/);
  }
  const pieces = layoutPattern(p).pieces;
  assert.ok(pieces.find(item => item.piece.part === 'front' && !item.piece.auxiliary)!.artwork.length > 0);
  assert.deepEqual(pieces.find(item => patternKey(item.piece) === 'frontInterfacing')!.artwork, []);
});

test('shortening a coat sleeve removes its dependent support and leaves a valid shirt', () => {
  const p = withSleeveLength(fused(template('blazer')), 20);
  assert.equal(p.options?.interfacing, undefined);
  assert.doesNotThrow(() => validateProduct(p));
});

test('descriptions add and remove front support, preserve lining and refuse unsupported garments', () => {
  const base = template('blazer'), p = readDesignPrompt('lined blazer with front interfacing', base).product;
  assert.equal(p.options?.interfacing, true); assert.equal(p.options?.lining, true);
  const off = readDesignPrompt('no front interfacing', p).product;
  assert.equal(off.options?.interfacing, undefined); assert.equal(off.options?.lining, true);
  assert.equal(readDesignPrompt('fused fronts', base).product.options?.interfacing, true);
  assert.throws(() => readDesignPrompt('front interfacing', template('shirt')), /interfacing.*coat/i);
  const colour = readDesignPrompt('red front interfacing', base);
  assert.equal(colour.product.parts.front.color, base.parts.front.color);
  assert.ok(colour.ignored.some(word => /red/.test(word)), 'a hidden support colour must be reported as unsupported');
});

test('all negative support aliases remove it while garment colours keep their own scope', () => {
  const base = fused(template('blazer'));
  for (const said of ['no fused fronts', 'without fused fronts', 'no fusible front interfacing', 'without fusible front interfacing', 'no front fusible interfacing', 'unfused fronts']) {
    assert.equal(readDesignPrompt(said, base).product.options?.interfacing, undefined, said);
    assert.equal(readDesignPrompt(`navy with ${said}`, template('blazer')).product.options?.interfacing, undefined, `initially unfused: ${said}`);
  }
  const red = readDesignPrompt('red blazer without front interfacing', base);
  assert.equal(red.product.options?.interfacing, undefined);
  assert.equal(red.product.parts.front.color, readDesignPrompt('red blazer', base).product.parts.front.color);
  assert.equal(red.ignored.length, 0);
});

test('quoted artwork for internal support is refused rather than redirected onto the shell', () => {
  const base = template('blazer');
  for (const said of ['blazer with "LOGO" on the front interfacing', 'blazer with "LOGO" on the interfacing', 'blazer on the fusible front interfacing "LOGO"']) {
    const read = readDesignPrompt(said, base);
    assert.equal(read.text, undefined, said);
    assert.equal(read.product.options?.interfacing, undefined, 'an artwork destination must not add a module');
    assert.ok(read.ignored.some(word => /interfacing.*internal/i.test(word)), said);
  }
  assert.throws(() => readDesignPrompt('"LOGO" on the front interfacing', base), /interfacing.*internal/i);
  const allowed = readDesignPrompt('blazer with interfacing and "LOGO" on the front', base);
  assert.equal(allowed.product.options?.interfacing, true);
  assert.equal(allowed.text?.side, 'front'); assert.equal(allowed.text?.text, 'LOGO');
});

test('part descriptions keep support-only styling away from the selected outer part', () => {
  const style = template('blazer').parts.front;
  for (const said of ['striped front interfacing', 'red fusible interfacing', 'cotton front interfacing', 'vertical stripes on the interfacing']) {
    assert.throws(() => readStylePrompt(said, style), /interfacing.*internal/i, said);
    const reading = readStylePrompt(said, style, { allowUnapplied: true });
    assert.deepEqual(reading.style, style); assert.equal(reading.understood.length, 0);
    assert.ok(reading.ignored.some(word => /interfacing.*internal/i.test(word)));
  }
  const separate = readStylePrompt('navy with striped front interfacing', style);
  assert.equal(separate.style.color, readStylePrompt('navy', style).style.color);
  assert.deepEqual(separate.style.print, style.print);
});

test('a fully bonded identical sheet has double the mass and membrane response, and eight times the bending', () => {
  const p = template('blazer'), mesh = teeMesh(p, Delaunator).find(mesh => mesh.part === 'front')!, cloth = () => material(p.parts.front.material);
  const one = clothFromMeshes([mesh], cloth), two = clothFromMeshes([mesh], cloth, () => 0, cloth);
  assert.ok(Math.abs(mass(two) / mass(one) - 2) < 1e-6);
  assert.deepEqual(one.positions, two.positions); assert.deepEqual(one.rest, two.rest);
  for (let i = 0; i < one.bendStiffness.length; i++) assert.ok(Math.abs(two.bendStiffness[i] / one.bendStiffness[i] - 8) < 1e-5);
  for (let i = 0; i < one.compliance.length; i++) if (one.structural[i]) assert.ok(Math.abs(two.compliance[i] / one.compliance[i] - .5) < 1e-5);
});

test('front support changes actual garment mass and solve, while omission restores the original cloth exactly', () => {
  const p = template('blazer'), q = fused(p), meshes = teeMesh(p, Delaunator), a = buildCloth(p, meshes), b = buildCloth(q, meshes);
  assert.deepEqual(teeMesh(q, Delaunator), meshes, 'support is bonded to the existing front, not a duplicated surface');
  assert.ok(mass(b) > mass(a)); assert.deepEqual(a.positions, b.positions); assert.deepEqual(a.rest, b.rest);
  const front = meshes.find(mesh => mesh.part === 'front')!;
  let area = 0;
  for (let i = 0; i < front.indices.length; i += 3) {
    const [a, b, c] = [front.indices[i], front.indices[i + 1], front.indices[i + 2]].map(v => [front.uvs[v * 2], front.uvs[v * 2 + 1]]);
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  assert.ok(Math.abs((mass(b) - mass(a)) / (area * 75 / 10000) - 1) < 1e-5, 'added mass is exactly the 75 gsm support on the front area');
  assert.deepEqual(buildCloth(withOptions(q, { ...optionsOf(q), interfacing: false }), meshes), a);
  const solve = (product: Product) => simulateGarment(product, meshes, 94, { frames: 60 }).parts.find(part => part.part === 'front')!.positions;
  const plain = solve(p), stiff = solve(q);
  assert.ok(stiff.every(Number.isFinite));
  const rms = Math.sqrt(plain.reduce((sum, v, i) => sum + (v - stiff[i]) ** 2, 0) / plain.length);
  assert.ok(rms > .02, `front drape must respond, RMS ${rms} cm`);
});
