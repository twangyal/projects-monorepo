import test from 'node:test';
import assert from 'node:assert/strict';
import { designDifferences } from '../src/design-diff.ts';
import { readDesignPrompt } from '../src/design-prompt.ts';
import { createProject } from '../src/model.ts';
import { buildTechPack, fabricUsage } from '../src/techpack.ts';
import {
  LINING_LIFT_CM, LINING_MATERIAL, LINING_PLEAT_CM, isPocketBag, liningAllowed, optionsOf, partsOf, patternFabric, patternKey, patternLabel, patternPieces, template, validateProduct, withOptions, withSleeveLength,
  type PatternPiece, type Product,
} from '../src/product.ts';

type Pt = { x: number; y: number };
const blazer = template('blazer') as Product, coat = template('coat') as Product;
const lined = (product: Product) => withOptions(product, { ...optionsOf(product), lining: true });
const piece = (product: Product, key: string) => patternPieces(product).find(item => patternKey(item) === key)!;
const bounds = (outline: Pt[]) => ({ minX: Math.min(...outline.map(p => p.x)), maxX: Math.max(...outline.map(p => p.x)), maxY: Math.max(...outline.map(p => p.y)) });
function simple(outline: Pt[]) {
  const side = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
  const n = outline.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1) && crosses(outline[i]!, outline[(i + 1) % n]!, outline[j]!, outline[(j + 1) % n]!)) return false;
  return true;
}

test('a coat can be lined: the lining is a part of its own, in a lining fabric in the body colour, and goes when the coat does', () => {
  const blazerLined = lined(blazer);
  assert.equal(optionsOf(blazerLined).lining, true);
  assert.ok(partsOf(blazerLined).includes('lining') && !partsOf(blazer).includes('lining'));
  assert.deepEqual(blazerLined.parts.lining, { material: LINING_MATERIAL, color: blazer.parts.front.color, print: null });
  assert.equal(validateProduct(JSON.parse(JSON.stringify(blazerLined))).options!.lining, true);
  // Only a coat takes one; a design that is not a coat is refused, and one that stops being a coat loses it.
  assert.equal(liningAllowed(template('shirt') as Product, optionsOf(template('shirt') as Product)), false);
  assert.throws(() => withOptions(template('shirt') as Product, { ...optionsOf(template('shirt') as Product), lining: true }), /A lining goes in a coat: make it a coat first/);
  assert.throws(() => validateProduct({ ...blazer, options: { ...optionsOf(blazer), coat: false, lapels: false, lining: true } }), /A lining goes in a coat/);
  assert.throws(() => validateProduct({ ...blazer, options: { ...optionsOf(blazer), lining: 'yes' } }), /Lining must be on or off/);
  const shirt = withOptions(lined(coat), { ...optionsOf(lined(coat)), coat: false });
  assert.equal(optionsOf(shirt).lining, undefined);
  assert.equal(shirt.parts.lining, undefined);
  const short = withSleeveLength(structuredClone(lined(coat)), 21);
  assert.equal(optionsOf(short).lining, undefined);
  assert.equal(short.parts.lining, undefined);
  // Taken off, the part goes too; version history names it.
  assert.equal(withOptions(blazerLined, { ...optionsOf(blazerLined), lining: false }).parts.lining, undefined);
  assert.deepEqual(designDifferences({ ...createProject(), product: blazer }, { ...createProject(), product: blazerLined }), ['Lining: off → on', 'Lining: added (Viscose lining, dark blue grey)']);
});

test('the pattern cuts the lining behind the facing, with a pleat at the centre back, ending above the hems', () => {
  const product = lined(blazer), front = piece(product, 'front'), facing = piece(product, 'lapel'), back = piece(product, 'back'), sleeve = piece(product, 'sleeveLeft');
  const liningFront = piece(product, 'liningFront'), liningBack = piece(product, 'liningBack'), liningSleeve = piece(product, 'liningSleeve');
  assert.deepEqual([liningFront, liningBack, liningSleeve].map(item => [patternLabel(product, item), patternFabric(product, item), item.cutCount, isPocketBag(item)]),
    [['Front lining', 'Viscose lining', 2, false], ['Back lining', 'Viscose lining', 1, false], ['Sleeve lining', 'Viscose lining', 2, false]]);
  // The front lining reaches the facing's inner edge below the lapel, and stops short of the coat's hem.
  const facingInner = Math.min(...facing.outline.filter(p => p.y > front.foldLine![0].y).map(p => p.x));
  assert.ok(Math.abs(bounds(liningFront.outline).maxX - facingInner) < 1e-6, `${bounds(liningFront.outline).maxX} against ${facingInner}`);
  assert.ok(Math.abs(bounds(liningFront.outline).maxY - (front.height - LINING_LIFT_CM)) < 1e-6);
  assert.ok(liningFront.areaCm2 < front.areaCm2 - facing.areaCm2 / 2);
  // The back lining is wider by the pleat; the sleeve lining is the sleeve, shorter.
  assert.ok(Math.abs(liningBack.width - (back.width + LINING_PLEAT_CM)) < 1e-6);
  assert.ok(Math.abs(liningBack.height - (back.height - LINING_LIFT_CM)) < 1e-6);
  assert.ok(Math.abs(liningSleeve.width - sleeve.width) < 1e-6 && Math.abs(liningSleeve.height - (sleeve.height - LINING_LIFT_CM)) < 1e-6);
  for (const item of [liningFront, liningBack, liningSleeve] as PatternPiece[]) assert.ok(simple(item.outline), patternKey(item));
  // Behind a placket there is no facing: the front lining runs to the front edge.
  const placketed = lined(coat);
  assert.ok(Math.abs(piece(placketed, 'liningFront').width - piece(placketed, 'front').width) < 1e-6);
  assert.equal(patternPieces(blazer).some(item => item.part === 'lining'), false);
});

test('the tech pack buys the lining fabric and bags the lining in instead of binding the seams', () => {
  const product = lined(blazer), pack = buildTechPack(product, '2026-11-19');
  const fabric = pack.bom.find(row => row.item.endsWith('Viscose lining'))!;
  assert.equal(fabric.placement, 'Lining');
  const usage = fabricUsage(product).find(item => item.parts.includes('lining'))!;
  assert.ok(usage.areaM2 > 0.8 && usage.areaM2 < 2, `${usage.areaM2}`);
  assert.match(pack.construction.find(row => row.area === 'Lining')!.operation, /bag it in: sew it to the facings and back neck/);
  assert.match(pack.construction.find(row => row.area === 'Lining')!.detail, /ends 2\.0 cm above the hem it is sewn to, folded over it in a jump pleat/);
  assert.equal(pack.construction.find(row => row.area === 'Seams'), undefined);
  assert.match(pack.construction.find(row => row.area === 'Body hem')!.detail, /the lining is sewn to the turn-up/);
  // Unlined, the seams are bound as before.
  assert.match(buildTechPack(blazer, '2026-11-19').construction.find(row => row.area === 'Seams')!.detail, /Unlined/);
});

test('descriptions line a coat, colour its lining, and take it out; other garments say why not', () => {
  const lines = (prompt: string, product: Product) => readDesignPrompt(prompt, product).scopes.flatMap(scope => scope.understood);
  const red = readDesignPrompt('blazer with a red lining', template('shirt') as Product).product;
  assert.ok(optionsOf(red).lining);
  assert.notEqual(red.parts.lining!.color, red.parts.front.color);
  const burgundy = readDesignPrompt('navy blazer with a burgundy lining', template('blank') as Product).product;
  assert.notEqual(burgundy.parts.lining!.color, burgundy.parts.front.color);
  assert.deepEqual(lines('lined', blazer), ['lined']);
  assert.deepEqual(lines('unlined', lined(blazer)), ['lining removed: the seams are bound']);
  assert.equal(optionsOf(readDesignPrompt('no lining', lined(blazer)).product).lining, undefined);
  assert.throws(() => readDesignPrompt('lined', template('shirt') as Product), /a lining \(it goes in a coat or blazer, not a button-up shirt\)/);
});
