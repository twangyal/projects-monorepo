import test from 'node:test';
import Delaunator from 'delaunator';
import assert from 'node:assert/strict';
import { bodyProxy, outfitBodies, simulateGarment, validateTopBodyShape } from '../src/garment-drape.ts';
import { template, teeMesh } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';
import { validateProfileBody, validateBodyProfiles } from '../src/top-body-profiles.ts';
import { comparisonReceipt, fabricVariants } from '../src/garment-comparison.ts';
const arm = (body: ReturnType<typeof bodyProxy>) => body.capsules.find(c => c.limb && c.a[0] !== 0)!;

test('entered upper-arm circumference is exact and never clipped to garment room', () => {
  for (const id of ['blank', 'hoodie']) {
    const product = template(id), before = structuredClone(product), body = bodyProxy(product, 94, { upperArmGirth: 40 });
    assert.equal(arm(body).radius, 40 / (2 * Math.PI)); assert.equal(body.upperArmGirth, 40);
    assert.ok(arm(body).radius > arm(bodyProxy(product, 94)).radius); assert.deepEqual(product, before);
  }
});
test('omitted arm measurements preserve automatic body geometry exactly', () => {
  const p = template('blank'), body = bodyProxy(p, 94);
  assert.deepEqual(bodyProxy(p, 94, { upperArmGirth: undefined }), body);
  assert.equal(Object.hasOwn(body, 'upperArmGirth'), false);
});
test('arm girth accepts finite bounds and refuses malformed explicit measurements', () => {
  for (const value of [15, 40, 65]) assert.equal(validateTopBodyShape(94, { upperArmGirth: value }).upperArmGirth, value);
  for (const value of [14.99, 65.01, NaN, Infinity, null, '40']) assert.throws(() => validateTopBodyShape(94, { upperArmGirth: value as number }), /upper.arm/i);
});
test('project and reusable profile backups retain entered girth while old data stays unchanged', () => {
  const old = { chest: 94, waist: null, hip: null, chestDepth: null }, body = { ...old, upperArmGirth: 40 };
  assert.deepEqual(validateProfileBody(old), old); assert.deepEqual(validateProfileBody(body), body);
  assert.deepEqual(validateProfileBody({ ...body, upperArmGirth: null }), { ...body, upperArmGirth: null });
  const profiles = { schema: 1, kind: 'clothing-top-body-profiles', profiles: [{ name: 'Measured arms', body }] };
  assert.deepEqual(validateBodyProfiles(JSON.parse(JSON.stringify(profiles))), profiles);
  assert.deepEqual(validateProject({ ...createProject(), topBody: body }).topBody, body);
  assert.throws(() => validateProfileBody({ ...body, upperArmGirth: 70 }));
});
test('an outfit shares the entered arm body without adding arms to the lower proxy', () => {
  const result = outfitBodies(template('blank'), template('trousers'), 94, { upperArmGirth: 40 });
  assert.equal(arm(result.body).radius, 40 / (2 * Math.PI)); assert.equal(result.body.upperArmGirth, 40);
  assert.equal(Object.hasOwn(result.lower, 'upperArmGirth'), false);
});
test('fabric comparison results must match the captured upper-arm measurement', () => {
  const product = template('blank'), body = { chest: 94, waist: 80, hip: 96, upperArmGirth: 40 }, materials: [string, string] = ['jersey-180', 'denim-340'];
  const candidates = fabricVariants(product, materials);
  const results = candidates.map(p => simulateGarment(p, teeMesh(p, Delaunator), 94, { bodyShape: body, frames: 46, substeps: 1 })) as [ReturnType<typeof simulateGarment>, ReturnType<typeof simulateGarment>];
  assert.equal(comparisonReceipt(product, body, materials, results).body.upperArmGirth, 40);
  assert.throws(() => comparisonReceipt(product, { ...body, upperArmGirth: 42 }, materials, results), /match the captured body/);
});
