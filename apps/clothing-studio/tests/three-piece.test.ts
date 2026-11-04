import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { innerLayer, layerField, simulateOutfit, threePiece } from '../src/garment-drape.ts';
import { sleeveAngleOf, teeMesh, template, withSleeveAngle } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';
import { switchOutfitEditing } from '../src/outfit-edit.ts';

test('three garments make an outfit as a T-shirt under a sweatshirt or hoodie, with bottoms', () => {
  const tee = template('blank'), hoodie = template('zip-hoodie'), joggers = template('joggers');
  assert.deepEqual(threePiece([joggers, hoodie, tee]), { inner: tee, outer: hoodie, bottoms: joggers });
  assert.equal(threePiece([tee, template('ringer'), joggers]), null);
  assert.equal(threePiece([tee, hoodie, template('crew-sweat')]), null);
  assert.equal(threePiece([tee, joggers, template('shorts')]), null);
});

test('joggers, a T-shirt over them and a hoodie over both drape together, each outside the one under it', () => {
  const hoodie = template('zip-hoodie'), joggers = template('joggers'), tee = withSleeveAngle(template('blank'), sleeveAngleOf(hoodie));
  const teeMeshes = teeMesh(tee, Delaunator), jogMeshes = teeMesh(joggers, Delaunator);
  const result = simulateOutfit(hoodie, teeMesh(hoodie, Delaunator), tee, teeMeshes, 94, { also: { product: joggers, meshes: jogMeshes } });
  assert.ok(result.companion && result.also, 'the tee and the joggers come back beside the hoodie');
  assert.equal(result.settings.frames, 180);
  assert.deepEqual(result.companion.settings, result.settings);
  assert.deepEqual(result.also.settings, result.settings);
  // The hoodie is outside the tee.
  const layer = innerLayer(result.companion.parts, result.body, result.body.torso[1]!.y);
  let covered = 0, inside = 0;
  for (const { positions } of result.parts) for (let i = 0; i < positions.length; i += 3) {
    const clearance = layer.clearance(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (clearance === null) continue;
    covered++;
    if (clearance < -0.5) inside++;
  }
  assert.ok(covered > 1500 && inside <= covered * 0.01, `${inside} of ${covered} hoodie points are inside the tee`);
  // The tee and the hoodie are outside the joggers where they hang over them.
  const field = layerField(result.also.parts.map(({ part, positions }) => ({ positions, indices: jogMeshes.find(mesh => mesh.part === part)!.indices })), 0);
  for (const [name, parts] of [['tee', result.companion.parts], ['hoodie', result.parts]] as const) {
    let over = 0, under = 0;
    for (const { positions } of parts) for (let i = 0; i < positions.length; i += 3) {
      const reach = field.radius(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      if (reach <= 0) continue;
      over++;
      if (Math.hypot(positions[i]!, positions[i + 2]!) < reach - 0.05) under++;
    }
    assert.ok(over > 100, `the ${name} hangs over the joggers (${over} points)`);
    assert.ok(under <= over * 0.01, `${under} of ${over} ${name} points are inside the joggers`);
  }
  // The joggers reach the floor's way past the tops, and everything settles.
  let lowest = Infinity;
  for (const { positions } of result.also.parts) for (let i = 1; i < positions.length; i += 3) lowest = Math.min(lowest, positions[i]!);
  assert.ok(lowest < -60, 'the jogger legs reach down past the tops');
  for (const [name, metrics] of [['hoodie', result.metrics], ['tee', result.companion.metrics], ['joggers', result.also.metrics]] as const) {
    assert.ok(metrics.residualSpeed < 10 && metrics.maxStrain < 0.8, `${name}: still moving at ${metrics.residualSpeed} cm/s, stretch ${metrics.maxStrain}`);
  }
});

test('a project keeps a third garment only with a second, untucked, and editing goes round all three', () => {
  const tee = template('blank'), hoodie = template('zip-hoodie'), joggers = template('joggers');
  const project = validateProject({ ...createProject(), product: hoodie, wornWith: tee, wornAlso: joggers, tucked: true });
  assert.equal(project.wornAlso?.name, 'Joggers');
  assert.equal(project.tucked, undefined, 'three garments are worn untucked');
  assert.equal(validateProject({ ...createProject(), product: hoodie, wornAlso: joggers }).wornAlso, undefined, 'a third garment needs a second');
  const next = switchOutfitEditing(project);
  assert.deepEqual([next.product?.name, next.wornWith?.name, next.wornAlso?.name], ['Blank tee', 'Joggers', 'Zip hoodie']);
  assert.deepEqual([switchOutfitEditing(switchOutfitEditing(next)).product?.name], ['Zip hoodie']);
});
