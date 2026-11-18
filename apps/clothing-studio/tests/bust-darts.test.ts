import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { pngUrl } from './helpers/raster.ts';
import { artworkMarks, placementOnPattern } from '../src/artwork-pattern.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { designDifferences } from '../src/design-diff.ts';
import { clothFromMeshes, simulateGarment } from '../src/garment-drape.ts';
import { createProject } from '../src/model.ts';
import { patternDxf, patternSvg } from '../src/pattern-export.ts';
import {
  artworkDefaults, bustDartOf, dartFlat, dartUnflat, material, optionsOf, patternPieces, placketOf, teeDimensions, teeMesh, template, topMeasurements,
  validateProduct, withOptions, type Artwork, type Product,
} from '../src/product.ts';
import { buildTechPack } from '../src/techpack.ts';

type Pt = { x: number; y: number };
const darted = (product: Product, intake = 2.5) => validateProduct({ ...product, measurements: { ...topMeasurements(product), bustDart: intake } } as Product);
const piece = (product: Product, part = 'front') => patternPieces(product).find(item => item.part === part)!;
const near = (actual: number, expected: number, why: string, within = 1e-6) => assert.ok(Math.abs(actual - expected) <= within, `${why}: ${actual} vs ${expected}`);

test('bust darts go on T-shirt bases within their range, below a neckline that leaves room for them', () => {
  const tee = template('blank') as Product;
  assert.equal(topMeasurements(darted(tee)).bustDart, 2.5);
  assert.throws(() => darted(template('crew-sweat') as Product), /Bust darts go on T-shirts, shirts, coats and tee dresses/);
  assert.throws(() => darted(tee, 0.5), /Bust dart intake/);
  assert.throws(() => darted(tee, 6), /Bust dart intake/);
  // A plunging V-neck reaching down to the darts' points leaves no room for them.
  const tank = template('tank-top') as Product, plunging = validateProduct({ ...tank, neckline: 'v', fit: { ...tank.fit, armholeDepth: 18, frontNeckDrop: 18 } } as Product);
  assert.throws(() => darted(plunging), /Bust darts point to just below the front neckline/);
});

test('a darted front is cut longer below its darts, and each side seam opens by the intake where its dart is', () => {
  const tee = template('blank') as Product, product = darted(tee), dart = bustDartOf(product)!, d = teeDimensions(product);
  const plain = piece(tee), front = piece(product), back = piece(product, 'back');
  // The dart starts 4 cm below the underarm and ends 2.5 cm short of the bust point, above the underarm line.
  near(dart.side.y, d.shoulderDrop + d.armDepth + 4, 'dart level at the side seam');
  near(Math.hypot(dart.apex.x - dart.bust.x, dart.apex.y - dart.bust.y), 2.5, 'apex short of the bust point');
  assert.ok(dart.bust.y < d.shoulderDrop + d.armDepth);
  // Two darts, mirrored about the centre line, each from the side seam to its point and back down by the intake.
  assert.equal(front.darts?.length, 2);
  const centre = front.width / 2;
  for (const [upper, apex, lower] of front.darts!) {
    near(lower.x, upper.x, 'legs end on the same side seam');
    near(lower.y - upper.y, 2.5, 'the side seam opens by the intake');
    near(Math.abs(apex.x - centre), dart.apex.x, 'apex out from the centre');
    near(Math.abs(upper.x - centre), dart.side.x, 'leg ends on the side seam');
  }
  // The piece is that much longer at the centre front and at the sides, and no wider: once the darts are sewn its side
  // seams are the back's length again.
  near(front.height - plain.height, 2.5, 'front lengthened by the intake');
  const above = (outline: Pt[]) => outline.filter(p => p.y < dart.apex.y - 1).map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)}`).sort();
  assert.deepEqual(above(front.outline), above(plain.outline), 'nothing above the darts moves');
  near(front.width, plain.width, 'width');
  near(back.height, plain.height, 'the back is unchanged');
  // The fabric between the legs stays on the piece, folded away when the dart is sewn.
  assert.ok(front.areaCm2 > plain.areaCm2 + 2.5 * plain.width * 0.9);
  // Exports draw the darts' legs.
  assert.equal((patternSvg(product).match(/data-dart="front"/g) ?? []).length, 2);
  assert.match(patternDxf(product), /\nDART\n/);
});

test('a front is lowered smoothly below its darts and opens only along them, and the mapping can be undone', () => {
  const dart = bustDartOf(darted(template('blank') as Product))!, flat = dartFlat(dart), unflat = dartUnflat(dart);
  // Above the darts nothing moves; well below them everything is lower by the intake.
  assert.deepEqual(flat({ x: 3, y: 10 }), { x: 3, y: 10 });
  near(flat({ x: 0, y: 60 }).y, 62.5, 'well below at the centre');
  near(flat({ x: 20, y: 60 }).y, 62.5, 'well below at the side');
  // Just under the line between the apexes nothing opens; just under a dart's leg it opens by the leg's share.
  near(flat({ x: 0, y: dart.apex.y + 1e-6 }).y, dart.apex.y, 'centre just below the line', 1e-5);
  const half = { x: (dart.apex.x + dart.side.x) / 2, y: (dart.apex.y + dart.side.y) / 2 + 1e-6 };
  near(flat(half).y - half.y, 1.25, 'halfway along the leg', 1e-4);
  for (const p of [{ x: 0, y: 20 }, { x: 5, y: dart.apex.y + 3 }, { x: 18, y: 45 }, { x: -22, y: 70 }]) {
    const back = unflat(flat(p));
    near(back.x, p.x, 'x round trip'); near(back.y, p.y, 'y round trip', 1e-6);
  }
});

test('the drape sews each dart: its legs meet in 3D, and the extra length lets the front hang level over a bust', () => {
  const tee = template('blank') as Product, product = darted(tee), dart = bustDartOf(product)!;
  const meshes = teeMesh(product, Delaunator), front = meshes.find(mesh => mesh.part === 'front')!;
  // Vertices sharing a place in 3D but cut apart on the piece lie along the darts' legs.
  const byPlace = new Map<string, number[]>();
  for (let v = 0; v < front.positions.length / 3; v++) {
    const key = [0, 1, 2].map(axis => Math.round(front.positions[v * 3 + axis]! * 1000)).join(',');
    byPlace.set(key, [...(byPlace.get(key) ?? []), v]);
  }
  const opened = [...byPlace.values()].filter(group => new Set(group.map(v => front.uvs[v * 2 + 1]!.toFixed(4))).size > 1);
  assert.ok(opened.length >= 10, `${opened.length} dart points`);
  for (const group of opened) {
    const x = Math.abs(front.positions[group[0]! * 3]!), ys = group.map(v => front.uvs[v * 2 + 1]!);
    assert.ok(x > dart.apex.x - 1e-6 && x <= dart.side.x + 1e-6, `opened at ${x}`);
    near(Math.max(...ys) - Math.min(...ys), 2.5 * (x - dart.apex.x) / (dart.side.x - dart.apex.x), 'the leg’s share of the intake', 1e-6);
  }
  // The cloth joins each such pair into one particle.
  const cloth = clothFromMeshes(meshes, part => material(product.parts[part].material));
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  assert.ok(cloth.inverseMass.length < vertices);
  // On a body with a bust a plain front's centre rides up; the darted one hangs level and lower by most of the intake.
  const hemCentre = (top: Product) => {
    const parts = teeMesh(top, Delaunator), mesh = parts.find(item => item.part === 'front')!;
    const result = simulateGarment(top, parts, 92, { bodyShape: { underbust: 74 } }), draped = result.parts.find(item => item.part === 'front')!;
    let low = Infinity;
    for (let v = 0; v < mesh.positions.length / 3; v++) if (Math.abs(mesh.positions[v * 3]!) < 3 && mesh.positions[v * 3 + 1]! < 1) low = Math.min(low, draped.positions[v * 3 + 1]!);
    return { low, strain: result.metrics.maxStrain };
  };
  const without = hemCentre(tee), withDarts = hemCentre(product);
  assert.ok(without.low - withDarts.low > 1, `centre front hem ${without.low.toFixed(2)} → ${withDarts.low.toFixed(2)} cm`);
  assert.ok(withDarts.strain < 0.5, `stretch ${withDarts.strain}`);
});

test('button fronts, plackets, lapels and dresses cut at the waist take their darts', () => {
  const shirt = template('shirt') as Product, product = darted(shirt);
  // Each half of a button front has its own dart, and the placket is as long as the lengthened front edge.
  assert.equal(piece(product).darts?.length, 1);
  near(placketOf(product).length - placketOf(shirt).length, 2.5, 'placket lengthened');
  const coat = darted(template('blazer') as Product), facing = piece(coat, 'lapel'), plainFacing = piece(template('blazer') as Product, 'lapel');
  near(facing.height - plainFacing.height, 2.5, 'lapel facing lengthened with the front edge');
  // A dress cut at the waist: its bodice front is darted; its skirt is cut as before.
  const dress = template('fit-flare') as Product, seamed = darted(dress);
  assert.equal(piece(seamed).darts?.length, 2);
  near(piece(seamed).height - piece(dress).height, 2.5, 'bodice lengthened');
  assert.deepEqual(piece(seamed, 'skirtFront').outline, piece(dress, 'skirtFront').outline);
  assert.equal(optionsOf(seamed).waistSeam, true);
});

test('the tech pack sews the darts before the side seams, and descriptions and version compare name them', () => {
  const product = darted(template('shirt') as Product), pack = buildTechPack(product, '2026-11-18');
  const sewn = pack.construction.findIndex(row => row.area === 'Bust darts');
  assert.ok(sewn >= 0 && sewn < pack.construction.findIndex(row => row.area === 'Side seams'));
  assert.match(pack.construction[sewn]!.detail, /2\.5 cm taken in at each side seam/);
  assert.ok(pack.poms.some(pom => pom.code === 'BD' && pom.name === 'Bust dart intake'));
  const described = readDesignPrompt('a fitted white shirt with bust darts', template('shirt') as Product);
  assert.equal(topMeasurements(described.product).bustDart, 2.5);
  const understood = described.scopes.flatMap(scope => scope.understood);
  assert.ok(understood.some(line => /bust darts: 2\.5 cm/.test(line)), understood.join(' | '));
  assert.equal(topMeasurements(readDesignPrompt('no darts', product).product).bustDart, undefined);
  assert.ok(readDesignPrompt('a sweatshirt with darts', template('crew-sweat') as Product).ignored.some(line => /^darts \(bust darts go on T-shirts/.test(line)));
  const project = (top: Product) => ({ ...createProject(), title: 'Shirt', product: top });
  const lines = designDifferences(project(template('shirt') as Product), project(product));
  assert.ok(lines.includes('Bust dart intake: none → 2.5 cm'), lines.join(' | '));
  // Taking the option off the shirt keeps the darts; they belong to the front, not to the button front.
  assert.equal(topMeasurements(validateProduct(withOptions(product, { ...optionsOf(product), collar: false }))).bustDart, 2.5);
});

test('a print below the darts is marked lower on the cut front, and one across a dart has its outline only', () => {
  const tee = template('blank') as Product, product = darted(tee);
  const print = (yCm: number): Artwork => ({ part: 'front', dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(product, 'front'), xCm: 0, yCm, widthCm: 10 });
  const low = { ...product, artwork: [print(40)] } as Product, plainLow = { ...tee, artwork: [print(40)] } as Product;
  const [mark] = artworkMarks(low), [plainMark] = artworkMarks(plainLow);
  near(mark!.image!.centre.y - plainMark!.image!.centre.y, 2.5, 'image lowered by the intake');
  near(Math.min(...mark!.lines.flat().map(p => p.y)) - Math.min(...plainMark!.lines.flat().map(p => p.y)), 2.5, 'outline lowered', 1e-6);
  // Dropped where its image is, the print stays where it was.
  assert.deepEqual(placementOnPattern(low, 0, mark!.image!.centre), { xCm: 0, yCm: 40 });
  // A wide print across a dart's leg is broken there and has no image to drag.
  const across = { ...product, artwork: [{ ...print(14), widthCm: 46 }] } as Product, [wide] = artworkMarks(across);
  assert.equal(wide!.image, undefined);
  assert.ok(wide!.lines.length >= 2, `${wide!.lines.length} lines`);
});
