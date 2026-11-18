import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateGarment, trouserBodyProxy } from '../src/garment-drape.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';
import {
  FLY_EXTENSION_CM, optionsOf, partsOf, patternPieces, teeMesh, template, trouserDimensions, trouserRise, validateProduct, withOptions, type PartMesh, type Product,
} from '../src/product.ts';

const jeans = template('jeans') as Product, trousers = template('trousers') as Product, shorts = template('shorts') as Product;
const points = (mesh: PartMesh) => Array.from({ length: mesh.positions.length / 3 }, (_, v) => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!] as const);
const ringLength = (ring: (readonly [number, number, number])[]) => ring.reduce((sum, p, i) => sum + Math.hypot(p[0] - ring[(i + 1) % ring.length]![0], p[2] - ring[(i + 1) % ring.length]![2]), 0);

test('trousers and shorts can close with a fly, and a fly’s buttoned waistband can carry belt loops; nothing else can', () => {
  assert.deepEqual(validateProduct(jeans).options, { hem: 'straight', chestPocket: false, yoke: true, backPockets: true, frontPockets: true, fly: true, beltLoops: true });
  assert.ok(partsOf(jeans).includes('beltLoop'));
  const fly = withOptions(shorts, { ...optionsOf(shorts), fly: true });
  assert.equal(fly.parts.beltLoop, undefined, 'no loops until asked for');
  const looped = withOptions(fly, { ...optionsOf(fly), beltLoops: true });
  assert.deepEqual(looped.parts.beltLoop, shorts.parts.waistband, 'belt loops start in the waistband’s style');
  assert.throws(() => withOptions(shorts, { ...optionsOf(shorts), beltLoops: true }), /Belt loops go on a buttoned waistband: add the fly front first/);
  assert.throws(() => withOptions(jeans, { ...optionsOf(jeans), fly: false }), /add the fly front first/, 'the loops go before the fly');
  assert.equal(withOptions(jeans, { ...optionsOf(jeans), fly: false, beltLoops: false }).parts.beltLoop, undefined);
  assert.throws(() => withOptions(template('crew-sweat'), { ...optionsOf(template('crew-sweat')), fly: true }), /A fly front goes on trousers or shorts/);
  assert.throws(() => validateProduct({ ...shorts, options: { hem: 'straight', chestPocket: false, beltLoops: true } }), /Belt loops go on trousers or shorts with a fly front/);
});

test('a fly fits the waist: the legs narrow from the hips to it, and the waistband is the waist plus its button extension', () => {
  const d = trouserDimensions(jeans), plain = trouserDimensions(trousers);
  assert.equal(d.waistbandLength, d.waist + FLY_EXTENSION_CM);
  assert.equal(plain.waistbandLength, plain.hip + 6, 'pull-on trousers keep a waistband as long as the hips need');
  const top = (front: boolean, dims = d) => dims.centreAt(front, 0) - dims.sideAt(front, front ? 0 : dims.backRaise);
  // A quarter of the waist across each front leg, and a quarter plus 0.5 cm across each back leg: eased 1 cm into the band.
  assert.ok(Math.abs(top(true) - d.waist / 4) < 1e-9 && Math.abs(top(false) - (d.waist / 4 + 0.5)) < 1e-9, `${top(true)} ${top(false)}`);
  assert.ok(Math.abs(top(true, plain) - (plain.frontHip - 1)) < 1e-9, 'pull-on legs stay hip-wide at the waist');
  // The seams curve in above the hip line and meet the legs there as before.
  for (const front of [true, false]) {
    const hipY = (front ? 0 : d.backRaise) + d.hipDepth;
    assert.ok(Math.abs(d.sideAt(front, hipY)) < 1e-9 && Math.abs(d.centreAt(front, hipY) - (front ? d.frontHip : d.backHip)) < 1e-9);
  }
  // Each front leg has the fly's facing cut on past its centre front, from the waist to just below the zip.
  const front = patternPieces(jeans).find(piece => piece.part === 'front')!.outline;
  const facing = front.filter(p => p.y < d.flyLength - 2 && p.x > d.centreAt(true, p.y) + FLY_EXTENSION_CM - 0.01);
  assert.ok(facing.length >= 4, JSON.stringify(facing));
  assert.ok(!patternPieces(trousers).find(piece => piece.part === 'front')!.outline.some(p => p.x > trouserDimensions(trousers).frontHip + trouserDimensions(trousers).frontCrotch + 0.01));
  assert.ok(d.flyLength >= 9 && d.flyLength <= 19 && d.flyLength < d.hipDepth, `${d.flyLength}`);
  // The belt loops are cut as one strip, folded in three.
  const strip = patternPieces(jeans).find(piece => piece.part === 'beltLoop')!;
  assert.equal(strip.cutCount, 1);
  assert.ok(Math.abs(strip.width - 3.6) < 1e-9 && strip.height > 5 * d.waistbandHeight, `${strip.width} × ${strip.height}`);
  // A fly changes nothing about pull-on trousers' rise.
  assert.ok(Math.abs(trouserRise(trousers, true) - trouserRise(withOptions(trousers, { ...optionsOf(trousers), fly: true }), true)) < 1.5);
});

test('in 3D the waist is fitted, and five belt loops lie on the waistband through the drape', () => {
  const meshes = teeMesh(jeans, Delaunator), plainMeshes = teeMesh(trousers, Delaunator), d = trouserDimensions(jeans);
  const waist = (parts: PartMesh[]) => { const band = points(parts.find(part => part.part === 'waistband')!); return ringLength(band.filter((_, i) => i % 2 === 0)); };
  // The waistband's bottom edge, where the legs are sewn on: the fitted waist against the pull-on trousers' hips.
  assert.ok(Math.abs(waist(meshes) - (d.waist + 1)) < 2, `${waist(meshes)} around a ${d.waist} cm waist`);
  assert.ok(waist(plainMeshes) > trouserDimensions(trousers).hip, `${waist(plainMeshes)}`);
  const loops = points(meshes.find(part => part.part === 'beltLoop')!), band = points(meshes.find(part => part.part === 'waistband')!);
  assert.equal(loops.length, 5 * 12);
  const centres = Array.from({ length: 5 }, (_, k) => { const own = loops.slice(k * 12, k * 12 + 12); return [0, 1, 2].map(axis => own.reduce((sum, p) => sum + p[axis]!, 0) / 12); });
  assert.equal(centres.filter(c => c[2]! > 0).length, 2, 'two at the front');
  assert.equal(centres.filter(c => c[2]! < 0).length, 3, 'three at the back');
  assert.ok(centres.some(c => Math.abs(c[0]!) < 1e-6 && c[2]! < 0), 'one at the centre back');
  const gap = (p: readonly number[]) => Math.min(...band.map(q => Math.hypot(q[0] - p[0]!, q[1] - p[1]!, q[2] - p[2]!)));
  assert.ok(loops.every(p => gap(p) < 2), 'on the waistband');
  // Draped on a body 2 cm smaller at the waist than the buttoned waistband, they stay on the waistband.
  assert.equal(trouserBodyProxy(jeans).waist, d.waist - 2);
  assert.throws(() => trouserBodyProxy(jeans, { waist: d.waist }), /at least 1 cm smaller than the trousers' 76 cm buttoned waist/);
  const result = simulateGarment(jeans, meshes, 96, { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.3, `strain ${result.metrics.maxStrain}`);
  const draped = (part: string) => { const flat = result.parts.find(item => item.part === part)!.positions; return Array.from({ length: flat.length / 3 }, (_, v) => [flat[v * 3]!, flat[v * 3 + 1]!, flat[v * 3 + 2]!] as const); };
  const bandAfter = draped('waistband');
  for (const p of draped('beltLoop')) assert.ok(Math.min(...bandAfter.map(q => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))) < 2, 'a loop point left the waistband');
});

test('the tech pack closes the waist with a zip and a button, sews the fly and the loops, and keeps pull-on trousers elastic', () => {
  const pack = buildTechPack(jeans, '2026-11-18'), d = trouserDimensions(jeans);
  const items = pack.bom.map(row => row.item);
  assert.ok(items.includes('T2 Fly zip') && items.includes('T5 Waistband button') && !items.some(item => item.includes('elastic')), items.join(', '));
  assert.match(pack.bom.find(row => row.item === 'T2 Fly zip')!.quantity, new RegExp(`${d.flyLength}\\.0 cm`));
  const pom = (name: string) => pack.poms.find(row => row.name === name);
  assert.equal(pom('Waist (½), buttoned')!.values[pack.sampleSize], d.waist / 2);
  assert.equal(pom('Fly opening')!.values[pack.sampleSize], d.flyLength);
  assert.ok(pom('Belt loop length') && pom('Belt loop width'));
  assert.ok(['Fly front', 'Belt loops'].every(area => pack.construction.some(row => row.area === area)));
  assert.match(pack.construction.find(row => row.area === 'Waistband')!.operation, /buttonhole/);
  assert.equal(pack.neckline, 'Buttoned waistband, zip fly');
  const pullOn = buildTechPack(trousers, '2026-11-18');
  assert.ok(pullOn.bom.some(row => row.item === 'T2 Waistband elastic') && pullOn.poms.some(row => row.name === 'Waist (½), relaxed'));
  assert.ok(!pullOn.construction.some(row => row.area === 'Fly front'));
});

test('descriptions add a fly and belt loops, colour the loops, and take them off for an elasticated waist', () => {
  assert.ok(optionsOf(readDesignPrompt('zip fly', trousers).product).fly);
  const looped = readDesignPrompt('belt loops', shorts).product;
  assert.ok(optionsOf(looped).fly && optionsOf(looped).beltLoops, 'loops bring the fly they need');
  const elastic = readDesignPrompt('elasticated waist', jeans).product;
  assert.equal(optionsOf(elastic).fly, undefined);
  assert.equal(optionsOf(elastic).beltLoops, undefined);
  const unlooped = readDesignPrompt('no belt loops', jeans).product;
  assert.ok(optionsOf(unlooped).fly && !optionsOf(unlooped).beltLoops);
  const described = readDesignPrompt('jeans', trousers).product;
  assert.ok(optionsOf(described).fly && optionsOf(described).beltLoops);
  assert.equal(readDesignPrompt('red belt loops', jeans).product.parts.beltLoop!.color, readDesignPrompt('red waistband', jeans).product.parts.waistband!.color);
  // A zip fly is not a sweatshirt's front zip.
  assert.throws(() => readDesignPrompt('zip fly', template('crew-sweat')), /fly front and belt loops \(they go on trousers or shorts, not a crew sweatshirt\)/);
});

test('every size keeps the fly and its fitted waist', () => {
  for (const size of ['XS', 'XL'] as const) {
    const graded = gradedProduct(jeans, size), d = trouserDimensions(graded);
    assert.ok(optionsOf(graded).fly && optionsOf(graded).beltLoops);
    assert.equal(d.waistbandLength, d.waist + FLY_EXTENSION_CM);
    assert.ok(d.centreAt(true, 0) - d.sideAt(true, 0) < d.frontHip - 1, size);
  }
});
