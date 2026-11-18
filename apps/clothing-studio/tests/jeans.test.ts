import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { buildCloth, simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import {
  backPocketOf, optionsOf, partsOf, patternPieces, teeMesh, template, trouserYoke, validateProduct, withOptions, type PartMesh, type Product,
} from '../src/product.ts';

const jeans = template('jeans') as Product, trousers = template('trousers') as Product, shorts = template('shorts') as Product;
const points = (mesh: PartMesh) => Array.from({ length: mesh.positions.length / 3 }, (_, v) => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!]);

test('trousers and shorts can have a back yoke and back pockets, each styled on its own; other garments cannot', () => {
  assert.ok(partsOf(jeans).includes('yoke') && partsOf(jeans).includes('backPocket'));
  assert.deepEqual(validateProduct(jeans).options, { hem: 'straight', chestPocket: false, yoke: true, backPockets: true, frontPockets: true });
  const added = withOptions(shorts, { ...optionsOf(shorts), yoke: true, backPockets: true });
  assert.deepEqual(added.parts.backPocket, shorts.parts.back);
  assert.deepEqual(added.parts.yoke, shorts.parts.back);
  const plain = withOptions(jeans, { ...optionsOf(jeans), yoke: false, backPockets: false });
  assert.equal(plain.parts.yoke, undefined);
  assert.equal(plain.parts.backPocket, undefined);
  assert.throws(() => withOptions(template('crew-sweat'), { ...optionsOf(template('crew-sweat')), backPockets: true }), /Back pockets go on trousers or shorts/);
  assert.throws(() => withOptions(template('flared-skirt'), { ...optionsOf(template('flared-skirt')), yoke: true }), /A back yoke goes on a shirt or on trousers/);
  assert.throws(() => validateProduct({ ...template('blank'), options: { hem: 'straight', chestPocket: false, backPockets: true } }), /Back pockets go on trousers or shorts/);
});

test('the yoke seam runs deeper at the centre back than at the side seam, and every seam is sewn as without it', () => {
  const yoke = trouserYoke(jeans);
  assert.ok(yoke.back > yoke.side + 3 && yoke.side >= 2 && yoke.side <= 6, JSON.stringify(yoke));
  const mesh = teeMesh(jeans, Delaunator), seam = points(mesh.find(part => part.part === 'yoke')!), top = Math.max(...seam.map(p => p[1]!));
  // The yoke's lowest points near the centre back seam and near the side seam.
  const depth = (near: (x: number) => boolean) => top - Math.min(...seam.filter(p => near(Math.abs(p[0]!))).map(p => p[1]!));
  const widest = Math.max(...seam.map(p => Math.abs(p[0]!)));
  assert.ok(depth(x => x < 1) > depth(x => x > widest - 1) + 2, `${depth(x => x < 1)} against ${depth(x => x > widest - 1)}`);
  // The yoke shares its seam's points with the back legs, and the back legs' side seams stay where the front legs' are:
  // the cloth has as many particles as plain trousers'.
  const withoutPockets = withOptions(jeans, { ...optionsOf(jeans), backPockets: false });
  assert.equal(buildCloth(withoutPockets, teeMesh(withoutPockets, Delaunator)).inverseMass.length, buildCloth(trousers, teeMesh(trousers, Delaunator)).inverseMass.length);
  // The pattern's yoke and back legs are the plain back leg cut in two.
  const area = (product: Product, part: string) => patternPieces(product).filter(piece => piece.part === part).reduce((sum, piece) => sum + piece.areaCm2, 0);
  assert.ok(Math.abs(area(jeans, 'yoke') + area(jeans, 'back') - area(trousers, 'back')) < 0.5, `${area(jeans, 'yoke') + area(jeans, 'back')} against ${area(trousers, 'back')}`);
  assert.equal(patternPieces(jeans).find(piece => piece.part === 'yoke')!.cutCount, 2);
});

test('each back pocket lies on its back leg, below the yoke, and rides on it through the drape', () => {
  const pocket = backPocketOf(jeans), mesh = teeMesh(jeans, Delaunator), pockets = points(mesh.find(part => part.part === 'backPocket')!);
  const back = points(mesh.find(part => part.part === 'back')!), yokeBottom = Math.min(...points(mesh.find(part => part.part === 'yoke')!).map(p => p[1]!));
  assert.ok(pockets.every(p => p[2]! < 0), 'on the back');
  assert.ok(Math.max(...pockets.map(p => p[1]!)) < yokeBottom + 4, 'below the yoke');
  // Just proud of the back leg under it, and one on each leg, mirrored.
  const gap = (p: number[]) => Math.min(...back.map(q => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!)));
  assert.ok(pockets.every(p => gap(p) < 2.3), 'on the back leg');
  assert.ok(Math.abs(Math.max(...pockets.map(p => p[0]!)) + Math.min(...pockets.map(p => p[0]!))) < 1e-6, 'mirrored');
  const piece = patternPieces(jeans).find(item => item.part === 'backPocket')!;
  assert.equal(piece.cutCount, 2);
  assert.ok(Math.abs(piece.width - pocket.width) < 1e-9 && Math.abs(piece.height - pocket.point - 2.5) < 1e-9);
  const result = simulateGarment(jeans, mesh, 96, { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.3, `strain ${result.metrics.maxStrain}`);
  const draped = result.parts.find(part => part.part === 'backPocket')!.positions, legs = result.parts.find(part => part.part === 'back')!.positions;
  for (let v = 0; v < draped.length / 3; v += 7) {
    let nearest = Infinity;
    for (let w = 0; w < legs.length / 3; w++) nearest = Math.min(nearest, Math.hypot(legs[w * 3]! - draped[v * 3]!, legs[w * 3 + 1]! - draped[v * 3 + 1]!, legs[w * 3 + 2]! - draped[v * 3 + 2]!));
    assert.ok(nearest < 2 && draped[v * 3 + 2]! < 0, `pocket point ${v} is ${nearest} cm from the draped back leg`);
  }
});

test('the tech pack sets the yoke and the pockets, and descriptions add, colour and remove them', () => {
  const pack = buildTechPack(jeans, '2026-11-18');
  assert.ok(pack.construction.some(row => row.area === 'Back yoke') && pack.construction.some(row => row.area === 'Back pockets'));
  assert.ok(pack.poms.some(row => row.name === 'Back pocket width') && pack.poms.some(row => row.name === 'Back yoke at the centre back'), pack.poms.map(row => row.name).join(', '));
  assert.ok(!buildTechPack(trousers, '2026-11-18').construction.some(row => row.area === 'Back pockets'));
  const described = readDesignPrompt('jeans', trousers).product;
  assert.ok(optionsOf(described).yoke && optionsOf(described).backPockets);
  assert.equal(described.parts.back.material, trousers.parts.back.material, 'keeps its styling');
  assert.equal(readDesignPrompt('jeans', template('blank')).product.name, 'Jeans');
  assert.equal(readDesignPrompt('white back pockets', jeans).product.parts.backPocket!.color, '#f7f7f4');
  assert.ok(optionsOf(readDesignPrompt('back pockets', shorts).product).backPockets);
  assert.equal(optionsOf(readDesignPrompt('no back pockets', jeans).product).backPockets, undefined);
  assert.equal(optionsOf(readDesignPrompt('a yoke', trousers).product).yoke, true);
  assert.throws(() => readDesignPrompt('back pockets', template('blank')), /back pockets \(they go on trousers or shorts/);
});
