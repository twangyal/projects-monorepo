import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { fitValues, patternPieces, seamHalfAt, teeDimensions, teeMesh, template, topMeasurements, validateProduct, waistPositionFor, waistShapeable, type Product } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack, measurementDiagram } from '../src/techpack.ts';

const tee = template('blank') as Product;
const shaped = (fit: Product['fit'], base: Product = tee) => validateProduct({ ...base, fit });

/** The piece's width at `y` cm below the neck points: the outline's crossings of that level, outermost apart. */
function widthAt(outline: { x: number; y: number }[], y: number): number {
  const xs: number[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length]!;
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) xs.push(a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y));
  });
  return Math.max(...xs) - Math.min(...xs);
}

test('a waist width curves the side seams in through it, smoothly and never past the chest, waist or hem', () => {
  const plain = teeDimensions(tee), armY = plain.shoulderDrop + plain.armDepth;
  // Unshaped, the side seam runs straight from the chest to the hem, and the waist points report that seam.
  assert.equal(plain.shaped, false);
  assert.equal(fitValues(tee).waistWidth, plain.half * 2);
  assert.equal(fitValues(tee).waistPosition, waistPositionFor(topMeasurements(tee).chest));
  const product = shaped({ waistWidth: 46 }), d = teeDimensions(product);
  assert.equal(d.waistY, waistPositionFor(104));
  assert.ok(Math.abs(d.waistY - 0.44 * (104 - 10)) <= 0.25, 'the waist line sits at the default body waist for this chest');
  // The full chest width runs down to the chest line, where the tech pack measures the chest, so it stays 54 cm.
  assert.equal(seamHalfAt(d, armY), d.half);
  assert.equal(seamHalfAt(d, armY + 2.5), d.half);
  assert.equal(buildTechPack(product, '2026-11-17').poms.find(pom => pom.code === 'A')!.values.M, 54);
  assert.equal(seamHalfAt(d, d.waistY), 23);
  assert.equal(seamHalfAt(d, d.length), d.hemHalf);
  let previous = Infinity;
  for (let y = armY; y <= d.length; y += 0.25) {
    const half = seamHalfAt(d, y);
    assert.ok(half >= 23 - 1e-9 && half <= d.half + 1e-9, `${half} at ${y}`);
    // Narrowing to the waist, then widening to the hem, with no kink: the waist is level.
    if (y <= d.waistY) assert.ok(half <= previous + 1e-9);
    previous = half;
  }
  for (const step of [0.02, -0.02]) assert.ok(Math.abs(seamHalfAt(d, d.waistY + step) - 23) < 0.001, 'level at the waist');
  // A waist between a wide chest and a narrower hem tapers without a bump.
  const tapered = teeDimensions(shaped({ waistWidth: 50, hemWidth: 46 }));
  for (let y = armY; y < tapered.length; y += 0.5) assert.ok(seamHalfAt(tapered, y + 0.5) <= seamHalfAt(tapered, y) + 1e-9);
});

test('the front and back pattern pieces are narrowest at the waist, and the 3D garment is sewn to the same shape', () => {
  const product = shaped({ waistWidth: 46, waistPosition: 44 }), d = teeDimensions(product), pieces = patternPieces(product);
  for (const part of ['front', 'back'] as const) {
    const outline = pieces.find(piece => piece.part === part)!.outline;
    assert.ok(Math.abs(widthAt(outline, 44) - 46) < 0.1, `${part} waist ${widthAt(outline, 44)}`);
    for (const y of [d.shoulderDrop + d.armDepth + 0.5, 36, 40, 48, 56, 64, d.length - 0.5]) {
      assert.ok(Math.abs(widthAt(outline, y) - 2 * seamHalfAt(d, y)) < 0.1, `${part} at ${y}: ${widthAt(outline, y)}`);
      assert.ok(widthAt(outline, y) > 46 && widthAt(outline, y) <= 54 + 1e-9, `${part} at ${y}`);
    }
  }
  // In 3D (hem at y = 0, neck points at the length), front and back meet along the shaped seams.
  const meshes = teeMesh(product, Delaunator), level = d.length - 44;
  for (const part of ['front', 'back'] as const) {
    const positions = meshes.find(mesh => mesh.part === part)!.positions;
    let low = Infinity, high = -Infinity;
    for (let i = 0; i < positions.length; i += 3) if (Math.abs(positions[i + 1]! - level) < 0.75) { low = Math.min(low, positions[i]!); high = Math.max(high, positions[i]!); }
    assert.ok(Math.abs(high - low - 46) < 0.6, `${part} 3D waist ${high - low}`);
  }
  // An unshaped top is drafted exactly as before.
  assert.deepEqual(patternPieces(validateProduct({ ...tee, fit: { waistPosition: 44 } })), patternPieces(tee));
});

test('waist shaping is refused where it cannot be sewn, with the reason', () => {
  assert.throws(() => shaped({ waistWidth: 60 }), /Waist width \(½\) must be between 37\.8 and 54\.0 cm/);
  assert.throws(() => shaped({ waistWidth: 36 }), /Waist width/);
  assert.throws(() => shaped({ waistWidth: 46, waistPosition: 30 }), /Waist position must be between/);
  assert.throws(() => shaped({ waistWidth: 46, waistPosition: 69 }), /Waist position must be between/);
  assert.throws(() => shaped({ waistWidth: 46 }, template('crew-sweat') as Product), /only to T-shirts, shirts and tee dresses/);
  assert.throws(() => shaped({ waistPosition: 40 }, template('zip-hoodie') as Product), /only to T-shirts/);
  assert.equal(waistShapeable(template('crew-sweat') as Product), false);
  // A crop top's waist line must stay 5 cm above its hem: the shortest one is shaped higher up.
  const crop = validateProduct({ ...template('crop-top') as Product, measurements: { chest: 100, length: 42, sleeve: 19 } });
  assert.equal(waistShapeable(crop), true);
  assert.throws(() => shaped({ waistWidth: 44 }, crop), /Waist position must be between 34\.0 and 37\.0 cm/);
  assert.doesNotThrow(() => shaped({ waistWidth: 44, waistPosition: 37 }, crop));
});

test('the tech pack measures the waist and grades it, and the diagram marks it', () => {
  const product = shaped({ waistWidth: 46, waistPosition: 42 }), pack = buildTechPack(product, '2026-11-17');
  const waist = pack.poms.find(pom => pom.code === 'X')!, line = pack.poms.find(pom => pom.code === 'Y')!;
  assert.equal(waist.name, 'Waist width (½)');
  assert.deepEqual(Object.values(waist.values), [41, 43.5, 46, 48.5, 51]);
  assert.deepEqual(Object.values(line.values), [41, 41.5, 42, 42.5, 43]);
  assert.match(pack.construction.find(row => row.area === 'Side seams')!.detail, /following the curve in to 46\.0 cm \(½\) at the waist line, 42\.0 cm below the high point shoulder/);
  const diagram = measurementDiagram(product);
  assert.match(diagram, />X</);
  assert.match(diagram, />Y</);
  // An unshaped top has neither.
  const plain = buildTechPack(tee, '2026-11-17');
  assert.equal(plain.poms.some(pom => pom.code === 'X' || pom.code === 'Y'), false);
  assert.doesNotMatch(measurementDiagram(tee), />X</);
});

test('each size grades a shaped waist by its own steps, the waist line too when it was left where it started', () => {
  const product = shaped({ waistWidth: 46 }), sample = teeDimensions(product);
  const large = teeDimensions(gradedProduct(product, 'L')), small = teeDimensions(gradedProduct(product, 'XS'));
  assert.equal(large.waistHalf * 2, 48.5);
  assert.equal(small.waistHalf * 2, 41);
  assert.equal(large.waistY, sample.waistY + 0.5);
  assert.equal(small.waistY, sample.waistY - 1);
  // An unshaped top's waist points stay out of its graded fit.
  assert.equal(gradedProduct(tee, 'XL').fit?.waistWidth, undefined);
});

test('descriptions shape a waist, name its measurements and take it away again', () => {
  const fitted = readDesignPrompt('a white tee with a fitted waist', tee);
  assert.equal(fitted.product.fit?.waistWidth, 46);
  assert.ok(fitted.scopes[0]!.understood.includes('fitted waist: 46 cm waist width (½)'));
  // A slim tee shaped at the waist: the chest is set first, the waist from it.
  assert.equal(readDesignPrompt('slim tee with a nipped-in waist', tee).product.fit?.waistWidth, 43);
  const measured = readDesignPrompt('tee, waist width 44 cm, waist position 40 cm', tee).product.fit;
  assert.deepEqual([measured?.waistWidth, measured?.waistPosition], [44, 40]);
  const straight = readDesignPrompt('straight side seams', fitted.product);
  assert.equal(straight.product.fit, undefined);
  const hoodie = readDesignPrompt('grey hoodie with a fitted waist', template('hoodie') as Product);
  assert.equal(hoodie.product.fit?.waistWidth, undefined);
  assert.ok(hoodie.ignored.some(item => /fitted waist \(only T-shirts, shirts and tee dresses/.test(item)), hoodie.ignored.join('; '));
});

test('a shaped T-shirt dress drapes closer to the body at the waist than a straight one, without overstretching', () => {
  const dress = template('tee-dress') as Product, body = defaultBodyChest(dress);
  const run = (product: Product) => simulateGarment(product, teeMesh(product, Delaunator), body, { frames: 90 });
  const girthAt = (result: ReturnType<typeof run>, y: number) => {
    let low = Infinity, high = -Infinity;
    for (const part of result.parts.filter(item => item.part === 'front' || item.part === 'back')) {
      for (let i = 0; i < part.positions.length; i += 3) if (Math.abs(part.positions[i + 1]! - y) < 1) { low = Math.min(low, part.positions[i]!); high = Math.max(high, part.positions[i]!); }
    }
    return high - low;
  };
  const d = teeDimensions(dress), waistWidth = Math.round((d.half * 2 - 10) * 2) / 2;
  const straight = run(dress), fitted = run(shaped({ ...dress.fit, waistWidth }, dress)), level = d.length - d.waistY;
  assert.ok(girthAt(fitted, level) < girthAt(straight, level) - 4, `waist ${girthAt(fitted, level)} against ${girthAt(straight, level)}`);
  assert.ok(fitted.metrics.maxStrain < 0.5, `stretch ${fitted.metrics.maxStrain}`);
  assert.ok(fitted.metrics.minClearance >= 0.3, `clearance ${fitted.metrics.minClearance}`);
});
