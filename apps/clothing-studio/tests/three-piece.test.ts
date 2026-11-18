import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { innerLayer, layerField, simulateOutfit, threePiece } from '../src/garment-drape.ts';
import { sleeveAngleOf, teeMesh, template, withSleeveAngle } from '../src/product.ts';
import { createProject, validateProject } from '../src/model.ts';
import { switchOutfitEditing } from '../src/outfit-edit.ts';
import { shownThrough } from './helpers/shown-through.ts';

test('three garments make an outfit as a T-shirt under a sweatshirt or hoodie, or a sweatshirt under a coat, with bottoms', () => {
  const tee = template('blank'), hoodie = template('zip-hoodie'), joggers = template('joggers');
  assert.deepEqual(threePiece([joggers, hoodie, tee]), { inner: tee, outer: hoodie, bottoms: joggers });
  assert.equal(threePiece([tee, template('ringer'), joggers]), null);
  assert.equal(threePiece([tee, hoodie, template('crew-sweat')]), null);
  assert.equal(threePiece([tee, joggers, template('shorts')]), null);
  const coat = template('coat'), sweat = template('crew-sweat');
  assert.deepEqual(threePiece([coat, joggers, sweat]), { inner: sweat, outer: coat, bottoms: joggers });
  assert.equal(threePiece([coat, joggers, template('hoodie')]), null);
});

test('joggers, a T-shirt over them and a hoodie over both drape together, each outside the one under it', () => {
  const hoodie = template('zip-hoodie'), joggers = template('joggers'), tee = withSleeveAngle(template('blank'), sleeveAngleOf(hoodie));
  const teeMeshes = teeMesh(tee, Delaunator), jogMeshes = teeMesh(joggers, Delaunator), hoodieMeshes = teeMesh(hoodie, Delaunator);
  const result = simulateOutfit(hoodie, hoodieMeshes, tee, teeMeshes, 94, { also: { product: joggers, meshes: jogMeshes } });
  assert.ok(result.companion && result.also, 'the tee and the joggers come back beside the hoodie');
  assert.equal(result.settings.frames, 180);
  assert.deepEqual(result.companion.settings, result.settings);
  assert.deepEqual(result.also.settings, result.settings);
  // The hoodie's body is outside the tee's (its short sleeves gather beside the body; see layered-tops.test.ts), and
  // none of the tee shows through the hoodie: its sleeves, nor its body between the hem band and the armholes.
  const body = (parts: typeof result.parts) => parts.filter(({ part }) => !/^(sleeve|cuff)/.test(part));
  const layer = innerLayer(body(result.companion.parts), result.body, result.body.torso[1]!.y);
  let covered = 0, inside = 0;
  for (const { positions } of body(result.parts)) for (let i = 0; i < positions.length; i += 3) {
    const clearance = layer.clearance(positions[i]!, positions[i + 1]!, positions[i + 2]!);
    if (clearance === null) continue;
    covered++;
    if (clearance < -0.5) inside++;
  }
  assert.ok(covered > 1500 && inside <= covered * 0.01, `${inside} of ${covered} hoodie points are inside the tee`);
  const armpit = result.body.torso[1]!.y, band = Math.max(...Array.from(result.parts.find(part => part.part === 'hemBand')!.positions).filter((_, i) => i % 3 === 1));
  const shown = shownThrough(result.parts, hoodieMeshes, result.companion.parts, ['sleeveLeft', 'sleeveRight'], -Infinity, Infinity, armpit + 30)
    + shownThrough(result.parts, hoodieMeshes, result.companion.parts, ['front', 'back'], band + 2, armpit, armpit + 30);
  assert.equal(shown, 0, `${shown} points of the tee show through the hoodie`);
  // The tee and the hoodie are outside the joggers where they hang over them. Under the hoodie's rib hem band, which
  // grips the joggers' waistband, the tee may lie a hair inside it, hidden there; the hoodie is what shows.
  const field = layerField(result.also.parts.map(({ part, positions }) => ({ positions, indices: jogMeshes.find(mesh => mesh.part === part)!.indices })), 0);
  for (const [name, parts] of [['tee', result.companion.parts], ['hoodie', result.parts]] as const) {
    let over = 0, under = 0;
    for (const { positions } of parts) for (let i = 0; i < positions.length; i += 3) {
      const reach = field.radius(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      if (reach <= 0) continue;
      over++;
      const inside = reach - Math.hypot(positions[i]!, positions[i + 2]!);
      if (inside > 0.05 && !(name === 'tee' && positions[i + 1]! <= band && inside < 0.2)) under++;
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

test('editing the bottoms directly keeps both applied top layers and the shared body', () => {
  const outer = template('zip-hoodie'), inner = template('blank'), bottoms = template('joggers');
  const project = validateProject({ ...createProject(), product: outer, wornWith: inner, wornAlso: bottoms,
    topBody: { chest: 100, waist: 76, hip: 100, chestDepth: 24, height: 178, hipDepth: 20 } });
  const next = switchOutfitEditing(project, 'bottoms');
  assert.deepEqual([next.product, next.wornWith, next.wornAlso], [project.wornAlso, project.product, project.wornWith]);
  assert.deepEqual(next.topBody, project.topBody);
  assert.deepEqual(switchOutfitEditing(next, 'outer'), project);
});

test('an outfit built around the initial tee can switch to either worn garment', () => {
  const outer = template('zip-hoodie'), bottoms = template('joggers');
  const project = validateProject({ ...createProject(), wornWith: outer, wornAlso: bottoms });
  assert.equal(project.product, undefined);
  assert.deepEqual(switchOutfitEditing(project, 'inner'), project);
  const next = switchOutfitEditing(project, 'bottoms');
  assert.deepEqual([next.product, next.wornWith, next.wornAlso], [bottoms, template('blank'), outer]);
  const pair = switchOutfitEditing(validateProject({ ...createProject(), wornWith: bottoms }));
  assert.deepEqual([pair.product, pair.wornWith], [bottoms, template('blank')]);
});
