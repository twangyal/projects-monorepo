import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { canTuck, layerField, outfitBodies, outfitShape, simulateGarment, simulateOutfit } from '../src/garment-drape.ts';
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
  // Tucking is kept with an outfit, and dropped without a garment worn with the product.
  assert.equal(validateProject({ ...project, tucked: true }).tucked, true);
  assert.equal(validateProject({ ...createProject(), product: template('blank'), tucked: true }).tucked, undefined);
  assert.throws(() => validateProject({ ...project, tucked: 'yes' }), /Tucked must be true or false/);
});

test('a tucked top drapes first, held close to the body below the waist, and the bottoms drape outside it', () => {
  // Long sleeves: the cuffs hang about as low as the waist, but only the top's body is tucked.
  const top = template('breton'), topMeshes = teeMesh(top, Delaunator);
  for (const bottoms of [template('trousers'), template('flared-skirt')]) {
    const bottomMeshes = teeMesh(bottoms, Delaunator);
    const result = simulateOutfit(top, topMeshes, bottoms, bottomMeshes, 94, { frames: 120, tucked: true });
    const { body } = outfitBodies(top, bottoms, 94), waist = body.landmarks!.waist!, floor = body.bottom === undefined ? -Infinity : body.landmarks!.hip!;
    // The top's body below the waistband (and above the hip, in trousers), as a layer: no point of the bottoms is inside it.
    const tucked = result.parts.filter(({ part }) => ['front', 'back', 'hemBand', 'pocket'].includes(part)).map(({ part, positions }) => {
      const indices = topMeshes.find(mesh => mesh.part === part)!.indices, kept: number[] = [];
      for (let t = 0; t + 2 < indices.length; t += 3) if ([0, 1, 2].every(c => { const y = positions[indices[t + c]! * 3 + 1]!; return y <= waist && y >= floor; })) kept.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
      return { positions, indices: kept };
    });
    const field = layerField(tucked, 0);
    let covered = 0, inside = 0;
    for (const { positions } of result.companion!.parts) for (let i = 0; i < positions.length; i += 3) {
      const reach = field.radius(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      if (reach <= 0) continue;
      covered++;
      if (Math.hypot(positions[i]!, positions[i + 2]!) < reach - 0.05) inside++;
    }
    assert.ok(covered > 50, `${bottoms.name}: the bottoms cover the tucked tee (${covered} points)`);
    assert.equal(inside, 0, `${bottoms.name}: no point of the bottoms is inside the tucked tee`);
    // Untucked, the tee would hang outside the bottoms; tucked, its hem stays inside them, close to the body.
    let lowest = Infinity;
    for (const { positions } of result.parts) for (let i = 1; i < positions.length; i += 3) lowest = Math.min(lowest, positions[i]!);
    assert.ok(lowest < waist - 5, `${bottoms.name}: the tee reaches ${(waist - lowest).toFixed(1)} cm below the waist, inside the bottoms`);
    assert.ok(result.metrics.maxStrain < 0.6, `${bottoms.name}: stretch ${result.metrics.maxStrain}`);
    // The bottoms stay on the body: near the waist none of them reaches far from it.
    let widest = 0;
    for (const { positions } of result.companion!.parts) for (let i = 0; i < positions.length; i += 3) if (Math.abs(positions[i + 1]! - waist) < 3) widest = Math.max(widest, Math.hypot(positions[i]!, positions[i + 2]!));
    assert.ok(widest < 22, `${bottoms.name}: at the waist the bottoms reach ${widest.toFixed(1)} cm from the body's axis`);
    assert.ok(result.companion!.metrics.residualSpeed < 10 && result.metrics.residualSpeed < 10, 'both garments settle');
  }
});

test('a dress cannot be tucked in', () => {
  const dress = template('tee-dress'), trousers = template('trousers');
  assert.throws(() => simulateOutfit(dress, teeMesh(dress, Delaunator), trousers, teeMesh(trousers, Delaunator), 94, { frames: 60, tucked: true }), /dress cannot be tucked/);
  assert.equal(canTuck(dress), false);
  assert.equal(canTuck(template('blank')), true);
});
