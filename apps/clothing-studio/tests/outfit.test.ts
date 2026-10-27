import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { layerField, outfitBodies, outfitShape, simulateGarment, simulateOutfit } from '../src/garment-drape.ts';
import { teeMesh, template } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';

const lowestY = (parts: { positions: Float32Array }[]) => Math.min(...parts.flatMap(({ positions }) => [...positions].filter((_, i) => i % 3 === 1)));

test('a layer field reads how far a garment reaches from the body axis, scaled with the body', () => {
  // A 20 cm radius cylinder from y = 0 to 10, as triangles.
  const positions: number[] = [], indices: number[] = [];
  for (let k = 0; k <= 36; k++) { const a = 2 * Math.PI * k / 36; positions.push(20 * Math.cos(a), 0, 20 * Math.sin(a), 20 * Math.cos(a), 10, 20 * Math.sin(a)); }
  for (let k = 0; k < 36; k++) indices.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  const field = layerField([{ positions: Float32Array.from(positions), indices }], 5);
  assert.ok(Math.abs(field.radius(1, 5, 1) - 20) < 0.3);
  assert.ok(Math.abs(field.radius(-3, 2, -7) - 20) < 0.3);
  assert.equal(field.radius(0, 15, 0), 0);
  field.scale(0.5);
  assert.ok(Math.abs(field.radius(1, 5, 1) - 10) < 0.2, 'half the reach about the core height');
});

test('outfit girths are ones both garments can be worn on', () => {
  const skirt = template('flared-skirt');
  assert.ok(outfitShape(skirt, 100).waist <= 78, 'an automatic waist inside the skirt waist');
  assert.equal(outfitShape(skirt, 100, { waist: 70 }).waist, 70);
  assert.throws(() => outfitBodies(template('blank'), skirt, 100, { waist: 85 }), /smaller than the skirt/);
  const { body, shift } = outfitBodies(template('blank'), template('trousers'), 94, { height: 172 });
  assert.ok(body.torso.some(section => Math.abs(section.y - body.landmarks!.waist!) < 1e-6), 'the bottoms start at the body waist');
  assert.ok(body.capsules.some(capsule => capsule.a[1] < 0 && capsule.limb), 'the legs hang below the top');
  assert.ok(shift < 0 && body.landmarks?.floor !== undefined);
});

test('a top drapes over the bottoms it is worn with, outside them', () => {
  const top = template('blank'), trousers = template('trousers'), topMeshes = teeMesh(top, Delaunator), bottomMeshes = teeMesh(trousers, Delaunator);
  const result = simulateOutfit(top, topMeshes, trousers, bottomMeshes, 94, { frames: 120 });
  assert.ok(result.companion, 'the trousers come back beside the tee');
  const field = layerField(result.companion.parts.map(({ part, positions }) => ({ positions, indices: bottomMeshes.find(mesh => mesh.part === part)!.indices })), 0);
  let over = 0, inside = 0;
  for (const { positions } of result.parts) for (let i = 0; i < positions.length; i += 3) {
    const reach = field.radius(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (reach <= 0) continue;
    over++;
    if (Math.hypot(positions[i]!, positions[i + 2]!) < reach - 0.05) inside++;
  }
  assert.ok(over > 200, `the tee hangs over the trousers (${over} points)`);
  assert.equal(inside, 0, 'no point of the tee is inside the trousers');
  assert.ok(lowestY(result.companion.parts) < -60, 'the trouser legs reach down past the tee');
  // Without the trousers underneath, the same tee hangs closer to the body.
  const alone = simulateGarment(top, topMeshes, 94, { frames: 120, body: result.body });
  assert.ok(alone.metrics.contact > result.metrics.contact - 0.02);
  assert.throws(() => simulateOutfit(top, topMeshes, template('ringer'), teeMesh(template('ringer'), Delaunator), 94, { frames: 60 }), /pairs a top/);
});

test('bottoms worn under a top keep their own place', () => {
  const shorts = template('shorts'), top = template('ringer'), shortsMeshes = teeMesh(shorts, Delaunator);
  const result = simulateOutfit(shorts, shortsMeshes, top, teeMesh(top, Delaunator), 94, { frames: 60 });
  const alone = simulateGarment(shorts, shortsMeshes, 94, { frames: 60, body: outfitBodies(top, shorts, 94).lower });
  assert.deepEqual(result.parts.map(part => part.positions), alone.parts.map(part => part.positions));
  assert.ok(lowestY(result.companion!.parts) > lowestY(result.parts) - 1, 'the tee sits on the shorts, not below them');
});

test('a project keeps the garment worn with its product', () => {
  const project = validateProject({ ...createProject(), product: template('blank'), wornWith: template('trousers') });
  assert.equal(project.wornWith?.name, 'Straight trousers');
  assert.throws(() => validateProject({ ...createProject(), wornWith: { base: 'cape' } }));
});
