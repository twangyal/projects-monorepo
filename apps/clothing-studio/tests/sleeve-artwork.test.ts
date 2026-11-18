import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { pngUrl } from './helpers/raster.ts';
import { placementFromSurface } from '../src/artwork-placement.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { costRow, currentColorway } from '../src/range.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';
import { readSlogan, textArtwork } from '../src/text-artwork.ts';
import {
  SIZES, artworkDefaults, keepArtworkInside, sleeveArtworkFrame, sleeveArtworkProblem, sleeveArtworkUv, teeMesh, template, validateProduct, withSleeveLength,
  type Artwork, type PartMesh, type Product,
} from '../src/product.ts';

const tee = template('blank') as Product, hoodie = template('hoodie') as Product, shirt = template('shirt') as Product, shorts = template('shorts') as Product;
// A print twice as wide as it is tall, where new artwork goes there unless placed otherwise.
const art = (product: Product, part: Artwork['part'], placed: Partial<Artwork> = {}): Artwork =>
  ({ part, dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(product, part, { width: 100, height: 50 }), ...placed });
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The triangles of a sleeve wholly under its artwork, each with its outward normal (sleeves are wound outward) and the
 * 3D directions of the image's right and up there.
 */
function printed(product: Product, placed: Artwork) {
  const mesh = teeMesh(product, Delaunator).find(part => part.part === placed.part) as PartMesh, toArt = sleeveArtworkUv(sleeveArtworkFrame(product), placed);
  const at = (v: number): V3 => [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!, mesh.positions[v * 3 + 2]!], uv = (v: number) => toArt(mesh.uvs[v * 2]!, mesh.uvs[v * 2 + 1]!);
  const found = [];
  for (let f = 0; f < mesh.indices.length; f += 3) {
    const [a, b, c] = [mesh.indices[f]!, mesh.indices[f + 1]!, mesh.indices[f + 2]!];
    if (![a, b, c].every(v => uv(v).every(value => value >= 0 && value <= 1))) continue;
    // Solve [b - a, c - a] = [right, up] · [uv(b) - uv(a), uv(c) - uv(a)].
    const e1 = sub(at(b), at(a)), e2 = sub(at(c), at(a)), [u1, v1] = [uv(b)[0] - uv(a)[0], uv(b)[1] - uv(a)[1]], [u2, v2] = [uv(c)[0] - uv(a)[0], uv(c)[1] - uv(a)[1]];
    const det = u1 * v2 - u2 * v1;
    const right: V3 = [0, 1, 2].map(i => (e1[i]! * v2 - e2[i]! * v1) / det) as V3, up: V3 = [0, 1, 2].map(i => (e2[i]! * u1 - e1[i]! * u2) / det) as V3;
    found.push({ normal: cross(e1, e2), right, up, centre: [0, 1, 2].map(i => (at(a)[i]! + at(b)[i]! + at(c)[i]!) / 3) as V3 });
  }
  return found;
}

test('a top takes artwork on either sleeve, on its upper arm, clear of the seams; bottoms and sleeveless tops do not', () => {
  for (const product of [tee, hoodie, shirt]) for (const side of ['sleeveLeft', 'sleeveRight'] as const) {
    const placed = art(product, side);
    assert.deepEqual({ xCm: placed.xCm, widthCm: placed.widthCm }, { xCm: 0, widthCm: 8 }, `${product.name} ${side}`);
    assert.ok(placed.yCm >= 5 && placed.yCm < 9, `${product.name} ${side}: top ${placed.yCm} cm below the shoulder point`);
    assert.deepEqual(validateProduct({ ...product, artwork: [placed] }).artwork[0], placed);
  }
  // One on each of the front, the back and both sleeves; never two on one sleeve.
  const all = ['front', 'back', 'sleeveLeft', 'sleeveRight'] as const;
  assert.equal(validateProduct({ ...tee, artwork: all.map(side => art(tee, side)) }).artwork.length, 4);
  assert.throws(() => validateProduct({ ...tee, artwork: [art(tee, 'sleeveLeft'), art(tee, 'sleeveLeft', { yCm: 9 })] }), /at most one artwork on each side and sleeve/);
  // It is printed before the sleeve is sewn, so all of it lies on the sleeve piece, and the message says where it fits.
  const frame = sleeveArtworkFrame(tee);
  assert.ok(frame.outline.length > 4 && frame.centre > 10 && frame.length >= 15, JSON.stringify(frame));
  assert.match(sleeveArtworkProblem(tee, art(tee, 'sleeveLeft', { yCm: 0 }))!, /^Artwork on the left sleeve must lie within the sleeve, clear of its seams: as wide and as far across as this, its top can be from \d+(\.\d)? cm to \d+(\.\d)? cm below the shoulder point\.$/);
  assert.match(sleeveArtworkProblem(tee, art(tee, 'sleeveRight', { widthCm: 40 }))!, /40 cm wide, it does not fit\. Make it smaller\.$/);
  assert.match(sleeveArtworkProblem(tee, art(tee, 'sleeveRight', { xCm: 14 }))!, /from the centre line|its top can be/);
  assert.throws(() => validateProduct({ ...tee, artwork: [art(tee, 'sleeveLeft', { xCm: 30 })] }), /must lie within the sleeve/);
  assert.throws(() => validateProduct({ ...shorts, artwork: [{ ...art(tee, 'sleeveLeft') }] }), /front or back of pull-on shorts, which have no sleeves/);
  const tank = template('tank-top') as Product;
  assert.throws(() => validateProduct({ ...tank, artwork: [art(tee, 'sleeveRight')] }), /A sleeveless top has no right sleeve for artwork/);
});

test('sleeve artwork wraps round the arm and reads the right way round from outside on both sleeves', () => {
  for (const side of ['sleeveLeft', 'sleeveRight'] as const) {
    // A print 20 cm wide on a hoodie's upper arm reaches round its front and back as well as its top.
    const wide = art(hoodie, side, { widthCm: 20, yCm: 16 });
    assert.equal(sleeveArtworkProblem(hoodie, wide), null);
    const under = printed(hoodie, wide);
    assert.ok(under.length > 20, `${under.length} triangles under the print`);
    for (const { normal, right, up } of under) {
      // Right × up points out of the sleeve: seen from outside, the image is not mirrored.
      assert.ok(dot(cross(right, up), normal) > 0, `${side}: mirrored`);
      // Up runs toward the shoulder, so the image's top faces the body.
      assert.ok(side === 'sleeveLeft' ? up[0] < 0 : up[0] > 0, `${side}: up ${up}`);
    }
    const facing = under.map(({ normal }) => normal[2] / Math.hypot(...normal));
    assert.ok(Math.max(...facing) > 0.4 && Math.min(...facing) < -0.4, `${side}: the print should face forward and backward in places (${Math.min(...facing)} to ${Math.max(...facing)})`);
    // Placed right of the centre line, as seen from outside, it lies toward the back of the left arm and the front of
    // the right.
    const across = printed(hoodie, art(hoodie, side, { xCm: 6, yCm: 16 }));
    const z = across.reduce((sum, item) => sum + item.centre[2], 0) / across.length;
    assert.ok(side === 'sleeveLeft' ? z < -1 : z > 1, `${side}: centre z ${z}`);
  }
});

test('a point picked on a sleeve places artwork from its centre line and shoulder point', () => {
  const frame = sleeveArtworkFrame(tee), placed = art(tee, 'sleeveLeft');
  // 3 cm right of the centre line on the left sleeve's piece is right as seen from outside; on the right sleeve, mirrored, left.
  assert.deepEqual(placementFromSurface(tee, placed, { part: 'sleeveLeft', x: frame.centre + 3, y: 12 }, 8), { xCm: 3, yCm: 10 });
  assert.deepEqual(placementFromSurface(tee, art(tee, 'sleeveRight'), { part: 'sleeveRight', x: frame.centre + 3, y: 12 }, 8), { xCm: -3, yCm: 10 });
  assert.throws(() => placementFromSurface(tee, placed, { part: 'sleeveLeft', x: frame.centre + 3, y: 1 }, 8), /must lie within the sleeve/);
  assert.throws(() => placementFromSurface(tee, placed, { part: 'front', x: 0, y: 12 }, 8), /Choose the visible left sleeve/);
});

test('sleeve artwork stays on the sleeve through sizes and sleeve changes, and goes with the sleeves', () => {
  const long = withSleeveLength(structuredClone(tee), 60);
  // Near the cuff of a long sleeve, across the forearm.
  const low = art(long, 'sleeveLeft', { yCm: 45 });
  const designed = validateProduct({ ...long, artwork: [art(long, 'front'), low] });
  for (const size of SIZES) {
    const graded = gradedProduct(designed, size), sleeve = graded.artwork.find(item => item.part === 'sleeveLeft')!;
    assert.equal(sleeveArtworkProblem(graded, sleeve), null, size);
  }
  // Shortened to a short sleeve, it moves up the sleeve; made sleeveless, it goes, and the front's stays.
  const short = withSleeveLength(structuredClone(designed), 20), moved = short.artwork.find(item => item.part === 'sleeveLeft')!;
  assert.ok(moved.yCm < 45 && sleeveArtworkProblem(short, moved) === null, JSON.stringify({ ...moved, dataUrl: '' }));
  assert.deepEqual(validateProduct(short).artwork.map(item => item.part), ['front', 'sleeveLeft']);
  const tank = withSleeveLength(structuredClone(designed), 0);
  assert.deepEqual(validateProduct(tank).artwork.map(item => item.part), ['front']);
  // A sleeve narrowed at its opening under a wide print near the cuff: the print moves up, or shrinks to fit.
  const wide = validateProduct({ ...long, artwork: [art(long, 'sleeveRight', { widthCm: 20, yCm: 30 })] });
  const narrowed = structuredClone(wide);
  narrowed.fit = { ...narrowed.fit, sleeveOpening: 8 };
  keepArtworkInside(narrowed);
  assert.doesNotThrow(() => validateProduct(narrowed));
});

test('the tech pack prints sleeve artwork on the cut sleeve before sewing, and the costing counts it', () => {
  const designed = validateProduct({ ...tee, artwork: [art(tee, 'sleeveRight', { xCm: 2 }), art(tee, 'front'), art(tee, 'sleeveLeft', { xCm: 2, rotation: 90, widthCm: 12 })] });
  const pack = buildTechPack(designed, '2026-11-18');
  const bom = pack.bom.filter(row => row.item.endsWith('Artwork'));
  assert.deepEqual(bom.map(row => row.item), ['A1 Artwork', 'A3 Artwork', 'A4 Artwork'], 'in order of place, numbered by place');
  const left = designed.artwork.find(item => item.part === 'sleeveLeft')!, right = designed.artwork.find(item => item.part === 'sleeveRight')!;
  assert.equal(bom[1]!.placement, `Left sleeve: top ${left.yCm.toFixed(1)} cm below the shoulder point, 2.0 cm toward the back of the sleeve’s centre line, 90° clockwise about its centre`);
  assert.equal(bom[2]!.placement, `Right sleeve: top ${right.yCm.toFixed(1)} cm below the shoulder point, 2.0 cm toward the front of the sleeve’s centre line`);
  const sewn = pack.construction.find(row => row.area === 'Left sleeve artwork')!;
  assert.equal(sewn.operation, 'Screen print or DTG on the cut sleeve, before sewing');
  assert.match(sewn.detail, /^12\.0 cm wide, top .* below the shoulder point, .*, turned 90° clockwise$/);
  assert.equal(pack.construction.find(row => row.area === 'Front artwork')!.operation, 'Screen print or DTG after sewing');
  const costed = { ...designed, costing: { currency: 'USD' as const, retail: 40, make: 6, trims: 1, printPerArtwork: 1.5, fabricPrices: {} } };
  assert.equal(costRow(costed, currentColorway(costed)).print, 4.5);
});

test('descriptions put text on a sleeve, across it or running down it, and say why a garment without sleeves cannot', () => {
  const read = (said: string) => readSlogan(said)?.request;
  assert.deepEqual(read('white tee with "TEAM" on the left sleeve'), { text: 'TEAM', side: 'sleeveLeft', color: null, font: 'sans' });
  assert.deepEqual(read('hoodie with "NORTHWIND" down the right sleeve in white letters'), { text: 'NORTHWIND', side: 'sleeveRight', color: '#f7f7f4', font: 'sans', rotation: 90 });
  assert.equal(read('"7" on the sleeve')?.side, 'sleeveLeft', 'the left sleeve unless the right is named');
  assert.equal(read('"7" on the left chest')?.side, 'front');
  const black = readDesignPrompt('black tee with "Stay Wild" down the left sleeve', tee);
  assert.deepEqual(black.text, { text: 'Stay Wild', side: 'sleeveLeft', color: '#f8f6f0', font: 'sans', rotation: 90 });
  assert.ok(black.scopes.some(scope => scope.label === 'Artwork' && scope.understood[0] === 'text “Stay Wild” on the left sleeve, running down it'));
  // Text running down a sleeve is longer than a mark across it.
  const along = textArtwork(black.text!, { dataUrl: pngUrl(400, 80), width: 400, height: 80 }, black.product);
  assert.equal(along.rotation, 90);
  assert.ok(along.widthCm > 8 && sleeveArtworkProblem(black.product, along) === null, JSON.stringify({ ...along, dataUrl: '' }));
  const navy = readDesignPrompt('navy shorts with "TEAM" on the left sleeve', shorts);
  assert.equal(navy.text, undefined);
  assert.ok(navy.ignored.includes('text “TEAM” on the left sleeve (pull-on shorts have no sleeves)'), navy.ignored.join('; '));
  const tank = readDesignPrompt('tank top with "X" on the right sleeve', tee);
  assert.ok(tank.ignored.includes('text “X” on the right sleeve (a sleeveless top has no sleeves)'), tank.ignored.join('; '));
});
