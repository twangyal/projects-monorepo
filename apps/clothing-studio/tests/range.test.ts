import { pngUrl } from './helpers/raster.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { template, validateProduct, type Product } from '../src/product.ts';
import { costRow, costing, currentColorway, DEFAULT_COSTING, nextColorwayId, rangePlan, rangePlanXlsx } from '../src/range.ts';
import { fabricUsage } from '../src/techpack.ts';

const ringer = (): Product => template('ringer');

test('colorways and costing are validated with the design, and older designs stay valid', () => {
  const base = ringer();
  const good = validateProduct({ ...base, colorways: [{ id: 'c1', name: ' Navy ', parts: base.parts, units: 120 }], costing: DEFAULT_COSTING });
  assert.equal(good.colorways![0].name, 'Navy');
  assert.equal(validateProduct(structuredClone(base)).colorways, undefined);
  const bad: [string, (p: Record<string, unknown>) => void][] = [
    ['units fraction', p => { p.colorways = [{ id: 'c1', name: 'A', parts: base.parts, units: 1.5 }]; }],
    ['units negative', p => { p.colorways = [{ id: 'c1', name: 'A', parts: base.parts, units: -1 }]; }],
    ['duplicate ids', p => { p.colorways = [{ id: 'c1', name: 'A', parts: base.parts, units: 1 }, { id: 'c1', name: 'B', parts: base.parts, units: 1 }]; }],
    ['bad id', p => { p.colorways = [{ id: 'C 1', name: 'A', parts: base.parts, units: 1 }]; }],
    ['empty name', p => { p.colorways = [{ id: 'c1', name: '  ', parts: base.parts, units: 1 }]; }],
    ['too many', p => { p.colorways = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: 'A', parts: base.parts, units: 1 })); }],
    ['bad fabric in colorway', p => { p.colorways = [{ id: 'c1', name: 'A', parts: { ...base.parts, front: { ...base.parts.front, material: 'silk' } }, units: 1 }]; }],
    ['currency', p => { p.costing = { ...DEFAULT_COSTING, currency: 'JPY' }; }],
    ['negative price', p => { p.costing = { ...DEFAULT_COSTING, retail: -1 }; }],
    ['unknown fabric price', p => { p.costing = { ...DEFAULT_COSTING, fabricPrices: { silk: 3 } }; }],
    ['missing costing field', p => { const partial: Record<string, unknown> = { ...DEFAULT_COSTING }; delete partial.make; p.costing = partial; }],
  ];
  for (const [label, mutate] of bad) { const p = structuredClone(base) as unknown as Record<string, unknown>; mutate(p); assert.throws(() => validateProduct(p), Error, label); }
});

test('unit cost adds fabric by consumption and price, trims, printing per artwork and make; totals follow units', () => {
  const product = ringer(), usage = fabricUsage(product);
  const row = costRow(product, currentColorway(product));
  const expectedFabric = usage.reduce((sum, u) => sum + u.linearM * DEFAULT_COSTING.fabricPrices[u.style.material], 0);
  assert.equal(row.fabric, Math.round(expectedFabric * 100) / 100);
  assert.equal(row.print, 0);
  assert.equal(row.unitCost, Math.round((row.fabric + 0.6 + 3.5) * 100) / 100);
  assert.equal(row.margin, Math.round(((35 - row.unitCost) / 35) * 1000) / 10);
  // Denim sleeves cost more than slub ones; artwork adds its print cost; units multiply.
  const denim = { ...product.parts, sleeveLeft: { ...product.parts.sleeveLeft, material: 'denim-340' }, sleeveRight: { ...product.parts.sleeveRight, material: 'denim-340' } };
  const withArt: Product = { ...product, artwork: [{ part: 'front', dataUrl: pngUrl(10,10), width: 10, height: 10, name: 'a', xCm: 0, yCm: 8, widthCm: 10 }],
    colorways: [{ id: 'c1', name: 'Ecru', parts: product.parts, units: 100 }, { id: 'c2', name: 'Denim sleeves', parts: denim, units: 50 }] };
  const plan = rangePlan(withArt);
  assert.deepEqual(plan.rows.map(r => r.name), ['Ecru', 'Denim sleeves']);
  assert.ok(plan.rows[1].fabric > plan.rows[0].fabric);
  assert.equal(plan.rows[0].print, 1.2);
  assert.equal(plan.rows[0].totalCost, Math.round(plan.rows[0].unitCost * 100 * 100) / 100);
  assert.equal(plan.totals.units, 150);
  assert.equal(plan.totals.totalRevenue, 35 * 150);
  // Saved costing overrides defaults, keeping defaults for fabrics it does not mention.
  const priced = costing({ ...product, costing: { ...DEFAULT_COSTING, currency: 'EUR', fabricPrices: { 'slub-160': 20 } } });
  assert.equal(priced.fabricPrices['slub-160'], 20); assert.equal(priced.fabricPrices['rib-220'], 9); assert.equal(priced.currency, 'EUR');
  assert.equal(costRow(product, currentColorway(product), { ...DEFAULT_COSTING, retail: 0 }).margin, null);
  assert.equal(nextColorwayId([{ id: 'c1', name: 'a', parts: product.parts, units: 0 }, { id: 'c3', name: 'b', parts: product.parts, units: 0 }]), 'c2');
});

test('the range plan workbook has the plan, the fabric costing and notes', () => {
  const product: Product = { ...ringer(), colorways: [{ id: 'c1', name: 'Ecru & red', parts: ringer().parts, units: 10 }] };
  const bytes = rangePlanXlsx(product, '2026-10-13'), text = new TextDecoder().decode(bytes);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
  // Store-only entries keep the XML readable in the archive bytes.
  assert.match(text, /<sheet name="Range plan"[^>]*\/><sheet name="Fabric costing"[^>]*\/><sheet name="Notes"/);
  assert.match(text, /Ecru &amp; red/);
  assert.match(text, /<c r="B2"><v>10<\/v><\/c>/);
});
