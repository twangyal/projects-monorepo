// Size grading: the design is the sample size, and each size step up or down changes its body measurements by a fixed
// increment (centimetres per size). Fit points the designer edited change by their own increments; points left at their
// proportional values follow the graded chest and length, as they do when the measurements are edited. The tech pack
// measures each size from the graded design, so the 3D garment, its patterns and the size chart agree.
import { LIMITS, SIZES, fitValues, isBottoms, legMeasurements, optionsOf, topMeasurements, validateProduct, type FitKey, type Product, type Size } from './product.ts';

/** Fit increments per size step for tops; points not listed stay the same in every size. */
export const FIT_GRADES: Partial<Record<FitKey, number>> = {
  shoulderWidth: 1.5, armholeDepth: 1, neckWidth: 0.5, frontNeckDrop: 0.25, hemWidth: 2.5, sleeveOpening: 0.5,
  hoodHeight: 0.5, hoodWidth: 0.5, chestPocketWidth: 0.5, chestPocketHeight: 0.5, chestPocketY: 0.5,
};
/** Body increments per size step: a top's chest girth and body length, and its sleeve (more for long sleeves). */
export const TOP_GRADES = { chest: 5, length: 1.5, sleeve: (sleeve: number) => (sleeve > 40 ? 1 : 0.5) };
/** Shorts' and trousers' increments per size step. */
export const LEG_GRADES = { waist: 5, hip: 5, rise: 0.5, inseam: 0, legOpening: 1 } as const;

/** Whether a fit point belongs to this top: hood points to a hoodie, chest pocket points to a top with one. */
function applies(product: Product, key: FitKey): boolean {
  if (key === 'hoodHeight' || key === 'hoodWidth') return product.base === 'hoodie';
  if (key.startsWith('chestPocket')) return optionsOf(product).chestPocket;
  return true;
}

/** Sizes the design can be graded to: tops, shorts and trousers (a flared skirt has no grading). */
export function gradable(product: Product): boolean { return product.base !== 'skirt'; }

/**
 * The design graded to `size` from its sample size. Throws when the graded measurements fall outside what the studio
 * supports (a very large design graded up, say).
 */
export function gradedProduct(product: Product, size: Size): Product {
  const sample = product.spec?.sampleSize ?? 'M', steps = SIZES.indexOf(size) - SIZES.indexOf(sample);
  if (!gradable(product) && steps) throw new Error('Flared skirts are not graded; every size shows the sample.');
  if (!steps) return product;
  const graded = structuredClone(product);
  // The graded design is its own sample, so its size chart is centred on it.
  graded.spec = { styleNumber: product.spec?.styleNumber ?? '', season: product.spec?.season ?? '', sampleSize: size };
  if (isBottoms(product)) {
    const m = legMeasurements(product), next = { ...m };
    for (const [key, grade] of Object.entries(LEG_GRADES) as [keyof typeof LEG_GRADES, number][]) next[key] = round(m[key] + steps * grade);
    graded.measurements = next;
  } else {
    const m = topMeasurements(product);
    graded.measurements = { chest: round(m.chest + steps * TOP_GRADES.chest), length: round(m.length + steps * TOP_GRADES.length), sleeve: round(m.sleeve + steps * TOP_GRADES.sleeve(m.sleeve)) };
    const fit: NonNullable<Product['fit']> = Object.fromEntries(Object.entries(product.fit ?? {}).map(([key, value]) => [key, round(value + steps * (FIT_GRADES[key as FitKey] ?? 0))]));
    // A point left at a fixed default (a hood's height, a crew neck's drop) would not change with the chest, so it takes
    // its own increment, while it stays within what can be edited.
    const sample = fitValues(product), proportional = fitValues({ ...graded, fit });
    for (const [key, grade] of Object.entries(FIT_GRADES) as [FitKey, number][]) {
      if (key in fit || !applies(product, key) || Math.abs(proportional[key] - sample[key]) > 0.01) continue;
      const value = round(sample[key] + steps * grade), [low, high] = LIMITS.fit[key];
      if (value >= low && value <= high) fit[key] = value;
    }
    if (Object.keys(fit).length) graded.fit = fit; else delete graded.fit;
    // Artwork stays where it was, pulled back inside a smaller panel.
    const half = graded.measurements.chest / 4 + 1;
    for (const art of graded.artwork) { art.xCm = Math.max(-half, Math.min(half, art.xCm)); art.yCm = Math.min(art.yCm, graded.measurements.length); }
  }
  try { return validateProduct(graded); }
  catch (error) { throw new Error(`Size ${size} would be outside the supported measurements: ${error instanceof Error ? error.message : 'invalid'}`); }
}

const round = (value: number) => Math.round(value * 100) / 100;
