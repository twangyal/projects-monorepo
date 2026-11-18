import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { pngUrl } from './helpers/raster.ts';
import { artworkMarks } from '../src/artwork-pattern.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { patternSvg } from '../src/pattern-export.ts';
import {
  artworkDefaults, optionsOf, patternPieces, teeMesh, template, topMeasurements, validateProduct, waistDartsAllowed, waistDartsOf, waistShift, withOptions,
  FISHEYE_BELOW_CM, type Artwork, type Product,
} from '../src/product.ts';
import { buildTechPack } from '../src/techpack.ts';

type Pt = { x: number; y: number };
const dress = () => template('tee-dress') as Product;
const darted = (product: Product, extra: Record<string, number> = { waistDart: 2 }) => validateProduct({ ...product, measurements: { ...topMeasurements(product), ...extra } } as Product);
const piece = (product: Product, part: string) => patternPieces(product).find(item => item.part === part)!;
const near = (actual: number, expected: number, why: string, within = 1e-6) => assert.ok(Math.abs(actual - expected) <= within, `${why}: ${actual} vs ${expected}`);
// The outline's widest point at a height, from where its edges cross it.
const widthAt = (outline: Pt[], y: number) => {
  const xs: number[] = [];
  outline.forEach((p, i) => { const q = outline[(i + 1) % outline.length]!; if ((p.y - y) * (q.y - y) <= 0 && p.y !== q.y) xs.push(p.x + (q.x - p.x) * (y - p.y) / (q.y - p.y)); });
  return Math.max(...xs) - Math.min(...xs);
};

test('a top in one piece takes its waist darts through the waist, pointed at both ends, when it reaches below the waist', () => {
  const product = darted(dress()), darts = waistDartsOf(product)!;
  for (const dart of [darts.front, darts.back]) {
    assert.ok(dart.apex < dart.waist && dart.waist < dart.end!, JSON.stringify(dart));
    near(dart.end! - dart.waist, FISHEYE_BELOW_CM, 'lower point below the waist');
    // The shift turns at the points and the waist: none at either point, all the intake at the waist.
    const shift = waistShift(dart);
    near(shift({ x: dart.x + 1, y: dart.apex }), 0, 'upper point'); near(shift({ x: dart.x + 1, y: dart.waist }), 2, 'waist');
    near(shift({ x: dart.x + 1, y: dart.end! }), 0, 'lower point'); near(shift({ x: dart.x - 1, y: dart.waist }), 0, 'between the darts');
    near(shift({ x: -dart.x - 1, y: (dart.waist + dart.end!) / 2 }), -1, 'halfway down, on the other side');
  }
  // A crop top has no room below its waist, and a sweatshirt is shaped by its stretch.
  assert.equal(waistDartsAllowed(template('crop-top') as Product), false);
  assert.throws(() => darted(template('crop-top') as Product), /Waist darts need the top to reach at least 8 cm below its waist/);
  assert.throws(() => darted(template('crew-sweat') as Product), /Waist darts go on T-shirts, shirts, coats and tee dresses/);
  // Cutting the dress at the waist turns them into darts rising from the seam, and back again.
  const seamed = validateProduct(withOptions(product, { ...optionsOf(product), waistSeam: true }));
  assert.equal(waistDartsOf(seamed)!.front.end, undefined);
  assert.ok(waistDartsOf(validateProduct(withOptions(seamed, { ...optionsOf(seamed), waistSeam: false })))!.front.end! > 0);
});

test('the front and back are cut wider at the waist beside each dart, drawn as a V above the waist and one below it', () => {
  const plain = dress(), product = darted(plain), darts = waistDartsOf(product)!;
  for (const part of ['front', 'back'] as const) {
    const cut = piece(product, part), before = piece(plain, part), dart = darts[part];
    assert.equal(cut.darts?.length, 4, part);
    // Let out by both darts' intake at the waist, and unchanged above the upper points and below the lower ones.
    near(widthAt(cut.outline, dart.waist), widthAt(before.outline, dart.waist) + 2 * dart.intake, `${part} at the waist`, 1e-3);
    near(widthAt(cut.outline, dart.end! + 2), widthAt(before.outline, dart.end! + 2), `${part} below the darts`, 1e-3);
    near(widthAt(cut.outline, dart.apex - 1), widthAt(before.outline, dart.apex - 1), `${part} above the darts`, 1e-3);
    near(cut.height, before.height, `${part} height`);
    // Each V opens by the intake at the waist, and its point lies over the leg nearer the centre.
    const points = cut.darts!.map(([outer, point, middle]) => {
      near(Math.abs(outer.x - middle.x), dart.intake, `${part} opening`); near(outer.y, middle.y, `${part} legs meet the waist together`);
      near(point.x, middle.x, `${part} point above or below the middle leg`);
      return point.y;
    }).sort((a, b) => a - b);
    near(points[0]!, dart.apex, `${part} upper point`); near(points.at(-1)!, dart.end!, `${part} lower point`);
  }
  assert.equal((patternSvg(product).match(/data-dart="(?:front|back)"/g) ?? []).length, 8);
});

test('the drape sews each dart from point to point, and the darted dress hangs without overstretching', () => {
  const product = darted(dress()), meshes = teeMesh(product, Delaunator), darts = waistDartsOf(product)!;
  for (const part of ['front', 'back'] as const) {
    const mesh = meshes.find(item => item.part === part)!, byPlace = new Map<string, number[]>();
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const key = [0, 1, 2].map(axis => Math.round(mesh.positions[v * 3 + axis]! * 1000)).join(',');
      byPlace.set(key, [...(byPlace.get(key) ?? []), v]);
    }
    // Points shared by the strips beside and between the darts: those along a dart open on the cut piece, the rest lie
    // together there too.
    const shared = [...byPlace.values()].filter(group => group.length > 1);
    const opened = shared.filter(group => new Set(group.map(v => mesh.uvs[v * 2]!.toFixed(4))).size > 1);
    assert.ok(opened.length >= 10, `${part}: ${opened.length} opened`);
    assert.ok(shared.length > opened.length + 4, `${part}: the lines run on past the points`);
    for (const group of opened) near(Math.abs(Math.abs(mesh.positions[group[0]! * 3]!) - darts[part].x), 0, `${part} legs on the dart`, 1e-6);
  }
  const result = simulateGarment(product, meshes, 92, { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
});

test('the tech pack sews them point to point; descriptions add and remove them; prints beside them follow the cut fabric', () => {
  const product = darted(dress()), pack = buildTechPack(product, '2026-11-18');
  const step = pack.construction.find(row => row.area === 'Waist darts')!;
  assert.match(step.operation, /from its upper point through the waist to its lower point/);
  assert.match(step.detail, /2\.0 cm taken in at the waist by each of four darts pointed at both ends/);
  assert.ok(pack.poms.some(pom => pom.code === 'WD' && /pointed at both ends/.test(pom.howToMeasure)));
  const described = readDesignPrompt('a shift dress with fisheye darts', dress());
  assert.equal(topMeasurements(described.product).waistDart, 2);
  const understood = described.scopes.flatMap(scope => scope.understood);
  assert.ok(understood.some(line => /pointed at both ends through the waist/.test(line)), understood.join(' | '));
  assert.equal(topMeasurements(readDesignPrompt('no waist darts', product).product).waistDart, undefined);
  // A print beside a front dart is carried out with the fabric, with no image to drag; one well below the darts keeps it.
  const print = (yCm: number): Artwork => ({ part: 'front', dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(product, 'front'), xCm: 14, yCm, widthCm: 8 });
  const beside = artworkMarks({ ...product, artwork: [print(28)] } as Product)[0]!, plainBeside = artworkMarks({ ...dress(), artwork: [print(28)] } as Product)[0]!;
  assert.equal(beside.image, undefined);
  assert.ok(Math.max(...beside.lines.flat().map(p => p.x)) > Math.max(...plainBeside.lines.flat().map(p => p.x)) + 0.5);
  const low = waistDartsOf(product)!.front.end! + 4;
  assert.ok(artworkMarks({ ...product, artwork: [print(low)] } as Product)[0]!.image, 'a print below the darts keeps its image');
});
