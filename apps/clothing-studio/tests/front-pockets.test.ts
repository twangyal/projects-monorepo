import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import {
  FRONT_POCKET_FACING_CM, frontPocketOf, optionsOf, partsOf, patternPieces, teeMesh, template, trouserDimensions, validateProduct, withOptions, type PartMesh, type Product,
} from '../src/product.ts';

const jeans = template('jeans') as Product, trousers = template('trousers') as Product, shorts = template('shorts') as Product;
const points = (mesh: PartMesh) => Array.from({ length: mesh.positions.length / 3 }, (_, v) => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!]);
// How far a point is from a surface: the nearest point of any of its triangles.
function toSurface(point: number[], positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  const at = (i: number) => [positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!];
  const sub = (a: number[], b: number[]) => a.map((value, k) => value - b[k]!), dot = (a: number[], b: number[]) => a.reduce((sum, value, k) => sum + value * b[k]!, 0);
  let best = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const a = at(indices[t]!), b = at(indices[t + 1]!), c = at(indices[t + 2]!), ab = sub(b, a), ac = sub(c, a), ap = sub(point, a);
    const d00 = dot(ab, ab), d01 = dot(ab, ac), d11 = dot(ac, ac), d20 = dot(ap, ab), d21 = dot(ap, ac), det = d00 * d11 - d01 * d01;
    if (det < 1e-12) continue;
    const v = (d11 * d20 - d01 * d21) / det, w = (d00 * d21 - d01 * d20) / det;
    if (v >= 0 && w >= 0 && v + w <= 1) best = Math.min(best, Math.hypot(...sub(ap, ab.map((x, k) => x * v + ac[k]! * w))));
    // Otherwise the nearest point of its edges.
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const pq = sub(q, p), f = Math.max(0, Math.min(1, dot(sub(point, p), pq) / (dot(pq, pq) || 1)));
      best = Math.min(best, Math.hypot(...sub(point, p.map((x, k) => x + pq[k]! * f))));
    }
  }
  return best;
}
const area = (product: Product, part: string) => patternPieces(product).filter(piece => piece.part === part).reduce((sum, piece) => sum + piece.areaCm2, 0);

test('trousers and shorts can have front scoop pockets, their facings styled on their own; other garments cannot', () => {
  assert.ok(partsOf(jeans).includes('frontPocket'));
  const added = withOptions(shorts, { ...optionsOf(shorts), frontPockets: true });
  assert.deepEqual(added.parts.frontPocket, shorts.parts.front, 'the facings start in the front legs’ style');
  assert.equal(withOptions(jeans, { ...optionsOf(jeans), frontPockets: false }).parts.frontPocket, undefined);
  assert.throws(() => withOptions(template('blank'), { ...optionsOf(template('blank')), frontPockets: true }), /Front pockets go on trousers or shorts/);
  assert.throws(() => validateProduct({ ...template('flared-skirt'), options: { hem: 'straight', chestPocket: false, frontPockets: true } }), /Front pockets go on trousers or shorts/);
  // Sized from the hips and rise: about a tenth of the hip across the waist, a quarter of the rise down the side seam.
  assert.deepEqual(frontPocketOf(jeans), { opening: 10, depth: 7 });
});

test('the front pattern is cut away along the pocket’s curve, and the facing is cut from that corner, deeper', () => {
  const { opening, depth } = frontPocketOf(jeans), plain = withOptions(jeans, { ...optionsOf(jeans), frontPockets: false });
  // The front loses a quarter ellipse at its side waist corner; the facing is one 3 cm larger each way.
  const scoop = Math.PI / 4 * opening * depth, facing = Math.PI / 4 * (opening + FRONT_POCKET_FACING_CM) * (depth + FRONT_POCKET_FACING_CM);
  assert.ok(Math.abs(area(plain, 'front') - area(jeans, 'front') - scoop) < 3, `${area(plain, 'front') - area(jeans, 'front')} against ${scoop}`);
  assert.ok(Math.abs(area(jeans, 'frontPocket') - facing) < 4, `${area(jeans, 'frontPocket')} against ${facing}`);
  const front = patternPieces(jeans).find(piece => piece.part === 'front')!, piece = patternPieces(jeans).find(piece => piece.part === 'frontPocket')!;
  assert.equal(piece.cutCount, 2);
  // The front's waist starts at the pocket's opening, not at the side seam (in from the hips, as the fly fits the waist).
  const side = trouserDimensions(jeans).sideAt(true, 0);
  assert.ok(side > 0.5 && Math.abs(front.outline[0]!.x - (side + opening)) < 1e-9 && front.outline[0]!.y === 0);
  assert.ok(!front.outline.some(p => p.y < 0.01 && p.x < side + opening - 1e-9), 'no waist left beside the side seam');
});

test('in 3D each facing lies on its front leg at the side of the waist, and rides on it through the drape', () => {
  const mesh = teeMesh(jeans, Delaunator), facings = points(mesh.find(part => part.part === 'frontPocket')!), legs = points(mesh.find(part => part.part === 'front')!);
  const top = trouserDimensions(jeans).length, { depth } = frontPocketOf(jeans);
  assert.ok(facings.every(p => p[2]! > -0.1), 'on the front, reaching round to the side seam');
  assert.ok(Math.max(...facings.map(p => p[1]!)) <= top + 0.5 && Math.min(...facings.map(p => p[1]!)) >= top - depth - 0.5, 'within the pocket’s depth below the waist');
  assert.ok(Math.abs(Math.max(...facings.map(p => p[0]!)) + Math.min(...facings.map(p => p[0]!))) < 1e-6, 'one on each leg, mirrored');
  const gap = (p: number[]) => Math.min(...legs.map(q => Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!)));
  // Within the front mesh's vertex spacing of it, as the back pockets are of the back legs.
  assert.ok(facings.every(p => gap(p) < 2), 'just proud of the front leg');
  // The cloth is the same as without the pockets: the facings are carried, not simulated.
  const result = simulateGarment(jeans, mesh, 96, { frames: 60 });
  const draped = result.parts.find(part => part.part === 'frontPocket')!.positions, front = result.parts.find(part => part.part === 'front')!.positions;
  const indices = mesh.find(part => part.part === 'front')!.indices;
  for (let v = 0; v < draped.length / 3; v += 9) {
    const at = [draped[v * 3]!, draped[v * 3 + 1]!, draped[v * 3 + 2]!];
    assert.ok(at[2]! > 0 && toSurface(at, front, indices) < 0.5, `facing point ${v} is ${toSurface(at, front, indices)} cm from the draped front leg`);
  }
});

test('the tech pack measures and sews the pockets, with pocketing for the bags, and descriptions add, style and remove them', () => {
  const pack = buildTechPack(jeans, '2026-11-18');
  assert.ok(pack.poms.some(row => row.name === 'Front pocket opening') && pack.poms.some(row => row.name === 'Front pocket depth'));
  assert.ok(pack.construction.some(row => row.area === 'Front pockets' && /understitch/.test(row.operation)));
  assert.match(pack.bom.find(row => row.item === 'P1 Pocketing')!.quantity, /^4 pcs, 16\.0 cm × 25\.0 cm each/);
  assert.ok(!buildTechPack(trousers, '2026-11-18').bom.some(row => row.item === 'P1 Pocketing'));
  // Named, they are added to trousers without bringing back pockets; "jeans" brings both.
  const fronted = readDesignPrompt('front pockets', trousers).product;
  assert.ok(optionsOf(fronted).frontPockets && !optionsOf(fronted).backPockets);
  assert.ok(optionsOf(readDesignPrompt('scoop pockets', shorts).product).frontPockets);
  const described = readDesignPrompt('jeans', trousers).product;
  assert.ok(optionsOf(described).frontPockets && optionsOf(described).backPockets && optionsOf(described).yoke);
  const red = readDesignPrompt('red front pockets', jeans).product;
  assert.equal(red.parts.frontPocket!.color, readDesignPrompt('red back pockets', jeans).product.parts.backPocket!.color);
  assert.equal(red.parts.front.color, jeans.parts.front.color, 'only the facings');
  const removed = readDesignPrompt('no front pockets', jeans).product;
  assert.ok(!optionsOf(removed).frontPockets && optionsOf(removed).backPockets);
  const bare = readDesignPrompt('no pockets', jeans).product;
  assert.ok(!optionsOf(bare).frontPockets && !optionsOf(bare).backPockets);
  // On a top, a front pocket is its chest pocket.
  assert.ok(optionsOf(readDesignPrompt('a front pocket', template('blank')).product).chestPocket);
});
