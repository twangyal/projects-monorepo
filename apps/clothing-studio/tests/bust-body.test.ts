import test from 'node:test';
import Delaunator from 'delaunator';
import assert from 'node:assert/strict';
import { bodyProxy, outfitBodies, outfitShape, simulateGarment, validateTopBodyShape, type BodyProxy } from '../src/garment-drape.ts';
import { mannequinDistance } from '../src/body-mesh.ts';
import { template, teeMesh } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';
import { validateProfileBody } from '../src/top-body-profiles.ts';
import { comparisonReceipt, fabricVariants } from '../src/garment-comparison.ts';

const spheres = (body: BodyProxy) => body.capsules.filter(c => !c.limb && c.a[1] === body.landmarks?.bust);
/** A tape round the body at the bust points' height: the convex hull of the torso section and the spheres there. */
function girthAtBust(body: BodyProxy): number {
  const y = body.landmarks!.bust!, section = body.torso.find(s => s.y === y)!, points: [number, number][] = [];
  const flat = section.halfWidth - section.halfDepth;
  for (let i = 0; i < 2000; i++) { const t = i / 2000 * 2 * Math.PI, c = Math.cos(t); points.push([Math.sign(c) * flat + section.halfDepth * c, section.halfDepth * Math.sin(t)]); }
  for (const s of spheres(body)) for (let i = 0; i < 1000; i++) { const t = i / 1000 * 2 * Math.PI; points.push([s.a[0] + s.radius * Math.cos(t), s.a[2] + s.radius * Math.sin(t)]); }
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: number[], p: number[], q: number[]) => (p[0]! - o[0]!) * (q[1]! - o[1]!) - (p[1]! - o[1]!) * (q[0]! - o[0]!);
  const chain = (list: [number, number][]) => { const kept: [number, number][] = []; for (const p of list) { while (kept.length >= 2 && cross(kept.at(-2)!, kept.at(-1)!, p) <= 0) kept.pop(); kept.push(p); } return kept.slice(0, -1); };
  const hull = [...chain(points), ...chain([...points].reverse())];
  return hull.reduce((sum, p, i) => sum + Math.hypot(hull[(i + 1) % hull.length]![0] - p[0], hull[(i + 1) % hull.length]![1] - p[1]), 0);
}

test('a body with a bust measures the chest round the bust and the underbust under it', () => {
  for (const id of ['blank', 'tank-top', 'hoodie', 'tee-dress']) for (const [chest, underbust] of [[84, 72], [92, 76], [104, 82], [120, 90], [140, 100]] as const) {
    const body = bodyProxy(template(id), chest, { underbust }), pair = spheres(body), y = body.landmarks!.bust!;
    assert.equal(pair.length, 2, `${id} ${chest}/${underbust}`);
    assert.ok(Math.abs(girthAtBust(body) - chest) < 0.3, `${id} ${chest}/${underbust}: ${girthAtBust(body)}`);
    // The ribcage under the bust is the underbust's girth, between the armpit and the waist.
    const ribs = body.torso.find(s => s.y === y)!;
    assert.ok(Math.abs(4 * (ribs.halfWidth - ribs.halfDepth) + 2 * Math.PI * ribs.halfDepth - underbust) < 1e-9);
    assert.ok(y < body.torso[1]!.y && y > body.landmarks!.waist!);
    // Mirrored bust points in front of the ribcage, which move with the body as it grows.
    assert.deepEqual(pair[0]!.a, [-pair[1]!.a[0], pair[1]!.a[1], pair[1]!.a[2]]);
    assert.ok(pair[0]!.a[2] + pair[0]!.radius > ribs.halfDepth + 1);
    assert.equal(body.underbust, underbust);
  }
  // The frame under a bust is narrower than a body of the same chest without one.
  const flat = bodyProxy(template('blank'), 104), bust = bodyProxy(template('blank'), 104, { underbust: 82 });
  assert.ok(bust.torso[0]!.halfWidth < flat.torso[0]!.halfWidth);
  // The mannequin is drawn round the bust: in front of the ribcage at the bust point it is inside the body.
  const [point] = spheres(bust);
  assert.ok(mannequinDistance(bust)(point!.a[0], point!.a[1], point!.a[2] + point!.radius * 0.8) < 0);
});

test('without an underbust the body is unchanged, and underbusts are checked against the chest', () => {
  for (const id of ['blank', 'zip-hoodie']) assert.deepEqual(bodyProxy(template(id), 94, { underbust: undefined }), bodyProxy(template(id), 94));
  assert.equal(Object.hasOwn(bodyProxy(template('blank'), 94), 'underbust'), false);
  assert.equal(validateTopBodyShape(92, { underbust: 76 }).underbust, 76);
  assert.equal(validateTopBodyShape(92, { underbust: 76 }).waist, 76 * 0.95);
  assert.equal(validateTopBodyShape(92, { underbust: 76, waist: 80 }).waist, 80);
  assert.throws(() => validateTopBodyShape(92, { underbust: 91 }), /at least 2 cm smaller than the chest/);
  assert.throws(() => validateTopBodyShape(120, { underbust: 75 }), /at most 40 cm larger/);
  assert.throws(() => validateTopBodyShape(92, { underbust: 76, chestDepth: 22 }), /Leave chest depth blank/);
  for (const value of [49.9, 138.1, NaN, null, '76']) assert.throws(() => validateTopBodyShape(140, { underbust: value as number }), /Underbust must be from 50 to 138/);
});

test('profiles, projects, outfits and fabric comparisons keep the bust', () => {
  const old = { chest: 92, waist: null, hip: null, chestDepth: null }, body = { ...old, underbust: 76 };
  assert.deepEqual(validateProfileBody(old), old);
  assert.deepEqual(validateProfileBody(body), body);
  assert.deepEqual(validateProfileBody({ ...body, underbust: null }), { ...body, underbust: null });
  assert.throws(() => validateProfileBody({ ...body, underbust: 91 }), /at least 2 cm smaller/);
  assert.deepEqual(validateProject({ ...createProject(), topBody: body }).topBody, body);
  // An outfit's body has the bust, and its automatic waist follows the ribcage.
  const outfit = outfitBodies(template('blank'), template('trousers'), 92, { underbust: 76 });
  assert.equal(spheres(outfit.body).length, 2);
  assert.ok(outfitShape(template('trousers'), 92, { underbust: 76 }).waist <= 76 * 0.95);
  const product = template('blank'), shape = { chest: 92, ...validateTopBodyShape(92, { underbust: 76 }) }, materials: [string, string] = ['jersey-180', 'denim-340'];
  const results = fabricVariants(product, materials).map(p => simulateGarment(p, teeMesh(p, Delaunator), 92, { bodyShape: shape, frames: 46, substeps: 1 })) as [ReturnType<typeof simulateGarment>, ReturnType<typeof simulateGarment>];
  assert.equal(comparisonReceipt(product, shape, materials, results).body.underbust, 76);
  assert.throws(() => comparisonReceipt(product, { ...shape, underbust: 78 }, materials, results), /match the captured body/);
});

test('a tee drapes over the bust and hangs from it without passing into the body', () => {
  const product = template('blank'), mesh = teeMesh(product, Delaunator);
  const forward = (result: ReturnType<typeof simulateGarment>) => { const f = result.parts.find(p => p.part === 'front')!.positions; let z = -Infinity; for (let i = 2; i < f.length; i += 3) z = Math.max(z, f[i]!); return z; };
  const bust = simulateGarment(product, mesh, 92, { bodyShape: { underbust: 76 }, frames: 120 }), flat = simulateGarment(product, mesh, 92, { frames: 120 });
  assert.ok(bust.metrics.minClearance > 0.3, String(bust.metrics.minClearance));
  assert.ok(forward(bust) > forward(flat) + 3, `${forward(bust)} against ${forward(flat)}`);
  assert.ok(bust.metrics.maxStrain < 0.3, String(bust.metrics.maxStrain));
});
