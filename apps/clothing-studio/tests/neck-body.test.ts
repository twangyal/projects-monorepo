import test from 'node:test';
import Delaunator from 'delaunator';
import assert from 'node:assert/strict';
import { bodyProxy, outfitBodies, simulateGarment, validateTopBodyShape } from '../src/garment-drape.ts';
import { template, teeMesh } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';
import { validateProfileBody, validateBodyProfiles } from '../src/top-body-profiles.ts';
import { comparisonReceipt, fabricVariants } from '../src/garment-comparison.ts';
const neck = (body: ReturnType<typeof bodyProxy>) => body.capsules[2]!;

test('entered neck circumference is exact and never clipped to garment room', () => {
  for (const id of ['blank', 'hoodie']) {
    const product = template(id), before = structuredClone(product), body = bodyProxy(product, 94, { neckGirth: 40 });
    assert.equal(neck(body).radius, 40 / (2 * Math.PI)); assert.equal(body.neckGirth, 40);
    assert.ok(neck(body).radius > neck(bodyProxy(product, 94)).radius); assert.deepEqual(product, before);
    const automatic = bodyProxy(product, 94);
    assert.deepEqual(body.torso, automatic.torso);
    assert.deepEqual(body.capsules.filter((_, index) => index !== 2), automatic.capsules.filter((_, index) => index !== 2));
  }
});
test('omitted neck measurements preserve automatic body geometry exactly', () => {
  const p = template('blank'), body = bodyProxy(p, 94);
  assert.deepEqual(bodyProxy(p, 94, { neckGirth: undefined }), body);
  assert.equal(Object.hasOwn(body, 'neckGirth'), false);
});
test('neck girth accepts finite bounds and refuses malformed explicit measurements', () => {
  for (const value of [20, 40, 65]) assert.equal(validateTopBodyShape(94, { neckGirth: value }).neckGirth, value);
  for (const value of [19.99, 65.01, NaN, Infinity, null, '40']) assert.throws(() => validateTopBodyShape(94, { neckGirth: value as number }), /neck/i);
});
test('project and reusable profile backups retain entered girth while old data stays unchanged', () => {
  const old = { chest: 94, waist: null, hip: null, chestDepth: null }, body = { ...old, neckGirth: 40 };
  assert.deepEqual(validateProfileBody(old), old); assert.deepEqual(validateProfileBody(body), body);
  assert.deepEqual(validateProfileBody({ ...body, neckGirth: null }), { ...body, neckGirth: null });
  const profiles = { schema: 1, kind: 'clothing-top-body-profiles', profiles: [{ name: 'Measured neck', body }] };
  assert.deepEqual(validateBodyProfiles(JSON.parse(JSON.stringify(profiles))), profiles);
  assert.deepEqual(validateProject({ ...createProject(), topBody: body }).topBody, body);
  assert.throws(() => validateProfileBody({ ...body, neckGirth: 70 }));
});
test('an outfit shares the entered neck body without adding a neck to the lower proxy', () => {
  const result = outfitBodies(template('blank'), template('trousers'), 94, { neckGirth: 40 });
  assert.equal(neck(result.body).radius, 40 / (2 * Math.PI)); assert.equal(result.body.neckGirth, 40);
  assert.equal(Object.hasOwn(result.lower, 'neckGirth'), false);
});
test('fabric comparison results must match the captured neck measurement', () => {
  const product = template('blank'), body = { chest: 94, waist: 80, hip: 96, neckGirth: 40 }, materials: [string, string] = ['jersey-180', 'denim-340'];
  const candidates = fabricVariants(product, materials);
  const results = candidates.map(p => simulateGarment(p, teeMesh(p, Delaunator), 94, { bodyShape: body, frames: 46, substeps: 1 })) as [ReturnType<typeof simulateGarment>, ReturnType<typeof simulateGarment>];
  assert.equal(comparisonReceipt(product, body, materials, results).body.neckGirth, 40);
  assert.throws(() => comparisonReceipt(product, { ...body, neckGirth: 42 }, materials, results), /match the captured body/);
});
