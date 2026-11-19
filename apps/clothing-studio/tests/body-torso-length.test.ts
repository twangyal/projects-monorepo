import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { bodyProxy, outfitBodies, validateTopBodyShape, simulateGarment } from '../src/garment-drape.ts';
import { template, teeDimensions, teeMesh } from '../src/product.ts';
import { validateProfileBody, validateBodyProfiles } from '../src/top-body-profiles.ts';
import { createProject, validateProject, serializeProject, parseProject, ProjectHistory } from '../src/model.ts';
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const shape = (torsoLength: number, extra = {}) => ({ torsoLength, ...extra });

test('measured torso length moves waist and hip independently of the shoulders, girths and arms', () => {
  const tee = template('ringer'), d = teeDimensions(tee), short = bodyProxy(tee, 94, shape(36, { height: 175 })), long = bodyProxy(tee, 94, shape(46, { height: 175 }));
  close(short.landmarks!.waist!, d.length - d.shoulderDrop - 36);
  close(long.landmarks!.waist!, short.landmarks!.waist! - 10);
  close(long.landmarks!.hip!, short.landmarks!.hip! - 10);
  assert.deepEqual(short.torso.slice(0, 2), long.torso.slice(0, 2));
  assert.deepEqual(short.capsules, long.capsules);
  assert.equal(short.waist, long.waist); assert.equal(short.hip, long.hip);
  const entered = bodyProxy(tee, 94, shape(46, { hipDepth: 23 }));
  close(entered.landmarks!.waist! - entered.landmarks!.hip!, 23);
});

test('blank torso preserves old geometry and invalid or armpit-crossing measurements refuse', () => {
  const tee = template('ringer');
  assert.deepEqual(bodyProxy(tee, 94), bodyProxy(tee, 94, { torsoLength: undefined } as never));
  for (const torsoLength of [19, 61, NaN, Infinity, '40', null]) assert.throws(() => validateTopBodyShape(94, { torsoLength } as never), /shoulder|torso/i);
  assert.throws(() => validateTopBodyShape(140, shape(25)), /armpit/i);
  assert.throws(() => validateTopBodyShape(94, shape(25, { height: 210 })), /armpit/i);
  assert.doesNotThrow(() => validateTopBodyShape(94, shape(40, { height: 175 })));
});

test('an outfit waist and hips follow torso length while an entered height keeps its existing floor', () => {
  const top = template('ringer'), bottoms = template('trousers'), given = { height: 175, waist: 75, hip: 90 };
  const legacy = outfitBodies(top, bottoms, 94, given), changed = outfitBodies(top, bottoms, 94, shape(46.125, given));
  close(changed.body.landmarks!.waist!, legacy.body.landmarks!.waist! - 5);
  close(changed.body.landmarks!.hip!, legacy.body.landmarks!.hip! - 5);
  close(changed.body.landmarks!.floor!, legacy.body.landmarks!.floor!);
  close(changed.lower.landmarks!.floor!, legacy.lower.landmarks!.floor! + 5);
  assert.deepEqual(outfitBodies(top, bottoms, 94, { ...given, torsoLength: undefined } as never), legacy);
});

test('torso length survives project backups, profiles and history without changing the garment', () => {
  const body = { chest: 94, waist: null, hip: null, chestDepth: null, height: 175, torsoLength: 44 };
  assert.deepEqual(validateProfileBody(body), body);
  assert.equal((validateProfileBody({ ...body, torsoLength: null }) as typeof body).torsoLength, null);
  const project = createProject(), next = validateProject({ ...project, product: template('ringer'), topBody: body });
  assert.deepEqual(parseProject(serializeProject(next)), next);
  assert.deepEqual(validateBodyProfiles({ schema: 1, kind: 'clothing-top-body-profiles', profiles: [{ name: 'Measured', body }] }).profiles[0]!.body, body);
  const h = new ProjectHistory(project); h.commit(next); assert.deepEqual(h.undo(), project); assert.deepEqual(h.redo(), next);
});

test('the actual garment solve uses the measured waist level and returns finite positions', () => {
  const tee = template('ringer'), meshes = teeMesh(tee, Delaunator);
  const a = simulateGarment(tee, meshes, 94, { frames: 60, bodyShape: shape(35) }), b = simulateGarment(tee, meshes, 94, { frames: 60, bodyShape: shape(48) });
  assert.ok(a.parts[0]!.positions.some((v, i) => v !== b.parts[0]!.positions[i]), 'torso measurement changes actual drape');
  close(a.body.landmarks!.waist! - b.body.landmarks!.waist!, 13);
  assert.ok(b.parts.every(part => part.positions.every(Number.isFinite)));
  assert.ok(b.metrics.minClearance >= .34);
});


test('a long measured torso on a cropped top keeps every lower torso section below the hip', () => {
  const cropped = { ...template('crop-top'), measurements: { chest: 100, length: 40, sleeve: 19 } };
  const body = bodyProxy(cropped, 94, shape(60, { hipDepth: 40 }));
  assert.ok(body.torso.every((section, index) => index === 0 || section.y < body.torso[index - 1]!.y));
  assert.ok(body.capsules.every(capsule => [...capsule.a, ...capsule.b, capsule.radius, capsule.end].every(Number.isFinite)));
});


test('profile and project validation use the entered height for torso clearance in both directions', () => {
  const body = { chest: 130, waist: null, hip: null, chestDepth: null, height: 150, torsoLength: 24 };
  const profile = (body: unknown) => ({ schema: 1, kind: 'clothing-top-body-profiles', profiles: [{ name: 'Measured', body }] });
  assert.deepEqual(validateProfileBody(body), body);
  assert.equal(validateBodyProfiles(profile(body)).profiles[0]!.body.torsoLength, 24);
  assert.deepEqual(parseProject(serializeProject(validateProject({ ...createProject(), topBody: body }))).topBody, body);
  const crossing = { ...body, chest: 94, height: 210, torsoLength: 25 };
  assert.throws(() => validateProfileBody(crossing), /armpit/);
  assert.throws(() => validateBodyProfiles(profile(crossing)), /armpit/);
  assert.throws(() => validateProject({ ...createProject(), topBody: crossing }), /armpit/);
});
