// Range plan: colorways of one garment side by side with their unit cost, margin and planned totals.
// Fabric cost comes from the same consumption estimate as the tech pack's bill of materials.
import { material, type Colorway, type Costing, type Product } from './product.ts';
import { fabricUsage, xlsx, FABRIC_WIDTH_CM } from './techpack.ts';

/** Indicative starting prices per linear metre of 150 cm fabric; designers replace them with quotes. */
export const DEFAULT_FABRIC_PRICES: Record<string, number> = {
  'jersey-180': 6.5, 'jersey-240': 8, 'slub-160': 7, 'rib-220': 9, 'pique-200': 8.5, 'terry-300': 10, 'linen-170': 12, 'denim-340': 11,
};
export const DEFAULT_COSTING: Costing = { currency: 'USD', retail: 35, make: 3.5, trims: 0.6, printPerArtwork: 1.2, fabricPrices: { ...DEFAULT_FABRIC_PRICES } };
export const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£' } as const;
const MAX_ID = 1e6;

export interface FabricCost { material: string; name: string; color: string; linearM: number; pricePerM: number; cost: number }
export interface RangeRow {
  id: string; name: string; units: number; fabrics: FabricCost[];
  fabric: number; trims: number; print: number; make: number; unitCost: number; retail: number; margin: number | null;
  totalCost: number; totalRevenue: number;
}
export interface RangePlan { currency: Costing['currency']; rows: RangeRow[]; totals: { units: number; totalCost: number; totalRevenue: number; margin: number | null } }

const money = (value: number) => Math.round(value * 100) / 100;

export function costing(product: Product): Costing {
  const saved = product.costing ?? DEFAULT_COSTING;
  return { ...saved, fabricPrices: { ...DEFAULT_FABRIC_PRICES, ...saved.fabricPrices } };
}

/** Unit cost of one colorway: fabric by consumption × price, trims, printing per artwork, and make. */
export function costRow(product: Product, colorway: Colorway, inputs: Costing = costing(product)): RangeRow {
  const fabrics = fabricUsage({ ...product, parts: colorway.parts }).map(usage => {
    const pricePerM = inputs.fabricPrices[usage.style.material] ?? DEFAULT_FABRIC_PRICES[usage.style.material] ?? 0;
    return { material: usage.style.material, name: material(usage.style.material).name, color: usage.style.color, linearM: usage.linearM, pricePerM, cost: usage.linearM * pricePerM };
  });
  const fabric = fabrics.reduce((sum, f) => sum + f.cost, 0), print = product.artwork.length * inputs.printPerArtwork;
  // Totals multiply the unit cost as shown (to the cent), so the plan adds up on paper.
  const unitCost = money(money(fabric) + money(inputs.trims) + money(print) + money(inputs.make));
  return {
    id: colorway.id, name: colorway.name, units: colorway.units, fabrics,
    fabric: money(fabric), trims: money(inputs.trims), print: money(print), make: money(inputs.make), unitCost, retail: money(inputs.retail),
    margin: inputs.retail > 0 ? Math.round(((inputs.retail - unitCost) / inputs.retail) * 1000) / 10 : null,
    totalCost: money(unitCost * colorway.units), totalRevenue: money(inputs.retail * colorway.units),
  };
}

/** The design being edited counts as a colorway until it is saved as one. */
export function currentColorway(product: Product): Colorway { return { id: 'current', name: 'Current design', parts: product.parts, units: 0 }; }

export function rangePlan(product: Product): RangePlan {
  const inputs = costing(product), colorways = product.colorways?.length ? product.colorways : [currentColorway(product)];
  const rows = colorways.map(colorway => costRow(product, colorway, inputs));
  const totalCost = money(rows.reduce((sum, row) => sum + row.totalCost, 0)), totalRevenue = money(rows.reduce((sum, row) => sum + row.totalRevenue, 0));
  return { currency: inputs.currency, rows, totals: { units: rows.reduce((sum, row) => sum + row.units, 0), totalCost, totalRevenue,
    margin: totalRevenue > 0 ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 1000) / 10 : null } };
}

/** A new colorway ID not used by any existing one. */
export function nextColorwayId(colorways: readonly Colorway[]): string {
  for (let n = 1; n < MAX_ID; n++) if (!colorways.some(c => c.id === `c${n}`)) return `c${n}`;
  throw new Error('No colorway ID is available.');
}

export function rangePlanXlsx(product: Product, date: string): Uint8Array<ArrayBuffer> {
  const plan = rangePlan(product), c = plan.currency;
  return xlsx([
    { name: 'Range plan', widths: [26, 10, 14, 12, 12, 12, 14, 12, 10, 16, 16],
      rows: [['Colorway', 'Units', `Fabric ${c}`, `Trims ${c}`, `Print ${c}`, `Make ${c}`, `Unit cost ${c}`, `Retail ${c}`, 'Margin %', `Total cost ${c}`, `Revenue ${c}`],
        ...plan.rows.map(r => [r.name, r.units, r.fabric, r.trims, r.print, r.make, r.unitCost, r.retail, r.margin ?? '—', r.totalCost, r.totalRevenue]),
        ['Total', plan.totals.units, '', '', '', '', '', '', plan.totals.margin ?? '—', plan.totals.totalCost, plan.totals.totalRevenue]] },
    { name: 'Fabric costing', widths: [26, 22, 12, 16, 16, 14],
      rows: [['Colorway', 'Fabric', 'Colour', `Metres (${FABRIC_WIDTH_CM} cm)`, `Price per m ${c}`, `Cost ${c}`],
        ...plan.rows.flatMap(r => r.fabrics.map(f => [r.name, f.name, f.color, Math.round(f.linearM * 1000) / 1000, f.pricePerM, money(f.cost)]))] },
    { name: 'Notes', widths: [80], rows: [['Note'], [`${product.name} range plan, generated ${date}.`],
      ['Fabric metres are estimated from finished pattern areas plus waste (see the tech pack); confirm with a marker.'],
      ['Default prices are indicative placeholders; replace them with supplier quotes.']] },
  ]);
}
