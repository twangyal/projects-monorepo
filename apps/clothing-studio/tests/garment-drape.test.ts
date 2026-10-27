import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { bendingLength, bendingStencil, bodyProxy, buildCloth, defaultBodyChest, simulateGarment, validateBodyChest } from '../src/garment-drape.ts';
import { material, teeDimensions, teeMesh, template, topMeasurements, type Product } from '../src/product.ts';

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

test('isometric bending matches the continuum bending energy on a cylinder', () => {
  // A 20 × 10 cm sheet of 0.5 cm cells bent onto a 15 cm radius: energy ½·D·κ²·area, less the boundary edges.
  const W = 20, H = 10, h = 0.5, R = 15, D = 100, nx = W / h + 1, ny = H / h + 1, id = (i: number, j: number) => j * nx + i;
  const flat: [number, number][] = [], bent: [number, number, number][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { flat.push([i * h, j * h]); bent.push([R * Math.sin(i * h / R), j * h, R * (1 - Math.cos(i * h / R))]); }
  const edges = new Map<string, number[]>();
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    for (const t of [[id(i, j), id(i + 1, j), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i, j + 1)]]) {
      for (let e = 0; e < 3; e++) { const a = t[e]!, b = t[(e + 1) % 3]!, k = a < b ? `${a},${b}` : `${b},${a}`; edges.set(k, [...(edges.get(k) ?? [Math.min(a, b), Math.max(a, b)]), t[(e + 2) % 3]!]); }
    }
  }
  let energy = 0;
  for (const [a, b, o1, o2] of edges.values()) {
    if (o2 === undefined) continue;
    const stencil = bendingStencil(flat[a!]!, flat[b!]!, flat[o1!]!, flat[o2]!, D), v = [0, 0, 0];
    [a!, b!, o1!, o2].forEach((p, c) => { for (let k = 0; k < 3; k++) v[k] += stencil.weights[c]! * bent[p]![k]!; });
    energy += 0.5 * stencil.stiffness * (v[0]! ** 2 + v[1]! ** 2 + v[2]! ** 2);
  }
  const ratio = energy / (0.5 * D * W * H / (R * R));
  assert.ok(ratio > 0.93 && ratio < 1.02, `energy ratio ${ratio}`);
  // A flat sheet has no bending energy.
  const flatStencil = bendingStencil([0, 0], [2, 0], [1, 1.5], [0.8, -1.7], D);
  assert.ok(Math.abs(flatStencil.weights.reduce((sum, w, c) => sum + w * [0, 2, 1, 0.8][c]!, 0)) < 1e-9);
});

test('library fabrics have realistic bending lengths, stiffest for denim', () => {
  const jersey = bendingLength(material('jersey-180')), linen = bendingLength(material('linen-170')), denim = bendingLength(material('denim-340'));
  assert.ok(jersey > 1 && jersey < 1.5, `jersey ${jersey}`);
  assert.ok(denim > 2 && denim < 3, `denim ${denim}`);
  assert.ok(jersey < linen && linen < denim);
});

test('fabric changes how the same tee hangs: denim stands off the body, jersey clings, and both settle', () => {
  const dressed = (id: string) => {
    const product: Product = template('ringer');
    for (const part of Object.keys(product.parts) as (keyof Product['parts'])[]) product.parts[part].material = id;
    return simulateGarment(product, teeMesh(product, Delaunator), 94).metrics;
  };
  const jersey = dressed('jersey-180'), denim = dressed('denim-340');
  assert.ok(denim.contact < jersey.contact - 0.04, `contact ${denim.contact} vs ${jersey.contact}`);
  for (const metrics of [jersey, denim]) {
    assert.ok(metrics.maxStrain < 0.4, `stretch ${metrics.maxStrain}`);
    assert.ok(metrics.residualSpeed < 10, `still moving at ${metrics.residualSpeed} cm/s`);
  }
});

test('a flared skirt drapes from its held waistline: the hem falls inside the rigid flare, softest for jersey', () => {
  const hem = (id: string) => {
    const skirt: Product = template('flared-skirt');
    for (const part of Object.keys(skirt.parts) as (keyof Product['parts'])[]) skirt.parts[part].material = id;
    const meshes = teeMesh(skirt, Delaunator), result = simulateGarment(skirt, meshes, defaultBodyChest(skirt));
    let radius = 0, count = 0, top = -Infinity, rigidTop = -Infinity;
    result.parts.forEach((part, n) => {
      const rest = meshes[n]!.positions;
      for (let v = 0; v < rest.length / 3; v++) {
        top = Math.max(top, part.positions[v * 3 + 1]!); rigidTop = Math.max(rigidTop, rest[v * 3 + 1]!);
        if (rest[v * 3 + 1]! < 1e-6) { radius += Math.hypot(part.positions[v * 3]!, part.positions[v * 3 + 2]!); count++; }
      }
    });
    return { radius: radius / count, top, rigidTop, metrics: result.metrics };
  };
  const jersey = hem('jersey-180'), denim = hem('denim-340'), rigid = 140 / (2 * Math.PI);
  for (const skirt of [jersey, denim]) {
    assert.ok(Math.abs(skirt.top - skirt.rigidTop) < 1e-4, 'the waist stays at the waistline');
    assert.ok(skirt.radius < rigid - 1, `hem radius ${skirt.radius} vs rigid ${rigid}`);
    assert.ok(skirt.metrics.residualSpeed < 10, `still moving at ${skirt.metrics.residualSpeed} cm/s`);
    assert.ok(skirt.metrics.minClearance > 0.3, `clearance ${skirt.metrics.minClearance}`);
    assert.equal(skirt.metrics.ease, 2);
  }
  assert.ok(jersey.radius < denim.radius - 1, `jersey ${jersey.radius} vs denim ${denim.radius}`);
});

test('skirt bodies must fit inside the waist, and trousers are not draped', () => {
  const skirt = template('flared-skirt'), meshes = teeMesh(skirt, Delaunator);
  assert.throws(() => simulateGarment(skirt, meshes, 94, { bodyShape: { waist: 85 }, frames: 60 }), /smaller than the skirt's 80 cm waist/);
  const trousers = template('trousers');
  assert.throws(() => simulateGarment(trousers, teeMesh(trousers, Delaunator), 94), /tops and skirts/);
});
