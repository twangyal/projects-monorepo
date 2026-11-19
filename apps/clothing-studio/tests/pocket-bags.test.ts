import test from 'node:test';
import assert from 'node:assert/strict';
import { frontPocketEdge, optionsOf, patternPieces, patternKey, patternLabel, template, validateProduct, withOptions, type Product } from '../src/product.ts';
import { buildTechPack, fabricUsage, pocketingUsage } from '../src/techpack.ts';
import { patternSvg, patternDxf, layoutPattern, offsetOutline } from '../src/pattern-export.ts';
import { tiledProductPatternHtml } from '../src/product-print-pattern.ts';
import { gradedProduct } from '../src/size-grades.ts';
const bags = (p: Product) => patternPieces(p).filter(piece => piece.auxiliary);
const length = (points: { x: number; y: number }[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

test('pocket bags are two independently keyed cutting pieces, each a mirrored pair, without a saved part', () => {
  const p = template('jeans'), before = structuredClone(p), pieces = bags(p);
  assert.deepEqual(pieces.map(patternKey), ['pocketBagInner', 'pocketBagOuter']);
  assert.ok(pieces.every(piece => piece.part === 'frontPocket' && piece.cutCount === 2 && piece.areaCm2 > 0));
  assert.deepEqual(pieces.map(piece => patternLabel(p, piece)), ['Front pocket bag (inner)', 'Front pocket bag (outer)']);
  assert.deepEqual(validateProduct(p), before);
  assert.equal(bags(template('trousers')).length, 0);
  assert.equal(bags(withOptions(p, { ...optionsOf(p), frontPockets: false })).length, 0);
});
test('the inner bag follows the exact scoop, and both bags share their complete lower joining path', () => {
  for (const id of ['jeans', 'shorts'] as const) for (const size of ['XS', 'M', 'XL'] as const) {
    const base = template(id), p = gradedProduct(withOptions(base, { ...optionsOf(base), frontPockets: true }), size);
    const [inner, outer] = bags(p), opening = frontPocketEdge(p);
    assert.ok(inner && outer);
    for (const q of opening) assert.ok(inner.outline.some(point => Math.hypot(point.x - q.x, point.y - q.y) < 1e-8));
    const end = inner.outline.findIndex(q => Math.hypot(q.x - opening.at(-1)!.x, q.y - opening.at(-1)!.y) < 1e-8);
    const join = inner.outline.slice(0, end + 1);
    assert.ok(join.length > 8); assert.deepEqual(outer.outline.slice(1, 1 + join.length), join);
    assert.ok(Math.abs(length(join) - length(outer.outline.slice(1, 1 + join.length))) < 1e-8);
    assert.ok(outer.areaCm2 > inner.areaCm2);
  }
});
test('pocketing consumption is tracked separately from unchanged main fabric, and construction names both pieces', () => {
  const p = template('jeans'), pieces = bags(p), usage = pocketingUsage(p);
  assert.equal(usage.pieces, 4);
  assert.ok(Math.abs(usage.areaM2 - pieces.reduce((sum, piece) => sum + piece.areaCm2 * piece.cutCount, 0) * 1.15 / 10000) < 1e-9);
  assert.equal(fabricUsage(p).reduce((sum, row) => sum + row.areaM2, 0), patternPieces(p).filter(piece => !piece.auxiliary).reduce((sum, piece) => sum + piece.areaCm2 * piece.cutCount, 0) * 1.15 / 10000);
  const pack = buildTechPack(p, '2026-11-18'), row = pack.bom.find(row => row.item === 'P1 Pocketing')!;
  assert.match(row.quantity, /4 pcs/); assert.match(row.quantity, new RegExp(usage.areaM2.toFixed(2)));
  assert.match(pack.construction.find(row => row.area === 'Front pockets')!.detail, /inner.*outer/i);
});
test('SVG, DXF and tiled patterns identify pocketing pieces and resolve every unique local reference', () => {
  const p = template('jeans');
  for (const text of [patternSvg(p), patternDxf(p), tiledProductPatternHtml(p, 'a4'), tiledProductPatternHtml(p, 'letter')]) {
    assert.match(text, /Front pocket bag \(inner\)/); assert.match(text, /Front pocket bag \(outer\)/); assert.match(text, /Cotton twill pocketing/);
    const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
    for (const reference of text.matchAll(/url\(#([^)]*)\)/g)) assert.ok(ids.includes(reference[1]), reference[1]);
  }
});

function inside(point: { x: number; y: number }, outline: { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    // The garment samples its side curve at different heights; half a millimetre covers that polyline approximation.
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) < .05) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * dx / dy) hit = !hit;
  }
  return hit;
}
test('admitted boundary measurements keep simple positive bag cuts inside the front and above the crotch', () => {
  for (const waist of [56, 76, 130]) for (const hip of [80, 102, 150]) for (const rise of [18, 28, 40]) for (const fly of [false, true]) {
    if (hip < waist) continue;
    const source = template('jeans'), base = withOptions(source, { ...optionsOf(source), fly, beltLoops: fly }), product = validateProduct({ ...base, measurements: { waist, hip, rise, inseam: 8, legOpening: 30 } });
    const cuts = patternPieces(product), front = cuts.find(piece => piece.part === 'front')!, facing = cuts.find(piece => piece.part === 'frontPocket' && !piece.auxiliary)!;
    for (const bag of bags(product)) {
      assert.ok(bag.areaCm2 > 0); assert.ok(bag.height <= rise - 1 + 1e-9);
      for (const allowance of [0, .5, 1, 1.5, 2]) assert.ok(!hasCrossing(offsetOutline(bag.outline, allowance)), `simple cut at ${allowance} cm`);
      for (const point of bag.outline) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && (inside(point, front.outline) || inside(point, facing.outline)), `${waist}/${hip}/${rise}/${fly}: ${JSON.stringify(point)}`);
      const cross = (a: typeof bag.outline[number], b: typeof a, c: typeof a) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      for (let i = 0; i < bag.outline.length; i++) for (let j = i + 2; j < bag.outline.length; j++) {
        if (i === 0 && j === bag.outline.length - 1) continue;
        const a = bag.outline[i], b = bag.outline[(i + 1) % bag.outline.length], c = bag.outline[j], d = bag.outline[(j + 1) % bag.outline.length];
        assert.ok(!(cross(a, b, c) * cross(a, b, d) < -1e-9 && cross(c, d, a) * cross(c, d, b) < -1e-9), 'no crossing cut edges');
      }
    }
  }
});

function hasCrossing(points: { x: number; y: number }[]): boolean {
  const cross = (a: typeof points[number], b: typeof a, c: typeof a) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue;
    const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length];
    if (cross(a, b, c) * cross(a, b, d) < -1e-9 && cross(c, d, a) * cross(c, d, b) < -1e-9) return true;
  }
  return false;
}
test('the full supported seam allowance keeps actual bag cutting lines simple at an extreme fitted waist', () => {
  const source = template('jeans'), p = validateProduct({ ...source, measurements: { waist: 56, hip: 150, rise: 18, inseam: 8, legOpening: 30 } });
  for (const allowance of [0, .5, 1, 1.5, 2]) for (const item of layoutPattern(p, allowance).pieces.filter(item => item.piece.auxiliary)) assert.ok(!hasCrossing(item.cutting), `${patternKey(item.piece)} at ${allowance} cm`);
});
test('the outer bag supports the whole existing facing, including a close fitted waist', () => {
  const source = template('jeans'), p = validateProduct({ ...source, measurements: { waist: 56, hip: 105, rise: 28, inseam: 74, legOpening: 40 } });
  const pieces = patternPieces(p), outer = bags(p)[1], facing = pieces.find(piece => piece.part === 'frontPocket' && !piece.auxiliary)!;
  for (const point of facing.outline) assert.ok(inside(point, outer.outline), `facing point ${JSON.stringify(point)} has pocketing behind it`);
});
test('pocketing length is explicitly an area equivalent rather than single-garment purchasing yardage', () => {
  const row = buildTechPack(template('jeans'), '2026-11-18').bom.find(row => row.item === 'P1 Pocketing')!;
  assert.match(row.quantity, /area equivalent/i); assert.match(row.quantity, /not a cutting marker/i);
});

test('DXF bag text rows fit their cutting pieces rather than overlapping neighbouring cuts', () => {
  const p = template('jeans'), layout = layoutPattern(p), entities = patternDxf(p).split('0\nTEXT\n').slice(1);
  for (const item of layout.pieces.filter(item => item.piece.auxiliary)) {
    const xs = item.cutting.map(q => q.x), sewn = item.sewing.map(q => q.x), centre = (Math.min(...sewn) + Math.max(...sewn)) * 5;
    const span = (Math.max(...xs) - Math.min(...xs)) * 10;
    const rows = entities.map(text => {
      const tokens = text.split('\n'), row: Record<string, string> = {};
      for (let i = 0; i + 1 < tokens.length; i += 2) { if (tokens[i] === '0') break; row[tokens[i]] = tokens[i + 1]; }
      return row;
    }).filter(row => row['8'] === 'TEXT' && Math.abs(Number(row['10']) - centre) < .01);
    assert.ok(rows.length >= 2);
    for (const row of rows) assert.ok(Array.from(row['1'].replace(/\\U\+[A-F0-9]{4}/g, '_')).length * Number(row['40']) <= span, `${patternKey(item.piece)} text fits`);
  }
});
