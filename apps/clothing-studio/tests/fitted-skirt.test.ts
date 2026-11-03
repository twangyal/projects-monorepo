import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCloth, defaultBodyChest, simulateGarment } from '../src/garment-drape.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { patternDxf, patternSvg } from '../src/pattern-export.ts';
import { garmentName, patternPieces, template, validateProduct, type Product } from '../src/product.ts';
import { FITTED_HIP_DEPTH, skirtFit, skirtMesh, validateSkirtMeasures, type SkirtMeasures } from '../src/product-skirt.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';

const fitted = (measurements: Partial<SkirtMeasures> = {}): Product => {
  const product = template('pencil-skirt');
  product.measurements = { ...product.measurements as SkirtMeasures, ...measurements };
  return validateProduct(product);
};

test('a fitted skirt is validated against its waist, hem and length, and is not gathered or pleated', () => {
  const base = { waist: 70, hem: 90, slant: 60, hip: 96 };
  assert.equal(validateSkirtMeasures(base).hip, 96);
  assert.throws(() => validateSkirtMeasures({ ...base, hip: 74 }), /at least 6 cm more than its 70 cm waist/);
  assert.throws(() => validateSkirtMeasures({ ...base, hem: 78 }), /hem must be at least 80 cm \(16 cm less than the hip\)/);
  assert.throws(() => validateSkirtMeasures({ ...base, slant: 25 }), /at least 30 cm below the waist/);
  assert.throws(() => validateSkirtMeasures({ ...base, hip: 250 }), /hip must be from 70 to 200/);
  assert.throws(() => validateSkirtMeasures({ ...base, hem: 110, gather: 1.3 }), /shaped by darts, not gathered or pleated/);
});

test('half the waist-to-hip difference is in the side seams and half in darts, which close to the waist', () => {
  const pencil = skirtFit(fitted())!, gentle = skirtFit(fitted({ hip: 88 }))!;
  // (96 - 70) / 4 = 6.5 cm of darts per panel: four darts, as two would each be wider than 3 cm.
  assert.equal(pencil.darts.length, 4);
  assert.ok(Math.abs(pencil.darts.reduce((sum, d) => sum + d.width, 0) - 6.5) < 1e-9);
  assert.equal(gentle.darts.length, 2);
  // The panel (half the skirt) is half the waist with its darts closed, half the hip at the hip line, half the hem.
  const perSide = pencil.darts.reduce((sum, d) => sum + d.width, 0) / 2;
  assert.ok(Math.abs(pencil.halfWidth(0) - perSide - 70 / 4) < 1e-9);
  assert.ok(Math.abs(pencil.halfWidth(FITTED_HIP_DEPTH) - 96 / 4) < 1e-9);
  assert.ok(Math.abs(pencil.halfWidth(60) - 90 / 4) < 1e-9);
  assert.deepEqual(pencil.darts.map(d => Math.sign(d.at)), [-1, -1, 1, 1]);
  assert.equal(skirtFit(template('flared-skirt')), null);
});

test('the pattern marks each dart, and in 3D each dart is sewn closed so the waist is the waist', () => {
  const product = fitted(), pieces = patternPieces(product), front = pieces.find(p => p.part === 'front')!;
  assert.deepEqual(pieces.map(p => p.part), ['front', 'back', 'waistband']);
  assert.equal(front.darts!.length, 4);
  // Each dart's legs start on the waist edge, its point lies below between them.
  for (const [left, point, right] of front.darts!) {
    assert.equal(left.y, 0); assert.equal(right.y, 0);
    assert.ok(point.y > 0 && point.x > left.x && point.x < right.x);
  }
  // The outline is symmetric about the panel's centre.
  const xs = front.outline.map(p => p.x), centre = (Math.min(...xs) + Math.max(...xs)) / 2;
  for (const p of front.outline) assert.ok(front.outline.some(q => Math.abs(q.x - (2 * centre - p.x)) < 1e-6 && Math.abs(q.y - p.y) < 1e-6));
  assert.equal((patternSvg(product).match(/data-dart="front"/g) ?? []).length, 4);
  assert.match(patternSvg(product), /V from the waist: a dart/);
  assert.equal((patternDxf(product).match(/\nDART\n/g) ?? []).length, 2 * 2 * 4);
  // The cloth's waist: the flat lengths round the panels' top row add up to the waist once the darts are closed.
  const meshes = skirtMesh(product), cloth = buildCloth(product, meshes);
  const panels = meshes.filter(m => m.part !== 'waistband'), top = Math.max(...panels[0]!.positions.filter((_, i) => i % 3 === 1));
  const waistRow = new Set<number>();
  for (const mesh of panels) cloth.vertices.get(mesh.part)!.forEach((id, v) => { if (mesh.positions[v * 3 + 1]! > top - 1e-6) waistRow.add(id); });
  let around = 0;
  for (let n = 0; n < cloth.rest.length; n++) if (cloth.structural[n] && waistRow.has(cloth.a[n]!) && waistRow.has(cloth.b[n]!)) around += cloth.rest[n]!;
  // (The band's lower edge shares those edges, so each is counted once.)
  assert.ok(Math.abs(around - 70) < 0.5, `waist ${around}`);
  const vertices = meshes.reduce((sum, m) => sum + m.positions.length / 3, 0);
  assert.ok(cloth.positions.length / 3 < vertices, 'dart legs and seams are sewn into shared particles');
});

test('a pencil skirt drapes close over the hips without strain', () => {
  const product = fitted(), result = simulateGarment(product, skirtMesh(product), defaultBodyChest(product), { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.2, `strain ${result.metrics.maxStrain}`);
  assert.ok(result.metrics.contact > 0.5, `contact ${result.metrics.contact}`);
  assert.ok(result.metrics.minClearance >= 0.34, `clearance ${result.metrics.minClearance}`);
  // Round the hip line the skirt keeps about its 96 cm.
  const points = result.parts.filter(p => p.part !== 'waistband').flatMap(p => [...p.positions]);
  let top = -Infinity;
  for (let i = 1; i < points.length; i += 3) top = Math.max(top, points[i]!);
  const ring = [] as [number, number][];
  for (let i = 0; i < points.length; i += 3) if (Math.abs(points[i + 1]! - (top - FITTED_HIP_DEPTH)) < 1) ring.push([points[i]!, points[i + 2]!]);
  ring.sort((a, b) => Math.atan2(a[0], a[1]) - Math.atan2(b[0], b[1]));
  const perimeter = ring.reduce((sum, p, i) => sum + Math.hypot(p[0] - ring[(i + 1) % ring.length]![0], p[1] - ring[(i + 1) % ring.length]![1]), 0);
  assert.ok(perimeter > 90 && perimeter < 104, `hip ${perimeter}`);
});

test('fitted skirts are named, documented, graded and read from descriptions', () => {
  assert.equal(garmentName(fitted()), 'Pencil skirt');
  assert.equal(garmentName(fitted({ hem: 96 })), 'Straight skirt');
  const pack = buildTechPack(fitted(), '2026-11-03');
  assert.ok(pack.construction.some(step => step.area === 'Darts' && /4 darts per panel, each 1.6 cm wide at the waist and 11 cm long/.test(step.detail)));
  assert.equal(pack.poms.find(pom => pom.code === 'E')?.name, 'Hip circumference');
  assert.equal((gradedProduct(fitted(), 'L').measurements as SkirtMeasures).hip, 100);
  const read = (said: string, product = template('flared-skirt')) => readDesignPrompt(said, product).product.measurements as SkirtMeasures;
  assert.deepEqual([read('black pencil skirt').hip, read('black pencil skirt').hem], [109, 103]);
  assert.equal(read('straight skirt').hem, read('straight skirt').hip);
  assert.equal(read('a-line skirt', template('pencil-skirt')).hip, undefined);
});
