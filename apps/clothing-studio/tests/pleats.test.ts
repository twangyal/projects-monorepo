import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloth, defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { patternDxf, patternSvg } from '../src/pattern-export.ts';
import { garmentName, patternPieces, template, validateProduct, type Product } from '../src/product.ts';
import { pleatLines, skirtCutGeometry, skirtIntake, skirtMesh, skirtPleats, validateSkirtMeasures, type Pleats, type SkirtMeasures } from '../src/product-skirt.ts';
import { patternGeometry } from '../src/construction.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';

const skirt = (pleats?: Pleats, band = 4): Product => {
  const product = template('pleated-skirt'), m = product.measurements as SkirtMeasures;
  if (pleats) m.pleats = pleats; else delete m.pleats;
  if (!band) { delete m.waistbandHeight; delete (product.parts as Partial<Product['parts']>).waistband; }
  return validateProduct(product);
};

test('pleats are validated: an even number, a depth the spacing allows, never with gathers', () => {
  const base = { waist: 72, hem: 120, slant: 60 };
  assert.deepEqual(validateSkirtMeasures({ ...base, pleats: { style: 'box', count: 12, depth: 3 } }).pleats, { style: 'box', count: 12, depth: 3 });
  assert.throws(() => validateSkirtMeasures({ ...base, pleats: { style: 'knife', count: 23, depth: 1 } }), /even number of pleats from 8 to 40/);
  assert.throws(() => validateSkirtMeasures({ ...base, pleats: { style: 'knife', count: 24, depth: 3.5 } }), /3 cm apart, so each can fold at most 3 cm deep/);
  assert.throws(() => validateSkirtMeasures({ ...base, pleats: { style: 'box', count: 24, depth: 2 } }), /at most 1.5 cm deep/);
  assert.throws(() => validateSkirtMeasures({ ...base, gather: 1.3, pleats: { style: 'knife', count: 24, depth: 1 } }), /either gathered or pleated/);
  assert.throws(() => validateSkirtMeasures({ ...base, pleats: { style: 'sunray', count: 24, depth: 1 } }), /knife or box/);
  assert.throws(() => validateSkirtMeasures({ ...base, pleats: { style: 'knife', count: 24 } }), /style, a count and a depth/);
  // Each panel must still be cut from no more than a half circle of fabric.
  assert.throws(() => validateSkirtMeasures({ waist: 72, hem: 290, slant: 60, pleats: { style: 'knife', count: 24, depth: 3 } }), /more than a half circle/);
});

test('pleated panels are cut wider by the underlays, with each fold line and its placement line marked', () => {
  const plain = skirt(), knife = skirt({ style: 'knife', count: 24, depth: 1.5 }), box = skirt({ style: 'box', count: 12, depth: 1.5 });
  // A knife pleat folds two layers of its depth under, a box four: both here take as much fabric again.
  assert.equal(skirtIntake(knife), 1);
  assert.equal(skirtIntake(box), 1);
  const visible = patternGeometry({ kind: 'flared-skirt', waist: 72, hem: 120, slant: 60 });
  assert.ok(Math.abs(skirtCutGeometry(knife).angle - 2 * visible.angle) < 1e-12);
  assert.equal(skirtCutGeometry(knife).innerRadius, visible.innerRadius);
  const front = (product: Product) => patternPieces(product).find(piece => piece.part === 'front')!;
  assert.ok(Math.abs(front(knife).areaCm2 / front(plain).areaCm2 - 2) < 0.01);
  assert.equal(front(plain).pleats, undefined);
  // Knife pleats: one fold and placement line per pleat on each panel; boxes: two folds, each to its own side.
  assert.equal(front(knife).pleats!.length, 12);
  assert.equal(front(box).pleats!.length, 12);
  // Lines run straight across the panel, from waist to hem, through the sector's centre.
  const g = skirtCutGeometry(knife);
  for (const line of [...front(knife).pleats!.map(p => p.fold), ...front(knife).pleats!.map(p => p.placement)]) {
    const [waist, hem] = line.map(p => Math.hypot(p.x - g.width / 2, p.y + g.top));
    assert.ok(Math.abs(waist! - g.innerRadius) < 1e-9 && Math.abs(hem! - g.outerRadius) < 1e-9);
  }
  // A knife pleat's fold is one visible width after the previous placement line; the last placement is the side edge.
  const lines = pleatLines(knife), unit = g.angle / 2 / 12;
  assert.ok(Math.abs(lines[0]!.fold - (-g.angle / 2 + unit)) < 1e-12);
  assert.ok(Math.abs(lines.at(-1)!.placement - g.angle / 2) < 1e-12);
  // Box pleats fold away from each other, to the inverted pleats either side of each box.
  const boxes = pleatLines(box);
  assert.ok(boxes[0]!.placement < boxes[0]!.fold && boxes[1]!.placement > boxes[1]!.fold);
  // Exports draw the lines.
  assert.equal((patternSvg(knife).match(/data-pleat-fold="front"/g) ?? []).length, 12);
  assert.equal((patternSvg(knife).match(/data-pleat-placement="back"/g) ?? []).length, 12);
  assert.match(patternSvg(knife), /Blue solid: pleat fold line/);
  assert.equal((patternDxf(box).match(/\nPLEAT-FOLD\n/g) ?? []).length, 24);
  assert.doesNotMatch(patternSvg(plain), /pleat/);
});

test('in 3D the pleats start folded, every layer sewn into the waistband', () => {
  for (const product of [skirt({ style: 'knife', count: 24, depth: 1.5 }), skirt({ style: 'box', count: 12, depth: 3 }), skirt({ style: 'knife', count: 8, depth: 9 / 2 }, 0)]) {
    const meshes = skirtMesh(product), key = (p: ArrayLike<number>, i: number) => `${Math.round(p[i]! * 1000)},${Math.round(p[i + 1]! * 1000)},${Math.round(p[i + 2]! * 1000)}`;
    const band = meshes.find(mesh => mesh.part === 'waistband'), panels = meshes.filter(mesh => mesh.part !== 'waistband');
    const top = Math.max(...panels[0]!.positions.filter((_, i) => i % 3 === 1));
    const bandPoints = new Set(band ? Array.from({ length: band.positions.length / 3 }, (_, v) => key(band.positions, v * 3)) : []);
    for (const mesh of panels) {
      assert.ok(mesh.creases!.length > 0 && mesh.layers!.some(level => level > 0) && mesh.inside!.length > 0);
      for (let v = 0; v < mesh.positions.length / 3; v++) {
        if (mesh.positions[v * 3 + 1]! < top - 1e-6) continue;
        // At the waist every layer lies on the finished waist, at a point the band shares.
        assert.ok(Math.abs(Math.hypot(mesh.positions[v * 3]!, mesh.positions[v * 3 + 2]!) - 72 / (2 * Math.PI)) < 1e-6);
        assert.equal(mesh.layers![v], 0);
        if (band) assert.ok(bandPoints.has(key(mesh.positions, v * 3)), `waist point ${v} of the ${mesh.part} is not sewn to the band`);
      }
    }
    // The cloth sews the fold copies and the layers at the waist together, and keeps every underlay inside.
    const cloth = buildCloth(product, meshes);
    assert.ok(cloth.layered.inner.length > 0);
    for (let n = 0; n < cloth.layered.inner.length; n++) {
      const ki = cloth.layered.inner[n]! * 3, ko = cloth.layered.outer[n]! * 3;
      assert.ok(Math.hypot(cloth.positions[ki]!, cloth.positions[ki + 2]!) < Math.hypot(cloth.positions[ko]!, cloth.positions[ko + 2]!));
    }
  }
});

test('pressed pleats drape with their underlays inside and their folds kept', () => {
  const product = skirt({ style: 'knife', count: 24, depth: 1.5 }), meshes = skirtMesh(product), cloth = buildCloth(product, meshes);
  const result = simulateGarment(product, meshes, defaultBodyChest(product), { frames: 120 });
  const position = new Map<number, number[]>();
  for (const part of result.parts) cloth.vertices.get(part.part)?.forEach((id, v) => position.set(id, [part.positions[v * 3]!, part.positions[v * 3 + 1]!, part.positions[v * 3 + 2]!]));
  const radius = (id: number) => { const p = position.get(id)!; return Math.hypot(p[0]!, p[2]!); };
  for (let n = 0; n < cloth.layered.inner.length; n++) {
    assert.ok(radius(cloth.layered.inner[n]!) <= radius(cloth.layered.outer[n]!) - cloth.layered.gap[n]! + 0.02, `underlay ${n} came outside the fabric over it`);
  }
  // Folds stay folded: across each pressed fold the two sides stay close (their rest distance is under 1 cm).
  let widest = 0;
  for (let n = 0; n < cloth.rest.length; n++) {
    if (cloth.structural[n] || cloth.rest[n]! > 1) continue;
    const a = position.get(cloth.a[n]!), b = position.get(cloth.b[n]!);
    if (a && b) widest = Math.max(widest, Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) - cloth.rest[n]!);
  }
  assert.ok(widest < 0.5, `a fold opened ${widest} cm beyond its pressed shape`);
  assert.ok(result.metrics.maxStrain < 0.3, `strain ${result.metrics.maxStrain}`);
  assert.ok(result.metrics.minClearance >= 0.19, `clearance ${result.metrics.minClearance}`);
});

test('pleats name the skirt, add a tech pack step and depth, grade, and are read from descriptions', () => {
  const knife = skirt({ style: 'knife', count: 24, depth: 1.5 }), box = skirt({ style: 'box', count: 12, depth: 3 });
  assert.equal(garmentName(knife), 'Pleated skirt');
  assert.equal(garmentName(box), 'Box-pleated skirt');
  assert.equal(garmentName(skirt()), 'Flared skirt');
  const pack = buildTechPack(knife, '2026-11-03');
  assert.ok(pack.construction.some(step => step.area === 'Pleats' && /24 knife pleats \(12 per panel\), 3 cm apart at the waist and 5 cm at the hem, each folded 1.5 cm deep at the waist and 2.5 cm at the hem/.test(step.detail)));
  assert.ok(pack.construction.some(step => step.area === 'Panels' && /cut 100% wider/.test(step.detail)));
  assert.equal(pack.poms.find(pom => pom.code === 'E')?.values.M, 1.5);
  assert.ok(buildTechPack(box, '2026-11-03').construction.some(step => step.area === 'Pleats' && /12 box pleats \(6 per panel\), each box 6 cm wide/.test(step.detail)));
  // Smaller sizes fold the pleats only as deep as their waist allows; larger ones keep the depth.
  const deep = skirt({ style: 'box', count: 12, depth: 3 });
  assert.ok(skirtPleats(gradedProduct(deep, 'XS'))!.depth < 3);
  assert.equal(skirtPleats(gradedProduct(deep, 'XL'))!.depth, 3);
  // Descriptions: pleated means knife pleats, box pleats are boxes, and gathering replaces pleats.
  const read = (said: string, product = template('flared-skirt')) => readDesignPrompt(said, product);
  assert.deepEqual(skirtPleats(read('pleated grey wool skirt').product), { style: 'knife', count: 26, depth: 1.5 });
  assert.equal(read('pleated grey wool skirt').product.parts.front.material, 'wool-260');
  assert.equal(skirtPleats(read('box pleated skirt').product)?.style, 'box');
  const gathered = read('gathered skirt', template('pleated-skirt')).product;
  assert.equal(skirtPleats(gathered), undefined);
  assert.ok((gathered.measurements as SkirtMeasures).gather! > 1);
  assert.equal(skirtPleats(read('skirt with no pleats', template('pleated-skirt')).product), undefined);
});
