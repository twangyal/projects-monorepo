import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { innerLayer, simulateOutfit } from '../src/garment-drape.ts';
import { canWearTogether, layerOrder, sleeveAngleOf, teeDimensions, teeMesh, template, withSleeveAngle, type Product } from '../src/product.ts';
import { switchOutfitEditing } from '../src/outfit-edit.ts';
import { createProject } from '../src/model.ts';

test('a T-shirt can be worn under a sweatshirt or hoodie, and no other top under another', () => {
  const tee = template('blank'), hoodie = template('zip-hoodie'), sweat = template('crew-sweat');
  assert.deepEqual(layerOrder(hoodie, tee), { inner: tee, outer: hoodie });
  assert.deepEqual(layerOrder(tee, sweat), { inner: tee, outer: sweat });
  assert.equal(layerOrder(hoodie, sweat), null);
  assert.equal(layerOrder(tee, template('ringer')), null);
  assert.ok(canWearTogether(tee, hoodie) && canWearTogether(hoodie, template('joggers')));
  assert.ok(!canWearTogether(template('shorts'), template('joggers')));
  // Either garment of the outfit can be the one being edited.
  const project = switchOutfitEditing({ ...createProject(), product: hoodie, wornWith: tee });
  assert.equal(project.product?.name, tee.name);
});

test('the top underneath is made for the outer top\'s arm pose, without changing the saved design', () => {
  const tee = template('blank'), posed = withSleeveAngle(tee, sleeveAngleOf(template('hoodie')));
  assert.equal(teeDimensions(tee).sleeveAngle, 38);
  assert.equal(teeDimensions(posed).sleeveAngle, 58);
  assert.equal(JSON.stringify(posed), JSON.stringify(tee), 'the pose is not part of the design');
  assert.deepEqual(teeMesh(posed, Delaunator).map(part => part.positions.length), teeMesh(tee, Delaunator).map(part => part.positions.length));
  const hoodie = template('hoodie');
  assert.throws(() => simulateOutfit(hoodie, teeMesh(hoodie, Delaunator), tee, teeMesh(tee, Delaunator), 94, { frames: 60 }), /arm pose/);
});

function layered(outer: Product, frames = 180) {
  const inner = withSleeveAngle(template('blank'), sleeveAngleOf(outer)), innerMeshes = teeMesh(inner, Delaunator);
  return { inner, innerMeshes, result: simulateOutfit(outer, teeMesh(outer, Delaunator), inner, innerMeshes, 94, { frames }) };
}

function insideCount(over: { positions: Float32Array }[], under: { positions: Float32Array }[], body: Parameters<typeof innerLayer>[1]) {
  const layer = innerLayer(under, body, body.torso[1]!.y);
  let covered = 0, inside = 0;
  for (const { positions } of over) for (let i = 0; i < positions.length; i += 3) {
    const clearance = layer.clearance(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (clearance === null) continue;
    covered++;
    if (clearance < -0.5) inside++;
  }
  return { covered, inside };
}

test('a zip hoodie over a T-shirt drapes on it, outside it, and both settle', () => {
  const { result } = layered(template('zip-hoodie'));
  assert.ok(result.companion, 'the tee comes back beside the hoodie');
  const { covered, inside } = insideCount(result.parts, result.companion.parts, result.body);
  assert.ok(covered > 1500, `the hoodie lies over the tee (${covered} points)`);
  assert.ok(inside <= covered * 0.01, `${inside} of ${covered} hoodie points are inside the tee`);
  assert.ok(result.metrics.maxStrain < 0.8 && result.companion.metrics.maxStrain < 0.3, `stretch ${result.metrics.maxStrain}, ${result.companion.metrics.maxStrain}`);
  assert.ok(result.metrics.residualSpeed < 10 && result.companion.metrics.residualSpeed < 10, `both garments settle (${result.metrics.residualSpeed}, ${result.companion.metrics.residualSpeed} cm/s)`);
  // The hoodie still hangs from the shoulders to below the hip, as it does alone.
  assert.ok(result.metrics.fit?.hemBelowHip !== undefined && result.metrics.fit.hemBelowHip > 4, `the hem falls ${result.metrics.fit?.hemBelowHip} cm below the hip`);
});

test('worn open over a T-shirt, the hoodie parts over it and stays outside it elsewhere', () => {
  const hoodie = template('zip-hoodie'), { result } = layered({ ...hoodie, options: { ...hoodie.options!, zipOpen: true } });
  const { covered, inside } = insideCount(result.parts, result.companion!.parts, result.body);
  assert.ok(covered > 1500 && inside <= covered * 0.01, `${inside} of ${covered} hoodie points are inside the tee`);
  assert.ok(result.metrics.maxStrain < 1.2, `stretch ${result.metrics.maxStrain}`);
  // Nothing of the hoodie lies over the T-shirt's centre front at the chest: the opening shows it.
  const chest = result.body.landmarks?.bust ?? result.body.torso[1]!.y;
  let overFront = 0;
  for (const { part, positions } of result.parts) if (part !== 'hood') for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i]!) < 2 && positions[i + 2]! > 0 && Math.abs(positions[i + 1]! - chest) < 10) overFront++;
  }
  assert.equal(overFront, 0, 'the open front stays open over the tee');
});

test('worn under a sweatshirt, the T-shirt is the garment drawn and the sweatshirt comes back beside it', () => {
  const sweat = template('crew-sweat'), inner = withSleeveAngle(template('blank'), sleeveAngleOf(sweat)), innerMeshes = teeMesh(inner, Delaunator);
  const result = simulateOutfit(inner, innerMeshes, sweat, teeMesh(sweat, Delaunator), 94, { frames: 120 });
  assert.deepEqual(result.parts.map(part => part.part), innerMeshes.map(mesh => mesh.part));
  assert.ok(result.companion!.parts.some(part => part.part === 'hemBand'), 'the sweatshirt beside it');
  const layer = innerLayer(result.parts, result.body, result.body.torso[1]!.y);
  let over = 0, inside = 0;
  for (const { positions } of result.companion!.parts) for (let i = 0; i < positions.length; i += 3) {
    const clearance = layer.clearance(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (clearance === null) continue;
    over++;
    if (clearance < -0.5) inside++;
  }
  assert.ok(over > 1500 && inside <= over * 0.01, `${inside} of ${over} sweatshirt points are inside the tee`);
});
