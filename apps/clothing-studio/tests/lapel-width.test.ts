import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import { lapelShape, optionsOf, patternPieces, teeMesh, template, validateProduct, withOptions, type Product } from '../src/product.ts';
import { gradedProduct } from '../src/size-grades.ts';
import { buildTechPack } from '../src/techpack.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';

type Pt = { x: number; y: number };
const distance = (p: Pt, [a, b]: readonly Pt[]) => Math.abs((b.x-a.x)*(a.y-p.y)-(a.x-p.x)*(b.y-a.y))/Math.hypot(b.x-a.x,b.y-a.y);
function simple(outline: Pt[]) {
  const side = (a: Pt, b: Pt, c: Pt) => Math.sign((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => side(a,b,c)*side(a,b,d)<0 && side(c,d,a)*side(c,d,b)<0;
  for (let i=0;i<outline.length;i++) for (let j=i+2;j<outline.length;j++) {
    if (i===0 && j===outline.length-1) continue;
    if (crosses(outline[i],outline[(i+1)%outline.length],outline[j],outline[(j+1)%outline.length])) return false;
  }
  return true;
}
const jacket = (peak: boolean) => withOptions(template('blazer'), { ...optionsOf(template('blazer')), peakLapels: peak });
const width = (product: Product, lapelWidth: number) => validateProduct({ ...product, fit: { ...product.fit, lapelWidth } });

test('authored lapel width changes the front, facing and worn mesh while keeping the collar join', () => {
  for (const peak of [false, true]) for (const value of [4, 6.25, 10, 12]) {
    const original = jacket(peak), edited = width(original, value), shape = lapelShape(edited), before = lapelShape(original);
    assert.ok(Math.abs(distance(shape.point, shape.roll) - value) < 1e-9);
    assert.deepEqual(shape.roll, before.roll);
    assert.deepEqual(shape.lapel[2], before.lapel[2]);
    const pieces = patternPieces(edited), previous = patternPieces(original);
    for (const part of ['front', 'lapel']) {
      assert.notDeepEqual(pieces.find(p => p.part === part)!.outline, previous.find(p => p.part === part)!.outline);
    }
    assert.deepEqual(pieces.find(p => p.part === 'collar'), previous.find(p => p.part === 'collar'));
    const front = pieces.find(p => p.part === 'front')!, facing = pieces.find(p => p.part === 'lapel')!;
    assert.ok(simple(front.outline) && simple(facing.outline));
    const [B] = front.foldLine!;
    assert.ok(front.outline.filter(p => p.x > B.x).every(p => facing.outline.some(q => Math.hypot(p.x-q.x,p.y-q.y)<1e-6)));
    assert.notDeepEqual(teeMesh(edited, Delaunator).find(p => p.part === 'lapel')!.positions, teeMesh(original, Delaunator).find(p => p.part === 'lapel')!.positions);
    assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(edited))), edited);
  }
});

test('legacy defaults stay exact and authored widths survive module changes and size grading', () => {
  for (const peak of [false, true]) {
    const original = jacket(peak);
    assert.deepEqual(patternPieces(width(original, peak ? 9 : 8)), patternPieces(original));
    assert.deepEqual(teeMesh(width(original, peak ? 9 : 8), Delaunator), teeMesh(original, Delaunator));
    const custom = width(original, 6.25), off = withOptions(custom, { ...optionsOf(custom), lapels: false });
    assert.equal(validateProduct(off).fit!.lapelWidth, 6.25);
    const restored = withOptions(off, { ...optionsOf(off), lapels: true, peakLapels: !peak });
    assert.ok(Math.abs(distance(lapelShape(restored).point, lapelShape(restored).roll)-6.25)<1e-9);
    for (const size of ['XS', 'M', 'XL'] as const) {
      const graded = gradedProduct(custom, size), pack = buildTechPack(graded, '2026-11-19');
      assert.equal(pack.poms.find(p => p.code === 'Z')!.values[size], 6.25);
      assert.match(pack.construction.find(p => p.area === 'Fronts and lapels')!.detail, /6.3 cm wide/);
    }
  }
});

test('lapel width rejects invalid data and active widths extending beyond the shoulder', () => {
  for (const value of [3.99,12.01,NaN,Infinity,'6',null]) assert.throws(() => width(jacket(false), value as number), /Lapel width/);
  assert.throws(() => validateProduct({ ...jacket(true), fit: { shoulderWidth: 38, neckWidth: 24, lapelWidth: 12 } }), /lapel.*shoulder/i);
  assert.throws(() => width(template('trousers'), 6), /tops/);
});

test('style descriptions apply lapel widths in cm or mm only to active lapels', () => {
  for (const text of ['blazer lapel width 6.25 cm', 'peak lapels, 62.5 mm lapel width']) {
    const result = readDesignPrompt(text, jacket(false));
    assert.equal(result.product.fit?.lapelWidth, 6.25);
  }
  const result = readDesignPrompt('black tee, lapel width 6 cm', template('blank'));
  assert.equal(result.product.fit?.lapelWidth, undefined);
  assert.ok(result.ignored.some(s => s.includes('lapel width')));
});

test('older saved jackets without an authored width remain readable on narrow shoulders', () => {
  const saved = { ...jacket(true), fit: { shoulderWidth: 34, neckWidth: 26 } };
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(saved))), saved);
});

test('ungraded construction width keeps all authored decimals in every actual size and POM', () => {
  const custom = width(jacket(false), 6.257);
  const pack = buildTechPack(custom, '2026-11-19');
  for (const size of ['XS','S','M','L','XL'] as const) {
    const graded = gradedProduct(custom, size), shape = lapelShape(graded);
    assert.equal(graded.fit!.lapelWidth, 6.257);
    assert.ok(Math.abs(distance(shape.point, shape.roll)-6.257)<1e-9);
    assert.equal(pack.poms.find(p => p.code === 'Z')!.values[size], 6.257);
  }
});

test('a numeric sleeve edit that removes lapels ignores their requested width', () => {
  const result = readDesignPrompt('lapel width 6 cm and sleeve length 15 cm', jacket(false));
  assert.equal(optionsOf(result.product).lapels, undefined);
  assert.equal(result.product.fit?.lapelWidth, undefined);
  assert.ok(result.ignored.some(s => s.includes('lapel width')));
});

test('colours beside a measured lapel style only the lapel, including when the trim is unavailable', () => {
  const original = jacket(false), result = readDesignPrompt('red 6 cm lapel width', original);
  assert.equal(result.product.fit!.lapelWidth, 6);
  assert.notEqual(result.product.parts.lapel.color, original.parts.lapel.color);
  assert.deepEqual(result.product.parts.front, original.parts.front);
  const tee = template('blank'), ignored = readDesignPrompt('red 6 cm lapel width and chest 110 cm', tee);
  assert.deepEqual(ignored.product.parts.front, tee.parts.front);
  assert.ok(ignored.ignored.some(s => s.includes('lapel')));
});

test('authored peak widths cannot turn the peak downward', () => {
  assert.throws(() => validateProduct({ ...jacket(true), fit: { waistPosition: 38, lapelWidth: 12 } }), /peak.*(above|rise)/i);
});

test('authored lapel widths cannot make a crossing facing', () => {
  for (const value of [4,8,12]) assert.throws(() => validateProduct({ ...jacket(false), fit: {
    waistPosition:25,frontNeckDrop:25,neckWidth:12,shoulderWidth:50,armholeDepth:30,lapelWidth:value,
  } }), /lapel.*cross|facing/i);
});
