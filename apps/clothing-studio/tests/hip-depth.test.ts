import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { bodyProxy, garmentBody, outfitBodies, simulateGarment, validateTopBodyShape, type TopBodyShape } from '../src/garment-drape.ts';
import { patternPieces, teeMesh, template, topMeasurements, trouserDimensions } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';
import { mergeBodyProfiles, validateBodyProfiles, validateProfileBody } from '../src/top-body-profiles.ts';
import { comparisonReceipt } from '../src/garment-comparison.ts';

const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('measured hip depth places the full-hip section below the waist on all product bodies, independently of height and girths', () => {
  for (const id of ['blank', 'flared-skirt', 'trousers'] as const) {
    const product = template(id), before = patternPieces(product);
    for (const height of [undefined, 155, 195]) {
      const body = garmentBody(product, 94, { waist: 70, hip: 90, height, hipDepth: 18 } as TopBodyShape);
      near(body.landmarks!.waist! - body.landmarks!.hip!, 18);
      const hip = body.torso.find(section => Math.abs(section.y - body.landmarks!.hip!) < 1e-8)!;
      near(4 * (hip.halfWidth - hip.halfDepth) + 2 * Math.PI * hip.halfDepth, 90);
      assert.equal(body.waist, 70);
      assert.deepEqual(patternPieces(product), before);
      const sections = body.torso.map(section => section.y);
      assert.ok(sections.every((y, index) => !index || y < sections[index - 1]!), sections.join(','));
    }
  }
});

test('omission keeps original automatic landmarks and depth bounds are strict, including the trouser crotch', () => {
  for (const id of ['blank', 'flared-skirt', 'trousers'] as const) {
    const p = template(id);
    assert.deepEqual(garmentBody(p, 94, {}), garmentBody(p, 94, { hipDepth: undefined } as TopBodyShape));
    for (const hipDepth of [4.999, 40.001, NaN, Infinity, '20', null])
      assert.throws(() => garmentBody(p, 94, { hipDepth } as unknown as TopBodyShape), /hip.*depth/i);
  }
  const p = template('blank'), automatic = bodyProxy(p, 94), tall = bodyProxy(p, 94, { height: 180 });
  near(automatic.landmarks!.waist! - automatic.landmarks!.hip!, 94 * .2);
  near(tall.landmarks!.waist! - tall.landmarks!.hip!, 18);
  for (const hipDepth of [5, 40]) assert.equal((validateTopBodyShape(94, { hipDepth } as TopBodyShape) as TopBodyShape & {hipDepth:number}).hipDepth, hipDepth);
  const trousers = template('trousers'), d = trouserDimensions(trousers), span = d.length + d.waistbandHeight - (d.inseam + 3.5);
  assert.throws(() => garmentBody(trousers, 94, { hipDepth: span } as TopBodyShape), /hip.*crotch/i);
  assert.doesNotThrow(() => garmentBody(trousers, 94, { hipDepth: span - .01 } as TopBodyShape));
});

test('projects and reusable profiles retain optional depth, preserve legacy omission/null and reject bad backups', () => {
  const legacy = { chest: 94, waist: null, hip: null, chestDepth: null };
  assert.deepEqual(validateProfileBody(legacy), legacy);
  for (const hipDepth of [null, 5, 18.5, 40]) {
    const body = { ...legacy, height: 175, hipDepth }, profile = { schema: 1, kind: 'clothing-top-body-profiles', profiles: [{ name: 'Fit body', body }] };
    assert.deepEqual(validateProfileBody(body), body);
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify({ ...createProject(), topBody: body }))).topBody, body);
    assert.deepEqual(mergeBodyProfiles(validateBodyProfiles(profile), validateBodyProfiles(profile)), profile);
  }
  assert.throws(() => validateProfileBody({ ...legacy, hipDepth: '18' }), /hip.*depth/i);
  assert.throws(() => validateProject({ ...createProject(), topBody: { ...legacy, hipDepth: 100 } }), /hip.*depth/i);
  const profile = (hipDepth: number) => validateBodyProfiles({ schema: 1, kind: 'clothing-top-body-profiles', profiles: [{ name: 'Same body', body: { ...legacy, hipDepth } }] });
  assert.throws(() => mergeBodyProfiles(profile(18), profile(20)), /conflict/);
});

test('outfits align measured upper and lower hip levels for skirts and trousers', () => {
  const top = template('blank');
  for (const id of ['flared-skirt', 'trousers'] as const) {
    const upper = bodyProxy(top, 94, { waist: 70, hip: 90, height: 172, hipDepth: 18 } as TopBodyShape);
    const { body, lower, shift } = outfitBodies(top, template(id), 94, { waist: 70, hip: 90, height: 172, hipDepth: 18 } as TopBodyShape);
    near(upper.landmarks!.waist! - upper.landmarks!.hip!, 18);
    near(lower.landmarks!.waist! - lower.landmarks!.hip!, 18);
    near(lower.landmarks!.hip! + shift, upper.landmarks!.hip!);
    near(body.landmarks!.waist! - body.landmarks!.hip!, 18);
  }
});

test('real skirt cloth responds to measured hip level with finite garment-only positions and compatible comparison bodies', () => {
  const product = template('flared-skirt'), meshes = teeMesh(product, Delaunator);
  const make = (hipDepth: number) => simulateGarment(product, meshes, 94, { frames: 90, bodyShape: { waist: 70, hip: 104, hipDepth } as TopBodyShape });
  const shallow = make(12), deep = make(24);
  assert.notDeepEqual(shallow.parts[0]!.positions, deep.parts[0]!.positions);
  assert.ok(deep.parts.every(part => part.positions.every(Number.isFinite)));
  assert.equal(deep.parts.length, meshes.length);
  near(deep.body.landmarks!.waist! - deep.body.landmarks!.hip!, 24);
  const body = { chest: 94, waist: 70, hip: 104, hipDepth: 24 };
  assert.throws(() => comparisonReceipt(product, body, ['linen-170', 'denim-340'], [shallow, shallow]), /captured body/);
  assert.doesNotThrow(() => comparisonReceipt(product, body, ['linen-170', 'denim-340'], [deep, deep]));
});

test('a low measured hip on a short top stays in the displayed mannequin as well as the collision torso', async () => {
  const { mannequinDistance, mannequinMesh } = await import('../src/body-mesh.ts');
  const product = template('blank'); product.measurements = { ...topMeasurements(product), length: 40 };
  const body = bodyProxy(product, 94, { height: 210, hip: 120, hipDepth: 40 });
  const hip = body.torso.find(section => section.y === body.landmarks!.hip)!;
  assert.ok(hip.y < -50, 'exercise the old renderer cutoff');
  near(mannequinDistance(body)(hip.halfWidth, hip.y, 0), 0);
  const withoutLandmark = mannequinMesh({ ...body, landmarks: undefined }, 2);
  const mesh = mannequinMesh(body, 2);
  assert.notStrictEqual(mesh, withoutLandmark, 'the hip landmark changes which torso sections are displayed');
  const ys = mesh.positions.filter((_, index) => index % 3 === 1);
  assert.ok(Math.min(...ys) < hip.y - 5, 'the displayed body continues below the measured hip');
});

test('a measured hip below a short skirt hem is still represented by the mannequin', async () => {
  const { mannequinDistance, mannequinMesh } = await import('../src/body-mesh.ts');
  const product = template('flared-skirt'); product.measurements = { waist: 80, hem: 90, slant: 20 };
  const body = garmentBody(product, 94, { waist: 70, hip: 100, hipDepth: 40 });
  const hip = body.torso[1]!;
  assert.ok(hip.y < -12, 'the full hip lies below the former below-hem display limit');
  near(mannequinDistance(body)(hip.halfWidth, hip.y, 0), 0);
  const mesh = mannequinMesh(body, 2);
  assert.ok(Math.min(...mesh.positions.filter((_, index) => index % 3 === 1)) < hip.y - 5);
});
