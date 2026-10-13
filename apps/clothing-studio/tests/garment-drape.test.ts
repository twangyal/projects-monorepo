import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { bodyProxy, buildCloth, defaultBodyChest, simulateGarment, validateBodyChest } from '../src/garment-drape.ts';
import { teeDimensions, teeMesh, template, topMeasurements, type Product } from '../src/product.ts';

const ringer = () => template('ringer');
const extent = (positions: Float32Array, axis: number) => {
  let low = Infinity, high = -Infinity;
  for (let i = axis; i < positions.length; i += 3) { low = Math.min(low, positions[i]!); high = Math.max(high, positions[i]!); }
  return [low, high] as const;
};

test('the parts are sewn into one cloth whose rest lengths are flat fabric lengths', () => {
  const product = ringer(), meshes = teeMesh(product, Delaunator), cloth = buildCloth(product, meshes);
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  // Front and back share their seam vertices, sleeves share the armholes and the rib shares the neckline.
  assert.ok(cloth.inverseMass.length < vertices - 150, `${cloth.inverseMass.length} particles from ${vertices} vertices`);
  const front = cloth.vertices.get('front')!, back = cloth.vertices.get('back')!, shared = [...front].filter(id => new Set(back).has(id));
  assert.ok(shared.length > 60, 'the side and shoulder seams join');
  // Body panel edges rest at their flat length: the distance in the silhouette plane, ignoring the shell's depth.
  let checked = 0;
  for (let n = 0; n < cloth.rest.length; n++) {
    if (!cloth.structural[n] || !front.includes(cloth.a[n]!) || !front.includes(cloth.b[n]!)) continue;
    const a = cloth.a[n]! * 3, b = cloth.b[n]! * 3, P = cloth.positions;
    assert.ok(Math.abs(Math.hypot(P[a]! - P[b]!, P[a + 1]! - P[b + 1]!) - cloth.rest[n]!) < 1e-4);
    checked++;
  }
  assert.ok(checked > 1000);
  assert.ok(cloth.inverseMass.every(w => w > 0 && Number.isFinite(w)));
});

test('a tee settles on the body: hanging from the shoulders, outside the body, still and barely stretched', () => {
  const product = ringer(), result = simulateGarment(product, teeMesh(product, Delaunator), 94);
  const { metrics } = result, front = result.parts.find(part => part.part === 'front')!.positions;
  assert.equal(metrics.ease, 10);
  assert.ok(metrics.minClearance >= 0.34, `clearance ${metrics.minClearance}`);
  assert.ok(metrics.residualSpeed < 10, `still moving at ${metrics.residualSpeed} cm/s`);
  assert.ok(metrics.maxStrain < 1, `stretch ${metrics.maxStrain}`);
  assert.ok(metrics.contact > 0.3 && metrics.contact < 0.8, `contact ${metrics.contact}`);
  // The hem hangs where it was cut (it neither falls nor rides up) and the shoulders stay on the shoulders.
  const [low, high] = extent(front, 1), length = topMeasurements(product).length;
  assert.ok(low > -3 && low < 2, `hem at ${low}`);
  assert.ok(high > length - 4 && high < length + 1, `top at ${high}`);
  // The pocketless tee has no carried parts; every part comes back with its own vertex count.
  for (const mesh of teeMesh(product, Delaunator)) assert.equal(result.parts.find(part => part.part === mesh.part)!.positions.length, mesh.positions.length);
});

test('a smaller body leaves more ease and touches less of the garment; results are deterministic', () => {
  const product = ringer(), meshes = teeMesh(product, Delaunator);
  const close = simulateGarment(product, meshes, 100, { frames: 120 }), loose = simulateGarment(product, meshes, 80, { frames: 120 });
  assert.equal(close.metrics.ease, 4);
  assert.equal(loose.metrics.ease, 24);
  assert.ok(close.metrics.contact > loose.metrics.contact + 0.05, `${close.metrics.contact} vs ${loose.metrics.contact}`);
  const again = simulateGarment(product, meshes, 80, { frames: 120 });
  assert.deepEqual(again.parts.map(part => [...part.positions]), loose.parts.map(part => [...part.positions]));
});

test('pockets ride on the front and the hood lies over the back of a hoodie', () => {
  const hoodie: Product = template('hoodie'), result = simulateGarment(hoodie, teeMesh(hoodie, Delaunator), defaultBodyChest(hoodie), { frames: 150 });
  const part = (id: string) => result.parts.find(item => item.part === id)!.positions;
  const pocket = part('pocket'), front = part('front');
  // The kangaroo pocket stays in front of the front body, close to it.
  assert.ok(extent(pocket, 2)[0] > extent(front, 2)[0]);
  let farthest = 0;
  for (let i = 0; i < pocket.length; i += 3) {
    let nearest = Infinity;
    for (let j = 0; j < front.length; j += 3) nearest = Math.min(nearest, Math.hypot(pocket[i]! - front[j]!, pocket[i + 1]! - front[j + 1]!, pocket[i + 2]! - front[j + 2]!));
    farthest = Math.max(farthest, nearest);
  }
  assert.ok(farthest < 2.5, `pocket ${farthest} cm from the front`);
  assert.ok(result.metrics.minClearance >= 0.34);
  // The hood falls back onto the garment instead of standing above the head.
  assert.ok(extent(part('hood'), 1)[1] < topMeasurements(hoodie).length + 6);
});

test('the body fits the garment: arms inside the sleeves, shoulders under the shoulder line; inputs are checked', () => {
  for (const id of ['ringer', 'crew-sweat']) {
    const product = template(id), body = bodyProxy(product, defaultBodyChest(product)), d = teeDimensions(product);
    const arms = body.capsules.filter(capsule => capsule.limb && capsule.a[0] !== 0);
    assert.equal(arms.length, 4);
    // An arm is never wider than the sleeve's flat circumference (front plus back) allows.
    for (const arm of arms) assert.ok(2 * Math.PI * Math.max(arm.radius, arm.end) < 2 * Math.max(d.cuffHalf, d.capWidth / 2) + 1e-9);
    assert.ok(body.torso[0]!.y + body.torso[0]!.halfDepth <= d.length - d.shoulderDrop);
  }
  assert.equal(defaultBodyChest(ringer()), 94);
  assert.throws(() => validateBodyChest(200), /Body chest must be from 70 to 140 cm/);
  assert.throws(() => simulateGarment(template('trousers'), [], 90), /available for tops/);
});
