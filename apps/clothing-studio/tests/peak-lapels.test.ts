import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { designDifferences } from '../src/design-diff.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { createProject } from '../src/model.ts';
import { simulateGarment } from '../src/garment-drape.ts';
import { buildTechPack } from '../src/techpack.ts';
import {
  LAPEL_CM, PEAK_LAPEL_CM, lapelShape, optionsOf, patternPieces, teeDimensions, teeMesh, template, validateProduct, withOptions, withSleeveLength,
  type Product,
} from '../src/product.ts';

type Pt = { x: number; y: number };

const blazer = template('blazer') as Product, coat = template('coat') as Product;
const peaked = (product: Product) => withOptions(product, { ...optionsOf(product), lapels: true, peakLapels: true });
const peak = peaked(blazer);
// How far a point lies from the line through a and b.
const fromLine = (p: Pt, [a, b]: readonly [Pt, Pt]) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
// Whether no two edges of a closed outline cross.
function simple(outline: Pt[]) {
  const side = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  const n = outline.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1) && crosses(outline[i]!, outline[(i + 1) % n]!, outline[j]!, outline[(j + 1) % n]!)) return false;
  return true;
}

test('a peak lapel’s point rises above where the collar meets it, and reaches further out than a notched one', () => {
  for (const notched of [blazer, withOptions(coat, { ...optionsOf(coat), lapels: true })]) {
    const pointed = peaked(notched), a = lapelShape(notched), b = lapelShape(pointed);
    // The same roll line from the same top button.
    assert.deepEqual(b.roll, a.roll);
    assert.equal(b.breakY, a.breakY);
    // [break, neckline, gorge, point, ...]: a notched lapel's point hangs below its gorge, a peak's rises above it.
    assert.equal(b.lapel.length, 6);
    assert.deepEqual(b.lapel[3], b.point);
    assert.ok(a.point.y > a.lapel[2]!.y + 5, JSON.stringify([a.point, a.lapel[2]]));
    assert.ok(b.point.y < b.lapel[2]!.y, JSON.stringify([b.point, b.lapel[2]]));
    assert.ok(Math.abs(fromLine(a.point, a.roll) - LAPEL_CM) < 1e-9);
    assert.ok(Math.abs(fromLine(b.point, b.roll) - PEAK_LAPEL_CM) < 1e-9);
    // It stays on the chest, inside the shoulder.
    assert.ok(b.point.x < teeDimensions(pointed).shoulderX - 4, `${b.point.x}`);
  }
});

test('the pattern cuts the peak on each front and its facing, folding along the same roll line', () => {
  const pieces = patternPieces(peak), plain = patternPieces(blazer);
  const front = pieces.find(piece => piece.part === 'front')!, facing = pieces.find(piece => piece.part === 'lapel')!, notched = plain.find(piece => piece.part === 'front')!;
  assert.deepEqual(front.foldLine, notched.foldLine);
  const [B] = front.foldLine!, widest = Math.max(...front.outline.filter(p => p.x > B.x - 6 && p.y < B.y).map(p => fromLine(p, front.foldLine!)));
  assert.ok(Math.abs(widest - PEAK_LAPEL_CM) < 0.5, `${widest}`);
  assert.ok(front.areaCm2 > notched.areaCm2, `${front.areaCm2} against ${notched.areaCm2}`);
  // The facing shares the lapel's edge; neither outline crosses itself.
  assert.ok(front.outline.filter(p => p.x > B.x).every(p => facing.outline.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6)));
  assert.ok(simple(front.outline) && simple(facing.outline));
});

test('peak lapels go with the lapels, the coat or long sleeves, and are checked when a design is loaded', () => {
  assert.deepEqual(optionsOf(peak), { ...optionsOf(blazer), peakLapels: true });
  assert.equal(validateProduct(JSON.parse(JSON.stringify(peak))).options!.peakLapels, true);
  assert.equal(optionsOf(withOptions(peak, { ...optionsOf(peak), lapels: false })).peakLapels, undefined);
  assert.equal(optionsOf(withOptions(peak, { ...optionsOf(peak), coat: false, lapels: false })).peakLapels, undefined);
  const short = withSleeveLength(structuredClone(peak), 21);
  assert.equal(optionsOf(short).lapels, undefined);
  assert.equal(optionsOf(short).peakLapels, undefined);
  assert.throws(() => validateProduct({ ...blazer, options: { ...optionsOf(blazer), lapels: false, peakLapels: true } }), /Peak lapels need lapels: add them first/);
  assert.throws(() => validateProduct({ ...blazer, options: { ...optionsOf(blazer), peakLapels: 'yes' } }), /Peak lapels must be on or off/);
  // Version history names the change.
  assert.deepEqual(designDifferences({ ...createProject(), product: blazer }, { ...createProject(), product: peak }), ['Peak lapels: off → on']);
});

test('in 3D the peak lapels are edge-stitched on the fronts and drape without overstretching', () => {
  const meshes = teeMesh(peak, Delaunator), lapel = meshes.find(part => part.part === 'lapel')!;
  assert.ok(lapel.uvs.every((value, i) => i % 2 || value > 0));
  const result = simulateGarment(peak, meshes, 104, { frames: 120 });
  assert.ok(result.metrics.maxStrain < 0.35, `strain ${result.metrics.maxStrain}`);
  const draped = (part: string) => { const flat = result.parts.find(item => item.part === part)!.positions; return Array.from({ length: flat.length / 3 }, (_, v) => [flat[v * 3]!, flat[v * 3 + 1]!, flat[v * 3 + 2]!] as const); };
  const front = draped('front');
  for (const p of draped('lapel')) assert.ok(Math.min(...front.map(q => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]))) < 3, 'a lapel point left the front');
});

test('descriptions name peak lapels, switch between peak and notched, and take them off', () => {
  const lines = (prompt: string, product: Product) => readDesignPrompt(prompt, product).scopes.flatMap(scope => scope.understood);
  const described = readDesignPrompt('blazer with peak lapels', template('shirt') as Product);
  assert.ok(optionsOf(described.product).peakLapels);
  assert.deepEqual(described.scopes.flatMap(scope => scope.understood).map(line => line.replace(/\d+ cm/, 'N cm')), ['garment: Blazer with peak lapels, N cm long']);
  // Named on a blazer, they replace its notched lapels, styled too when a colour is given.
  const black = readDesignPrompt('black peaked lapels', blazer);
  assert.ok(optionsOf(black.product).peakLapels);
  assert.notEqual(black.product.parts.lapel!.color, black.product.parts.front.color);
  assert.deepEqual(lines('peak lapels', blazer), ['peak lapels']);
  // Notched again, or taken off; a coat gains them.
  assert.deepEqual(lines('notched lapels', peak), ['notched lapels']);
  const unpeaked = readDesignPrompt('no peak lapels', peak).product;
  assert.ok(optionsOf(unpeaked).lapels && !optionsOf(unpeaked).peakLapels);
  const removed = readDesignPrompt('no lapels', peak).product;
  assert.equal(optionsOf(removed).lapels, undefined);
  assert.equal(optionsOf(removed).peakLapels, undefined);
  assert.ok(lines('coat with peak lapels', coat).includes('peak lapels added'));
  // Described as a blazer again, it keeps its peak lapels.
  assert.ok(optionsOf(readDesignPrompt('blazer', peak).product).peakLapels);
  assert.deepEqual(readDesignPrompt('tee with peak lapels', template('blank') as Product).ignored, ['lapels (they go on a coat or blazer, not a t-shirt)']);
});

test('the tech pack measures the wider point and sets the collar under each peak', () => {
  const pack = buildTechPack(peak, '2026-11-19');
  assert.equal(pack.poms.find(row => row.name === 'Lapel width')!.values[pack.sampleSize], PEAK_LAPEL_CM);
  assert.match(pack.construction.find(row => row.area === 'Fronts and lapels')!.detail, /is a peak lapel, 9\.0 cm wide at its point, which rises above the collar's end;/);
  assert.match(pack.construction.find(row => row.area === 'Collar')!.operation, /between the roll lines, meeting each lapel under its peak, and topstitch/);
  assert.match(buildTechPack(blazer, '2026-11-19').construction.find(row => row.area === 'Collar')!.operation, /notched where it meets each lapel/);
});
