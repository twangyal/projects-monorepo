import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { pngUrl } from './helpers/raster.ts';
import { artworkMarks } from '../src/artwork-pattern.ts';
import { designDifferences } from '../src/design-diff.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { clothFromMeshes, simulateGarment } from '../src/garment-drape.ts';
import { createProject } from '../src/model.ts';
import { patternSvg } from '../src/pattern-export.ts';
import {
  artworkDefaults, material, optionsOf, patternPieces, teeMesh, template, topMeasurements, validateProduct, waistDartsOf, withOptions,
  type Artwork, type Product,
} from '../src/product.ts';
import { buildTechPack } from '../src/techpack.ts';

type Pt = { x: number; y: number };
const dress = () => template('fit-flare') as Product;
const darted = (product: Product, extra: Record<string, number> = { waistDart: 2 }) => validateProduct({ ...product, measurements: { ...topMeasurements(product), ...extra } } as Product);
const piece = (product: Product, part: string) => patternPieces(product).find(item => item.part === part)!;
const near = (actual: number, expected: number, why: string, within = 1e-6) => assert.ok(Math.abs(actual - expected) <= within, `${why}: ${actual} vs ${expected}`);
const atWaist = (outline: Pt[], y: number) => outline.filter(p => Math.abs(p.y - y) < 1e-6).map(p => p.x);

test('waist darts go in a dress bodice, within their range, and come off with the waist seam', () => {
  const product = darted(dress());
  assert.equal(topMeasurements(product).waistDart, 2);
  assert.throws(() => darted(template('tee-dress') as Product), /Waist darts go in a dress's bodice: add the waist seam first/);
  assert.throws(() => darted(dress(), { waistDart: 5 }), /Waist dart intake/);
  // Taking the waist seam off takes the darts with it.
  const unseamed = validateProduct(withOptions(product, { ...optionsOf(product), waistSeam: false }));
  assert.equal(topMeasurements(unseamed).waistDart, undefined);
});

test('each bodice is cut wider beside its two darts, which open on the waist edge and rise to a point', () => {
  const plain = dress(), product = darted(plain), darts = waistDartsOf(product)!;
  for (const part of ['front', 'back'] as const) {
    const cut = piece(product, part), before = piece(plain, part), dart = darts[part];
    assert.equal(cut.darts?.length, 2, part);
    // The waist edge is cut longer by both darts' intake, and the darts' points are at their height.
    const edge = atWaist(cut.outline, dart.waist), was = atWaist(before.outline, dart.waist);
    near(Math.max(...edge) - Math.min(...edge), Math.max(...was) - Math.min(...was) + 2 * dart.intake, `${part} waist edge`);
    for (const [outer, apex, middle] of cut.darts!) {
      near(Math.abs(outer.x - middle.x), dart.intake, `${part} opening`);
      near(outer.y, dart.waist, `${part} on the waist edge`); near(middle.y, dart.waist, `${part} on the waist edge`);
      near(apex.y, dart.apex, `${part} point`); near(apex.x, middle.x, `${part} point above its middle leg`);
    }
    near(cut.height, before.height, `${part} height`);
  }
  // The front darts end under the bust, the back ones at the underarm line, both at least 5 cm long.
  assert.ok(darts.front.waist - darts.front.apex >= 5 && darts.back.waist - darts.back.apex >= 5);
  assert.equal((patternSvg(product).match(/data-dart="(?:front|back)"/g) ?? []).length, 4);
  // With bust darts too, the front has both kinds, and the waist darts end 2 cm below the bust darts' line.
  const both = darted(plain, { waistDart: 2, bustDart: 2.5 });
  assert.equal(piece(both, 'front').darts?.length, 4);
  assert.ok(waistDartsOf(both)!.front.apex >= waistDartsOf(product)!.front.apex);
});

test('the drape sews the darts: their legs meet in 3D, the skirt still meets the bodice all along the waist, and nothing overstretches', () => {
  const product = darted(dress()), meshes = teeMesh(product, Delaunator), darts = waistDartsOf(product)!;
  for (const part of ['front', 'back'] as const) {
    const mesh = meshes.find(item => item.part === part)!, byPlace = new Map<string, number[]>();
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const key = [0, 1, 2].map(axis => Math.round(mesh.positions[v * 3 + axis]! * 1000)).join(',');
      byPlace.set(key, [...(byPlace.get(key) ?? []), v]);
    }
    const opened = [...byPlace.values()].filter(group => new Set(group.map(v => mesh.uvs[v * 2]!.toFixed(4))).size > 1);
    assert.ok(opened.length >= 10, `${part}: ${opened.length}`);
    for (const group of opened) near(Math.abs(Math.abs(mesh.positions[group[0]! * 3]!) - darts[part].x), 0, `${part} legs on the dart`, 1e-6);
  }
  // Every point of the skirts' waist edge is a point of a bodice's: the waist seam is sewn all along.
  const cloth = clothFromMeshes(meshes, part => material(product.parts[part].material));
  const plainCloth = clothFromMeshes(teeMesh(dress(), Delaunator), part => material(dress().parts[part].material));
  assert.ok(cloth.inverseMass.length > 0 && plainCloth.inverseMass.length > 0);
  const top = (part: 'skirtFront' | 'skirtBack') => {
    const mesh = meshes.find(item => item.part === part)!, ys = Array.from({ length: mesh.positions.length / 3 }, (_, v) => mesh.positions[v * 3 + 1]!);
    const highest = Math.max(...ys);
    return Array.from({ length: ys.length }, (_, v) => v).filter(v => Math.abs(ys[v]! - highest) < 1e-6).map(v => [0, 1, 2].map(axis => Math.round(mesh.positions[v * 3 + axis]! * 1000)).join(','));
  };
  const bodicePoints = new Set(meshes.filter(item => item.part === 'front' || item.part === 'back')
    .flatMap(mesh => Array.from({ length: mesh.positions.length / 3 }, (_, v) => [0, 1, 2].map(axis => Math.round(mesh.positions[v * 3 + axis]! * 1000)).join(','))));
  for (const part of ['skirtFront', 'skirtBack'] as const) for (const key of top(part)) assert.ok(bodicePoints.has(key), `${part} waist point ${key} unsewn`);
  const result = simulateGarment(product, meshes, 92, { bodyShape: { underbust: 74 }, frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.5, `stretch ${result.metrics.maxStrain}`);
});

test('the tech pack sews the waist darts before the waist seam; descriptions and version compare name them; prints beside them follow', () => {
  const product = darted(dress()), pack = buildTechPack(product, '2026-11-18');
  const sewn = pack.construction.findIndex(row => row.area === 'Waist darts');
  assert.ok(sewn >= 0 && sewn < pack.construction.findIndex(row => row.area === 'Waist seam'));
  assert.match(pack.construction[sewn]!.detail, /2\.0 cm taken in by each of four darts/);
  assert.ok(pack.poms.some(pom => pom.code === 'WD'));
  // "Waist darts" cuts a long enough dress at the waist for them; a T-shirt has no bodice.
  const described = readDesignPrompt('a dress with waist darts', template('tee-dress') as Product);
  assert.equal(optionsOf(described.product).waistSeam, true);
  assert.equal(topMeasurements(described.product).waistDart, 2);
  assert.ok(readDesignPrompt('a tee with waist darts', template('blank') as Product).ignored.some(line => /^waist darts \(they go in the bodice/.test(line)));
  assert.equal(topMeasurements(readDesignPrompt('no waist darts', product).product).waistDart, undefined);
  const project = (top: Product) => ({ ...createProject(), title: 'Dress', product: top });
  assert.ok(designDifferences(project(dress()), project(product)).includes('Waist dart intake: none → 2 cm'));
  // A front print low on the bodice, beside a dart, is drawn where the cut fabric carries it, with no image to drag.
  const print: Artwork = { part: 'front', dataUrl: pngUrl(100, 50), width: 100, height: 50, name: 'mark.png', ...artworkDefaults(product, 'front'), xCm: 14, yCm: 26, widthCm: 8 };
  const [mark] = artworkMarks({ ...product, artwork: [print] } as Product), [plainMark] = artworkMarks({ ...dress(), artwork: [print] } as Product);
  assert.equal(mark!.image, undefined);
  assert.ok(Math.max(...mark!.lines.flat().map(p => p.x)) > Math.max(...plainMark!.lines.flat().map(p => p.x)) + 0.5);
});
