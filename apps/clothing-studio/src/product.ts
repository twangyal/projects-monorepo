import { validateSkirtMeasures, skirtPieces, skirtMesh, skirtHeight, type SkirtMeasures } from './product-skirt.ts';
import { validateRasterHeader } from './media.ts';
import { material } from './materials.ts';
// Product designs: a base garment built from named parts, each styled with a fabric, color and optional
// repeat print, plus placed artwork. Pure data, geometry and validation; rendering lives in product-3d.ts.

/** Base products. Each declares the parts a design styles; the 3D shell, pattern and tech pack follow them. */
export const BASES = ['tee', 'sweatshirt', 'hoodie', 'trousers', 'skirt'] as const;
export type Base = typeof BASES[number];
export const BASE_NAMES: Record<Base, string> = { tee: 'T-shirt', sweatshirt: 'Crew sweatshirt', hoodie: 'Pullover hoodie', trousers: 'Pull-on trousers', skirt: 'Flared skirt' };
export const PART_IDS = ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband', 'cuffLeft', 'cuffRight', 'hemBand', 'hood', 'pocket', 'chestPocket', 'waistband'] as const;
export type PartId = typeof PART_IDS[number];
export const PART_NAMES: Record<PartId, string> = { front: 'Front body', back: 'Back body', sleeveLeft: 'Left sleeve', sleeveRight: 'Right sleeve', neckband: 'Neck rib',
  cuffLeft: 'Left cuff', cuffRight: 'Right cuff', hemBand: 'Hem band', hood: 'Hood', pocket: 'Pocket', chestPocket: 'Chest pocket', waistband: 'Waistband' };
export const BASE_PARTS: Record<Base, readonly PartId[]> = {
  tee: ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband'],
  sweatshirt: ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband', 'cuffLeft', 'cuffRight', 'hemBand'],
  hoodie: ['front', 'back', 'sleeveLeft', 'sleeveRight', 'cuffLeft', 'cuffRight', 'hemBand', 'hood', 'pocket'],
  // Shorts and trousers: front and back leg panels (cut in pairs) and an elasticated waistband.
  trousers: ['front', 'back', 'waistband'],
  skirt: ['front', 'back'],
};
/** A part's display name on this design: the front and back of shorts and trousers are leg panels. */
export function partName(product: Pick<Product, 'base'>, part: PartId): string {
  if (product.base === 'trousers' && (part === 'front' || part === 'back')) return part === 'front' ? 'Front legs' : 'Back legs';
  return PART_NAMES[part];
}
/** Bottoms use their own measured panels instead of top measurements or the top drape. */
export function isBottoms(product: Pick<Product, 'base'>): boolean { return product.base === 'trousers' || product.base === 'skirt'; }
/** Parts knitted as rib trims: they keep their rib fabric when a style is copied to every part. */
export const RIB_PARTS: ReadonlySet<PartId> = new Set(['neckband', 'cuffLeft', 'cuffRight', 'hemBand']);
/** The parts of this design: its base's parts plus any optional module parts, in display order. */
export function partsOf(product: Pick<Product, 'base' | 'options'>): readonly PartId[] {
  return optionsOf(product).chestPocket ? [...BASE_PARTS[product.base], 'chestPocket'] : BASE_PARTS[product.base];
}

/**
 * Modules a base product can be switched between, as in product-library tools. A curved (shirttail) hem needs an
 * unbanded hem, so only the tee has it; the hoodie's kangaroo pocket takes the place of a chest pocket.
 */
export const HEMS = ['straight', 'curved'] as const;
export type Hem = typeof HEMS[number];
export const HEM_NAMES: Record<Hem, string> = { straight: 'Straight', curved: 'Curved shirttail' };
export interface Options { hem: Hem; chestPocket: boolean }
export const DEFAULT_OPTIONS: Options = { hem: 'straight', chestPocket: false };
export function optionsOf(product: Pick<Product, 'options'>): Options { return product.options ?? DEFAULT_OPTIONS; }
export function hemAllowed(base: Base, hem: Hem): boolean { return hem === 'straight' || base === 'tee'; }
export function chestPocketAllowed(base: Base): boolean { return base === 'tee' || base === 'sweatshirt'; }
/** Sleeve-length presets in cm; the measurement stays editable. */
export const SLEEVE_PRESETS = [{ id: 'short', name: 'Short', cm: 21 }, { id: 'elbow', name: 'Elbow', cm: 35 }, { id: 'long', name: 'Long', cm: 60 }] as const;

/** The design with new module options: a new chest pocket starts in the front body's style, here and in every colorway. */
export function withOptions(product: Product, next: Options): Product {
  if (!hemAllowed(product.base, next.hem)) fail(`A ${BASE_NAMES[product.base].toLowerCase()} has a rib hem band, so its hem stays straight.`);
  if (next.chestPocket && !chestPocketAllowed(product.base)) fail(product.base === 'hoodie' ? 'A hoodie has a kangaroo pocket instead of a chest pocket.' : 'A chest pocket goes on a top.');
  const draft = structuredClone(product);
  const setPocket = (parts: Record<PartId, PartStyle>) => {
    if (next.chestPocket) parts.chestPocket ??= structuredClone(parts.front);
    else delete (parts as Partial<Record<PartId, PartStyle>>).chestPocket;
  };
  setPocket(draft.parts);
  for (const colorway of draft.colorways ?? []) setPocket(colorway.parts);
  draft.options = { ...next };
  return draft;
}
/** Height of rib cuffs and the hem band on sweatshirts and hoodies, in cm. */
export const BAND_CM = 6;

export { MATERIALS, material, type Material } from './materials.ts';
export const MOTIFS = ['stripe', 'dots', 'gingham', 'floral', 'triangles', 'waves'] as const;
export type Motif = typeof MOTIFS[number];
export const MOTIF_NAMES: Record<Motif, string> = { stripe: 'Breton stripe', dots: 'Polka dots', gingham: 'Gingham check', floral: 'Ditsy floral', triangles: 'Geometric triangles', waves: 'Waves' };
export const LAYOUTS = ['grid', 'half-drop', 'half-brick', 'mirror'] as const;
export type Layout = typeof LAYOUTS[number];
export const LAYOUT_NAMES: Record<Layout, string> = { grid: 'Standard', 'half-drop': 'Half drop', 'half-brick': 'Half brick', mirror: 'Mirror' };

/** A library motif, or `upload:<id>` for a motif the designer uploaded to this design. */
export type PrintMotif = Motif | `upload:${string}`;
export interface Print { motif: PrintMotif; color: string; scaleCm: number; layout: Layout; direction?: 'horizontal' | 'vertical' }
/** A designer's own motif image, repeated like library motifs (drawn as uploaded; print color does not tint it). */
export interface UploadedMotif { id: string; name: string; dataUrl: string; width: number; height: number }
export interface PartStyle { material: string; color: string; print: Print | null }
export interface Artwork { part: 'front' | 'back'; dataUrl: string; width: number; height: number; name: string; xCm: number; yCm: number; widthCm: number; /** Clockwise viewed from outside, about the existing centre; absent means zero. */ rotation?: number }
export interface Measurements { chest: number; length: number; sleeve: number }
/**
 * A top's editable points of measure, in cm, as the tech pack states them: shoulder width (E), shoulder drop (U), neck width (F), front
 * neck drop (G), back neck drop (H), armhole depth (D), hem width ½ (I, side seam to side seam) and sleeve opening ½ (J). Each one left
 * out keeps its default. Optional chest-pocket width/height/placement use P/Q/R/V. Defaults are chest-based where applicable; back neck drop is 2 cm and shoulder drop is 4 cm.
 */
export const POCKET_FIT_KEYS = ['chestPocketWidth', 'chestPocketHeight', 'chestPocketX', 'chestPocketY'] as const;
export const FIT_KEYS = ['shoulderWidth', 'shoulderDrop', 'neckWidth', 'frontNeckDrop', 'backNeckDrop', 'hoodHeight', 'hoodWidth', 'neckRibHeight', 'cuffHeight', 'hemBandHeight', 'armholeDepth', 'hemWidth', 'sleeveOpening', ...POCKET_FIT_KEYS] as const;
export type FitKey = typeof FIT_KEYS[number];
export type Fit = Partial<Record<FitKey, number>>;
export const FIT_NAMES: Record<FitKey, string> = { shoulderWidth: 'Shoulder width', shoulderDrop: 'Shoulder drop', neckWidth: 'Neck width', frontNeckDrop: 'Front neck drop', backNeckDrop: 'Back neck drop', hoodHeight: 'Hood side height', hoodWidth: 'Hood side width', neckRibHeight: 'Neck rib height', cuffHeight: 'Cuff height', hemBandHeight: 'Hem band height',
  chestPocketWidth: 'Chest pocket width', chestPocketHeight: 'Chest pocket height', chestPocketX: 'Pocket centre offset', chestPocketY: 'Pocket top placement',
  armholeDepth: 'Armhole depth', hemWidth: 'Hem width (½)', sleeveOpening: 'Sleeve opening (½)' };
/** Finished leg measurements in cm: relaxed elastic waist, hip, front rise, inseam and leg opening (circumference). */
export interface LegMeasurements { waist: number; hip: number; rise: number; inseam: number; legOpening: number; waistbandHeight?: number }
export interface Spec { styleNumber: string; season: string; sampleSize: Size }
export const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type Size = typeof SIZES[number];
/** A saved alternative set of part styles for the same garment, with its planned quantity. */
export interface Colorway { id: string; name: string; parts: Record<PartId, PartStyle>; units: number }
export const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;
export type Currency = typeof CURRENCIES[number];
/** Costing inputs per garment; fabric prices are per linear metre of 150 cm wide fabric. */
export interface Costing { currency: Currency; retail: number; make: number; trims: number; printPerArtwork: number; fabricPrices: Record<string, number> }
export interface Product {
  /** Exactly the design's parts (partsOf) are present in `parts`. */
  /** Each base has its own measurements; bottoms keep a 'crew' placeholder neckline. */
  base: Base; name: string; measurements: Measurements | LegMeasurements | SkirtMeasures; neckline: 'crew' | 'v';
  parts: Record<PartId, PartStyle>; artwork: Artwork[];
  /** Module choices; absent until one is changed (then DEFAULT_OPTIONS apply). */
  options?: Options;
  /** Edited points of measure (tops only); absent, or without a key, keeps the proportional default. */
  fit?: Fit;
  /** Tech-pack header details; absent until the designer fills them in. */
  spec?: Spec;
  /** Colorways for the range plan; absent until one is saved. */
  colorways?: Colorway[];
  /** Costing inputs; absent until the designer changes the defaults. */
  costing?: Costing;
  /** Uploaded repeat motifs; absent until one is uploaded. */
  motifs?: UploadedMotif[];
}

export const LIMITS = {
  chest: [80, 150], length: [55, 90], sleeve: [10, 65], waist: [56, 130], hip: [80, 150], rise: [18, 40], inseam: [8, 90], legOpening: [30, 80], waistbandHeight: [4, 10], scaleCm: [2, 40], artworkWidthCm: [3, 40], artworkBytes: 1_500_000, name: 80,
  fit: { shoulderWidth: [30, 70], shoulderDrop: [1, 8], neckWidth: [12, 28], frontNeckDrop: [2, 25], backNeckDrop: [1, 12], hoodHeight: [24, 44], hoodWidth: [20, 34], neckRibHeight: [1, 4], cuffHeight: [2, 12], hemBandHeight: [2, 12], armholeDepth: [15, 36], hemWidth: [35, 95], sleeveOpening: [8, 30], chestPocketWidth: [6, 20], chestPocketHeight: [6, 24], chestPocketX: [-22, 22], chestPocketY: [8, 45] } as Record<FitKey, readonly [number, number]>,
  colorways: 8, colorwayName: 40, units: [0, 1_000_000], price: [0, 10_000], motifs: 6, motifBytes: 600_000,
} as const;

const fail = (message: string): never => { throw new Error(message); };
function plain(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be a plain object.`);
  const own = Object.keys(value as object);
  if (own.length !== keys.length || own.some(key => !keys.includes(key))) fail(`${label} has unsupported or missing fields.`);
  for (const key of own) { const d = Object.getOwnPropertyDescriptor(value, key)!; if (!('value' in d)) fail(`${label} cannot contain accessors.`); }
  return value as Record<string, unknown>;
}
const finite = (value: unknown, [low, high]: readonly [number, number], label: string): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high ? value : fail(`${label} must be from ${low} to ${high}.`);
const hex = (value: unknown, label: string): string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fail(`${label} must be a six-digit hex color.`);

/** A top's measurements; bottoms have none of these. */
export function topMeasurements(product: Pick<Product, 'base' | 'measurements'>): Measurements {
  if (product.base === 'skirt') fail('Skirts use waist, hem and slant measurements.');
  return isBottoms(product) ? fail('Shorts and trousers use leg measurements.') : product.measurements as Measurements;
}
/** Shorts' and trousers' leg measurements. */
export function legMeasurements(product: Pick<Product, 'base' | 'measurements'>): LegMeasurements {
  return product.base === 'trousers' ? product.measurements as LegMeasurements : fail('Only shorts and trousers have leg measurements.');
}


function validatePrint(value: unknown, uploaded: ReadonlySet<string>): Print | null {
  if (value === null) return null;
  const directional = !!value && typeof value === 'object' && Object.hasOwn(value, 'direction');
  const p = plain(value, ['motif', 'color', 'scaleCm', 'layout', ...(directional ? ['direction'] : [])], 'Print');
  const upload = typeof p.motif === 'string' && p.motif.startsWith('upload:') ? p.motif.slice(7) : null;
  if (upload !== null ? !uploaded.has(upload) : !MOTIFS.includes(p.motif as Motif)) fail('Choose a print from the library or an uploaded motif.');
  if (!LAYOUTS.includes(p.layout as Layout)) fail('Print repeat must be standard, half drop, half brick or mirror.');
  if (directional && (p.motif !== 'stripe' || !['horizontal', 'vertical'].includes(p.direction as string))) fail('Stripe direction must be horizontal or vertical and only applies to stripes.');
  return { motif: p.motif as PrintMotif, color: hex(p.color, 'Print color'), scaleCm: finite(p.scaleCm, LIMITS.scaleCm, 'Print repeat size (cm)'), layout: p.layout as Layout, ...(directional ? { direction: p.direction as Print['direction'] } : {}) };
}
function validateArtwork(value: unknown, measurements: Measurements): Artwork {
  const rotated = !!value && typeof value === 'object' && Object.hasOwn(value, 'rotation');
  const a = plain(value, ['part', 'dataUrl', 'width', 'height', 'name', 'xCm', 'yCm', 'widthCm', ...(rotated ? ['rotation'] : [])], 'Artwork');
  if (a.part !== 'front' && a.part !== 'back') fail('Artwork goes on the front or back.');
  if (typeof a.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(a.dataUrl) || a.dataUrl.length > LIMITS.artworkBytes * 1.4) fail('Artwork must be a PNG, JPEG or WebP image of at most 1.5 MB.');
  const width = finite(a.width, [1, 4096], 'Artwork pixel width'), height = finite(a.height, [1, 4096], 'Artwork pixel height');
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail('Artwork pixel size must be whole numbers.');
  validateRasterHeader({dataUrl:a.dataUrl as string,width,height}, LIMITS.artworkBytes, 4096);
  if (typeof a.name !== 'string' || a.name.length > 120) fail('Artwork name must be at most 120 characters.');
  const panel = panelSize(measurements);
  const widthCm = finite(a.widthCm, LIMITS.artworkWidthCm, 'Artwork width (cm)');
  return { part: a.part as Artwork['part'], dataUrl: a.dataUrl as string, width, height, name: a.name as string, xCm: finite(a.xCm, [-panel.width / 2, panel.width / 2], 'Artwork horizontal position (cm)'),
    yCm: finite(a.yCm, [0, panel.length], 'Artwork distance below the neck (cm)'), widthCm,
    ...(rotated ? { rotation: finite(a.rotation, [-180, 180], 'Artwork rotation (degrees)') } : {}) };
}

function validateParts(value: unknown, uploaded: ReadonlySet<string>, ids: readonly PartId[]): Record<PartId, PartStyle> {
  const rawParts = plain(value, ids, 'Parts');
  return Object.fromEntries(ids.map(id => {
    const s = plain(rawParts[id], ['material', 'color', 'print'], PART_NAMES[id]);
    if (typeof s.material !== 'string') fail('Choose a fabric from the library.');
    material(s.material as string);
    return [id, { material: s.material as string, color: hex(s.color, `${PART_NAMES[id]} color`), print: validatePrint(s.print, uploaded) }];
  })) as Record<PartId, PartStyle>;
}
const plainText = (value: unknown, limit: number, label: string) =>
  typeof value === 'string' && value.length <= limit && ![...value].some(c => c.charCodeAt(0) < 32) ? value.trim() : fail(`${label} must be at most ${limit} characters of plain text.`);
function validateColorways(value: unknown, uploaded: ReadonlySet<string>, ids: readonly PartId[]): Colorway[] {
  if (!Array.isArray(value) || value.length > LIMITS.colorways) fail(`Keep at most ${LIMITS.colorways} colorways.`);
  const colorways = (value as unknown[]).map(item => {
    const c = plain(item, ['id', 'name', 'parts', 'units'], 'Colorway');
    if (typeof c.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(c.id)) fail('Colorway IDs must be short lowercase letters and digits.');
    const name = plainText(c.name, LIMITS.colorwayName, 'Colorway name');
    if (!name) fail('Name each colorway.');
    const units = finite(c.units, LIMITS.units, 'Planned units');
    if (!Number.isInteger(units)) fail('Planned units must be a whole number.');
    return { id: c.id as string, name, parts: validateParts(c.parts, uploaded, ids), units };
  });
  if (new Set(colorways.map(c => c.id)).size !== colorways.length) fail('Colorway IDs must be unique.');
  return colorways;
}
function validateCosting(value: unknown): Costing {
  const c = plain(value, ['currency', 'retail', 'make', 'trims', 'printPerArtwork', 'fabricPrices'], 'Costing');
  if (!CURRENCIES.includes(c.currency as Currency)) fail('Currency must be USD, EUR or GBP.');
  const prices = plain(c.fabricPrices, Object.keys((c.fabricPrices ?? {}) as object), 'Fabric prices');
  const fabricPrices = Object.fromEntries(Object.entries(prices).map(([id, price]) => { material(id); return [id, finite(price, LIMITS.price, `${material(id).name} price`)]; }));
  return { currency: c.currency as Currency, retail: finite(c.retail, LIMITS.price, 'Retail price'), make: finite(c.make, LIMITS.price, 'Make cost'),
    trims: finite(c.trims, LIMITS.price, 'Trims cost'), printPerArtwork: finite(c.printPerArtwork, LIMITS.price, 'Print cost'), fabricPrices };
}

function validateMotifs(value: unknown): UploadedMotif[] {
  if (!Array.isArray(value) || value.length > LIMITS.motifs) fail(`Keep at most ${LIMITS.motifs} uploaded motifs.`);
  const motifs = (value as unknown[]).map(item => {
    const m = plain(item, ['id', 'name', 'dataUrl', 'width', 'height'], 'Uploaded motif');
    if (typeof m.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(m.id)) fail('Motif IDs must be short lowercase letters and digits.');
    if (typeof m.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(m.dataUrl) || m.dataUrl.length > LIMITS.motifBytes * 1.4) fail('A motif must be a PNG, JPEG or WebP image of at most 600 KB.');
    const width = finite(m.width, [1, 2048], 'Motif pixel width'), height = finite(m.height, [1, 2048], 'Motif pixel height');
    if (!Number.isInteger(width) || !Number.isInteger(height)) fail('Motif pixel size must be whole numbers.');
    validateRasterHeader({dataUrl:m.dataUrl as string,width,height}, LIMITS.motifBytes, 2048);
    const name = plainText(m.name, 60, 'Motif name');
    return { id: m.id as string, name: name || 'Uploaded motif', dataUrl: m.dataUrl as string, width, height };
  });
  if (new Set(motifs.map(m => m.id)).size !== motifs.length) fail('Motif IDs must be unique.');
  return motifs;
}
/** The display name of a part's print. */
export function printName(print: Print, product: Pick<Product, 'motifs'>): string {
  if (print.motif === 'stripe' && print.direction === 'vertical') return 'Vertical stripe';
  if (print.motif.startsWith('upload:')) return product.motifs?.find(m => `upload:${m.id}` === print.motif)?.name ?? 'Uploaded motif';
  return MOTIF_NAMES[print.motif as Motif];
}

const OPTIONAL = ['spec', 'colorways', 'costing', 'motifs', 'options', 'fit'] as const;
export function validateProduct(value: unknown): Product {
  const present = value && typeof value === 'object' ? OPTIONAL.filter(key => Object.hasOwn(value, key)) : [];
  const p = plain(value, ['base', 'name', 'measurements', 'neckline', 'parts', 'artwork', ...present], 'Product');
  if (!BASES.includes(p.base as Base)) fail('Choose a base product from the library.');
  const base = p.base as Base;
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > LIMITS.name) fail('Product name must contain 1–80 characters.');
  let measurements: Measurements | LegMeasurements | SkirtMeasures;
  if (base === 'skirt') {
    measurements = validateSkirtMeasures(p.measurements);
  } else if (base === 'trousers') {
    const band = !!p.measurements && typeof p.measurements === 'object' && Object.hasOwn(p.measurements, 'waistbandHeight');
    const m = plain(p.measurements, ['waist', 'hip', 'rise', 'inseam', 'legOpening', ...(band ? ['waistbandHeight'] : [])], 'Leg measurements');
    measurements = { waist: finite(m.waist, LIMITS.waist, 'Waist (cm)'), hip: finite(m.hip, LIMITS.hip, 'Hip (cm)'), rise: finite(m.rise, LIMITS.rise, 'Front rise (cm)'),
      inseam: finite(m.inseam, LIMITS.inseam, 'Inseam (cm)'), legOpening: finite(m.legOpening, LIMITS.legOpening, 'Leg opening (cm)'),
      ...(band ? { waistbandHeight: finite(m.waistbandHeight, LIMITS.waistbandHeight, 'Waistband height (cm)') } : {}) };
    if (measurements.hip < measurements.waist) fail('Hip must be at least the waist: the waistband has to pull on over the hips.');
    if (measurements.legOpening > measurements.hip * 0.8) fail('Leg opening must be narrower than the thigh (at most 80% of the hip).');
  } else {
    const m = plain(p.measurements, ['chest', 'length', 'sleeve'], 'Measurements');
    measurements = { chest: finite(m.chest, LIMITS.chest, 'Chest (cm)'), length: finite(m.length, LIMITS.length, 'Body length (cm)'), sleeve: finite(m.sleeve, LIMITS.sleeve, 'Sleeve length (cm)') };
  }
  if (p.neckline !== 'crew' && p.neckline !== 'v') fail('Neckline must be crew or v.');
  if (base === 'hoodie' && p.neckline !== 'crew') fail('A hoodie has a hood, not a V-neck.');
  if (isBottoms({base}) && p.neckline !== 'crew') fail('Bottoms have no neckline.');
  let options: Options | undefined;
  if (p.options !== undefined) {
    const o = plain(p.options, ['hem', 'chestPocket'], 'Modules');
    if (!HEMS.includes(o.hem as Hem)) fail('Hem must be straight or curved.');
    if (typeof o.chestPocket !== 'boolean') fail('Chest pocket must be on or off.');
    if (!hemAllowed(base, o.hem as Hem)) fail('Only a tee can have a curved hem; banded hems stay straight.');
    if (o.chestPocket && !chestPocketAllowed(base)) fail('A hoodie has a kangaroo pocket instead of a chest pocket.');
    options = { hem: o.hem as Hem, chestPocket: o.chestPocket as boolean };
  }
  const ids = partsOf({ base, options });
  let fit: Fit | undefined;
  if (p.fit !== undefined) {
    if (isBottoms({base})) fail('Fit measurements are for tops; bottoms use their own measurements.');
    const raw = p.fit && typeof p.fit === 'object' && !Array.isArray(p.fit) ? Object.keys(p.fit as object) : [];
    const f = plain(p.fit, raw.filter(key => FIT_KEYS.includes(key as FitKey)).length === raw.length ? raw : FIT_KEYS, 'Fit');
    fit = Object.fromEntries(Object.keys(f).map(key => [key, finite(f[key], LIMITS.fit[key as FitKey], `${FIT_NAMES[key as FitKey]} (cm)`)])) as Fit;
    checkFit({ base, measurements: measurements as Measurements, neckline: p.neckline as Product['neckline'], fit });
  }
  checkChestPocket({ base, measurements, neckline: p.neckline as Product['neckline'], fit, options });
  const motifs = p.motifs !== undefined ? validateMotifs(p.motifs) : undefined;
  const uploaded = new Set((motifs ?? []).map(m => m.id));
  const parts = validateParts(p.parts, uploaded, ids);
  if (!Array.isArray(p.artwork) || p.artwork.length > 2) fail('Place at most one artwork on the front and one on the back.');
  if (isBottoms({base}) && (p.artwork as unknown[]).length) fail('Artwork placement is available on tops.');
  const artwork = (p.artwork as unknown[]).map(item => validateArtwork(item, measurements as Measurements));
  if (new Set(artwork.map(item => item.part)).size !== artwork.length) fail('Place at most one artwork per side.');
  let spec: Spec | undefined;
  if (p.spec !== undefined) {
    const raw = plain(p.spec, ['styleNumber', 'season', 'sampleSize'], 'Tech pack details');
    if (!SIZES.includes(raw.sampleSize as Size)) fail('Sample size must be XS, S, M, L or XL.');
    spec = { styleNumber: plainText(raw.styleNumber, 40, 'Style number'), season: plainText(raw.season, 40, 'Season'), sampleSize: raw.sampleSize as Size };
  }
  return { base, name: (p.name as string).trim(), measurements, neckline: p.neckline as Product['neckline'], parts, artwork, ...(spec ? { spec } : {}),
    ...(p.colorways !== undefined ? { colorways: validateColorways(p.colorways, uploaded, ids) } : {}), ...(p.costing !== undefined ? { costing: validateCosting(p.costing) } : {}),
    ...(motifs ? { motifs } : {}), ...(options ? { options } : {}), ...(fit && Object.keys(fit).length ? { fit } : {}) };
}

const style = (material: string, color: string, print: Print | null = null): PartStyle => ({ material, color, print });
const allParts = (part: PartStyle, overrides: Partial<Record<PartId, PartStyle>> = {}, base: Base = 'tee') =>
  Object.fromEntries(BASE_PARTS[base].map(id => [id, overrides[id] ?? (RIB_PARTS.has(id) ? { ...part, material: 'rib-220', print: null } : part)])) as Record<PartId, PartStyle>;
const measurements: Measurements = { chest: 104, length: 72, sleeve: 21 };
const fleece: Measurements = { chest: 112, length: 70, sleeve: 62 };
const legFit: LegMeasurements = { waist: 76, hip: 102, rise: 28, inseam: 78, legOpening: 42 };

/** Base products are blank; templates are remixable designs built on them (as in product-library tools). */
export const TEMPLATES: readonly { id: string; name: string; description: string; product: Product }[] = [
  { id: 'blank', name: 'Blank tee', description: 'White cotton jersey with a rib neck — start from scratch.',
    product: { base: 'tee', name: 'Blank tee', measurements, neckline: 'crew', parts: allParts(style('jersey-180', '#f4f2ec')), artwork: [] } },
  { id: 'breton', name: 'Breton stripe', description: 'Navy stripes on ecru heavyweight jersey.',
    product: { base: 'tee', name: 'Breton stripe tee', measurements: { ...measurements, sleeve: 58 }, neckline: 'crew',
      parts: allParts(style('jersey-240', '#efe8d8', { motif: 'stripe', color: '#1f2a4f', scaleCm: 2, layout: 'grid' }), { neckband: style('rib-220', '#efe8d8') }), artwork: [] } },
  { id: 'ringer', name: 'Ringer tee', description: 'Contrast sleeves and neck rib on a vintage slub body.',
    product: { base: 'tee', name: 'Ringer tee', measurements, neckline: 'crew',
      parts: allParts(style('slub-160', '#f1ece0'), { sleeveLeft: style('slub-160', '#b23a2e'), sleeveRight: style('slub-160', '#b23a2e'), neckband: style('rib-220', '#b23a2e') }), artwork: [] } },
  { id: 'garden', name: 'Garden print', description: 'A half-drop ditsy floral on sage cotton.',
    product: { base: 'tee', name: 'Garden print tee', measurements, neckline: 'v',
      parts: allParts(style('jersey-180', '#9fae91', { motif: 'floral', color: '#f4efe3', scaleCm: 7, layout: 'half-drop' }), { neckband: style('rib-220', '#9fae91') }), artwork: [] } },
  { id: 'crew-sweat', name: 'Crew sweatshirt', description: 'Heather grey French terry with rib neck, cuffs and hem.',
    product: { base: 'sweatshirt', name: 'Crew sweatshirt', measurements: fleece, neckline: 'crew', parts: allParts(style('terry-300', '#b7b4ad'), {}, 'sweatshirt'), artwork: [] } },
  { id: 'hoodie', name: 'Pullover hoodie', description: 'Navy French terry with a hood, kangaroo pocket and rib trims.',
    product: { base: 'hoodie', name: 'Pullover hoodie', measurements: { ...fleece, length: 72 }, neckline: 'crew', parts: allParts(style('terry-300', '#1f2a4f'), {}, 'hoodie'), artwork: [] } },
  { id: 'shorts', name: 'Pull-on shorts', description: 'Washed linen shorts with an elasticated waistband.',
    product: { base: 'trousers', name: 'Pull-on shorts', measurements: { ...legFit, inseam: 18, legOpening: 58 }, neckline: 'crew', parts: allParts(style('linen-170', '#c9b48f'), {}, 'trousers'), artwork: [] } },
  { id: 'flared-skirt', name: 'Flared skirt', description: 'Two measured linen panels, with editable waist, hem and slant.',
    product: { base: 'skirt', name: 'Flared skirt', measurements: { waist: 80, hem: 140, slant: 60 }, neckline: 'crew', parts: allParts(style('linen-170', '#9fae91'), {}, 'skirt'), artwork: [] } },
  { id: 'trousers', name: 'Straight trousers', description: 'Indigo denim twill, straight leg, elasticated waist.',
    product: { base: 'trousers', name: 'Straight trousers', measurements: legFit, neckline: 'crew', parts: allParts(style('denim-340', '#2d3f5c'), {}, 'trousers'), artwork: [] } },
];
export function template(id: string): Product {
  const found = TEMPLATES.find(item => item.id === id) ?? fail('Choose a template from the library.');
  return validateProduct(structuredClone(found.product));
}

// Geometry -------------------------------------------------------------------------------------

/** Flat width and length of the front (and back) body panel, in cm: half the chest plus 2 cm ease. */
export function panelSize(m: Measurements) { return { width: m.chest / 2 + 2, length: m.length }; }
export function sleeveSize(m: Measurements) { const armhole = m.chest * 0.23 + 4; return { capWidth: armhole * 2, cuffWidth: Math.max(28, armhole * 1.55 - m.sleeve * 0.25), length: m.sleeve }; }
export const NECK_RIB_RATIO = 0.85;
/** Neck sewing path from right to left, matching the flat pattern's eight-segment crew curve. */
function neckPath(half: number, depth: number, v: boolean): { x: number; y: number }[] {
  if (v) return [{ x: half, y: 0 }, { x: 0, y: depth }, { x: -half, y: 0 }];
  return Array.from({ length: 9 }, (_, i) => { const t = Math.PI * i / 8; return { x: half * Math.cos(t), y: i === 0 || i === 8 ? 0 : depth * Math.sin(t) }; });
}
/** Flat rib sewing length: edited front + back opening, with an explicit 15% reduction assumption. */
export function neckSize(m: Measurements, neckline: Product['neckline'], fit: Fit = {}) {
  const half = (fit.neckWidth ?? (m.chest * 0.08 + 7) * 2) / 2;
  const front = neckPath(half, fit.frontNeckDrop ?? (neckline === 'v' ? 15 : 8), neckline === 'v');
  const back = neckPath(half, fit.backNeckDrop ?? 2, false);
  const length = [front, back].reduce((sum, path) => sum + path.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - path[i].x, p.y - path[i].y), 0), 0);
  return { length: length * NECK_RIB_RATIO, width: fit.neckRibHeight ?? 2 };
}

export const HEM_CURVE_CM = 4, POCKET_FOLD_CM = 2.5, POCKET_CHAMFER_CM = 1.5;
/** Every derived tee dimension, in cm, from one place: the 3D shell, pattern pieces and tech pack agree. */
export function teeDimensions(product: Product) {
  const m = topMeasurements(product), panel = panelSize(m), sleeve = sleeveSize(m), half = panel.width / 2, fit = product.fit ?? {}, shoulderDrop = fit.shoulderDrop ?? 4;
  const armDepth = fit.armholeDepth ?? m.chest * 0.23 + 2;
  return {
    panelWidth: panel.width, length: m.length, half, neckHalf: (fit.neckWidth ?? (m.chest * 0.08 + 7) * 2) / 2, shoulderX: (fit.shoulderWidth ?? (half * 0.86 + 1) * 2) / 2, shoulderDrop,
    armDepth, sleeveLength: m.sleeve,
    // Half the hem, side seam to side seam; the side seams run straight from the underarm to it.
    hemHalf: (fit.hemWidth ?? panel.width) / 2,
    // Long sleeves taper to a rib cuff; tee sleeves stay open and wide. The cap follows the armhole.
    cuffHalf: fit.sleeveOpening ?? (product.base === 'tee' ? Math.max(sleeve.cuffWidth / 2, 10) : Math.max(9, m.chest * 0.1)), capWidth: (armDepth + 2) * 2,
    neckDepthFront: fit.frontNeckDrop ?? (product.neckline === 'v' ? 15 : 8), neckDepthBack: fit.backNeckDrop ?? 2, ribHeight: neckSize(m, product.neckline, fit).width, ribLength: neckSize(m, product.neckline, fit).length,
    band: product.base === 'tee' ? 0 : fit.hemBandHeight ?? BAND_CM, cuffHeight: product.base === 'tee' ? 0 : fit.cuffHeight ?? BAND_CM, sleeveAngle: product.base === 'tee' ? 38 : 58,
    hoodHeight: fit.hoodHeight ?? 32, hoodWidth: fit.hoodWidth ?? 26, hoodHalf: 13, pocketTop: m.length - (fit.hemBandHeight ?? BAND_CM) - 22, pocketHalfTop: panel.width * 0.27, pocketHalfBottom: panel.width * 0.31,
    // A curved hem rises this far at the side seams; the body length is still measured at the centre.
    hemCurve: optionsOf(product).hem === 'curved' ? HEM_CURVE_CM : 0,
    // Chest pocket on the wearer's left (+x seen from the front): centre, top below the shoulder line, finished size.
    chestPocketX: fit.chestPocketX ?? half * 0.45, chestPocketY: fit.chestPocketY ?? shoulderDrop + armDepth * 0.5, chestPocketWidth: fit.chestPocketWidth ?? 12, chestPocketHeight: fit.chestPocketHeight ?? 13.5,
  };
}

/** How far a flared hem reaches past the chest on each side of the flat body piece (0 when it does not). */
export function flare(product: Product): number { const d = teeDimensions(product); return Math.max(0, d.hemHalf - d.half); }

/** Edited points of measure must still make a garment: the neck inside the shoulders, the armhole and neck within the body. */
function checkFit(product: Pick<Product, 'base' | 'measurements' | 'neckline' | 'fit'>) {
  if (product.base !== 'hoodie' && (product.fit?.hoodHeight !== undefined || product.fit?.hoodWidth !== undefined)) fail('Hood side dimensions apply only to hoodies.');
  if (product.base === 'hoodie' && product.fit?.neckRibHeight !== undefined) fail('A hoodie has a hood instead of a neck rib.');
  if (product.base === 'tee' && (product.fit?.cuffHeight !== undefined || product.fit?.hemBandHeight !== undefined)) fail('Cuff and hem band heights apply only to sweatshirts and hoodies.');
  const d = teeDimensions(product as Product);
  if (d.cuffHeight && d.sleeveLength - d.cuffHeight < 2) fail('The cuff must leave at least 2 cm of measured sleeve fabric.');
  // The sleeve's underarm seams run from the cap to the opening above the cuff.
  const sleeve = sleeveOutline(product as Product);
  if (d.cuffHeight && sleeve.opening[0].y - sleeve.cap[0].y < 2) fail('The cuff must leave at least 2 cm along the sleeve\'s underarm seams.');
  if (d.neckHalf + 4 > d.shoulderX) fail('The neck must be at least 8 cm narrower than the shoulders.');
  if (d.shoulderX > d.half + 8) fail('The shoulders can drop at most 8 cm past the chest on each side.');
  if (d.neckDepthFront + 4 > d.shoulderDrop + d.armDepth) fail('The front neck must end above the underarm.');
  if (d.shoulderDrop + d.armDepth + 12 > d.length - d.band) fail('The armhole must end at least 12 cm above the hem.');
  if (d.hemHalf < d.half * 0.7 || d.hemHalf > d.half * 1.6) fail(`Hem width (½) must be between ${(d.half * 1.4).toFixed(1)} and ${(d.half * 3.2).toFixed(1)} cm for this chest.`);
  if (d.cuffHalf * 2 > d.capWidth - 4) fail('The sleeve opening must be narrower than the sleeve at the armhole.');
}

/** Keep an enabled finished pocket's bounding rectangle at least 0.5 cm inside the actual front sewing outline. */
function checkChestPocket(product: Pick<Product, 'base' | 'measurements' | 'neckline' | 'fit' | 'options'>) {
  if (POCKET_FIT_KEYS.some(key => product.fit?.[key] !== undefined) && !chestPocketAllowed(product.base)) fail('Chest-pocket measurements apply only to tees and sweatshirts.');
  if (!optionsOf(product).chestPocket) return;
  const design = product as Product, d = teeDimensions(design), cx = flare(design) + d.half + d.chestPocketX;
  const left = cx - d.chestPocketWidth / 2, right = cx + d.chestPocketWidth / 2, top = d.chestPocketY, bottom = top + d.chestPocketHeight;
  const rectangle = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  const outline = patternPieces(design).find(piece => piece.part === 'front')!.outline;
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const distance = (a: Pt, b: Pt, c: Pt, e: Pt) => {
    const overlap = Math.max(Math.min(a.x, b.x), Math.min(c.x, e.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, e.x))
      && Math.max(Math.min(a.y, b.y), Math.min(c.y, e.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, e.y));
    if (overlap && cross(a, b, c) * cross(a, b, e) <= 0 && cross(c, e, a) * cross(c, e, b) <= 0) return 0;
    return Math.min(segmentDistance(a, c, e), segmentDistance(b, c, e), segmentDistance(c, a, b), segmentDistance(e, a, b));
  };
  if (rectangle.some(point => !inside(point, outline)) || rectangle.some((a, i) => outline.some((b, j) =>
    distance(a, rectangle[(i + 1) % rectangle.length], b, outline[(j + 1) % outline.length]) < 0.5 - 1e-9))) {
    fail('Keep the finished chest pocket at least 0.5 cm inside the front panel sewing outline.');
  }
}

export interface PatternPiece { part: PartId; outline: { x: number; y: number }[]; width: number; height: number; areaCm2: number; cutCount: number }

/** The garment's overall height in the 3D view, in cm (hem at 0). */
export function garmentHeight(product: Product): number {
  if (product.base === 'skirt') return skirtHeight(product);
  if (isBottoms(product)) return trouserDimensions(product).outseam;
  return topMeasurements(product).length + (product.base === 'hoodie' ? 30 : 0);
}

// Shorts and trousers ------------------------------------------------------------------------------

export const WAISTBAND_CM = 4;
/** Leg-length presets (inseam, cm); the measurement stays editable. */
export const LEG_PRESETS = [{ id: 'shorts', name: 'Shorts', inseam: 18 }, { id: 'cropped', name: 'Cropped', inseam: 58 }, { id: 'full', name: 'Full length', inseam: 78 }] as const;

/**
 * Every derived trouser dimension in cm, from one place. The style is pull-on: the panels are cut straight at the
 * waist wide enough to pass the hips, and an elastic in the waistband gathers them to the waist.
 */
export function trouserDimensions(product: Product) {
  const m = legMeasurements(product), waistbandHeight = m.waistbandHeight ?? WAISTBAND_CM;
  const frontHip = m.hip / 4 + 1, backHip = m.hip / 4 + 2, frontCrotch = m.hip * 0.05, backCrotch = m.hip * 0.1;
  return {
    ...m, waistbandHeight, frontHip, backHip, frontCrotch, backCrotch, hipDepth: m.rise * 0.7, backRaise: 3, length: m.rise + m.inseam,
    outseam: m.rise + m.inseam + waistbandHeight, frontHem: m.legOpening / 2 - 1, backHem: m.legOpening / 2 + 1,
    // A leg is one front and one back panel; measured 2.5 cm below the crotch, after the crotch curve.
    thighHalf: (frontHip + frontCrotch + backHip + backCrotch) / 2 - 1,
    elastic: m.waist - 4, waistbandLength: m.hip + 6,
    // The 3D view: gathered waist, hip and the leg's centre and half-width at the hem.
    waistHalf: m.waist / 4 + 1.5, hipHalf: m.hip / 4 + 1.5,
  };
}

function makePiece(part: PartId, outline: { x: number; y: number }[], cutCount: number): PatternPiece {
  return { part, outline, cutCount, width: Math.max(...outline.map(p => p.x)), height: Math.max(...outline.map(p => p.y)), areaCm2: area(outline) };
}

/** Front and back leg panels (each cut as a mirrored pair, side seam on the left) and the folded waistband. */
function trouserPieces(product: Product): PatternPiece[] {
  const d = trouserDimensions(product);
  const panel = (front: boolean) => {
    const hip = front ? d.frontHip : d.backHip, crotch = front ? d.frontCrotch : d.backCrotch, raise = front ? 0 : d.backRaise;
    const hem = front ? d.frontHem : d.backHem, centre = (hip + crotch) / 2, hipY = raise + d.hipDepth, crotchY = raise + d.rise, hemY = crotchY + d.inseam;
    // The back rises 3 cm higher at the centre back seam than at the side.
    const pts = [{ x: 0.5, y: raise }, { x: hip - 0.5, y: 0 }];
    // Centre seam: straight down to the hip line, then the crotch curve out to the inseam.
    for (let i = 0; i <= 6; i++) { const t = Math.PI / 2 * i / 6; pts.push({ x: hip + crotch * (1 - Math.cos(t)), y: hipY + (crotchY - hipY) * Math.sin(t) }); }
    pts.push({ x: centre + hem / 2, y: hemY }, { x: centre - hem / 2, y: hemY }, { x: 0, y: hipY });
    return pts;
  };
  const band = [{ x: 0, y: 0 }, { x: d.waistbandLength, y: 0 }, { x: d.waistbandLength, y: d.waistbandHeight * 2 }, { x: 0, y: d.waistbandHeight * 2 }];
  return [makePiece('front', panel(true), 2), makePiece('back', panel(false), 2), makePiece('waistband', band, 1)];
}

/** Columns across each trouser leg panel, and its rows from the waist to the hip line, the crotch and the hem. */
export function trouserGrid(product: Product) {
  const d = trouserDimensions(product), columns = 12, spacing = (d.frontHip + d.backHip) / 2 / columns;
  const upper = Math.min(20, Math.max(6, Math.round(d.rise / spacing))), lower = Math.min(40, Math.max(4, Math.round(d.inseam / (spacing * 1.3))));
  // The hip line splits the upper rows in proportion to the centre seam's straight part and its crotch curve.
  const curve = Math.PI / 2 * Math.sqrt((d.backCrotch ** 2 + (d.rise - d.hipDepth) ** 2) / 2);
  return { columns, upper, lower, hip: Math.min(upper - 2, Math.max(1, Math.round(upper * d.hipDepth / (d.hipDepth + curve)))) };
}

/** A point `f` of the way along a polyline, by length. */
function alongPolyline(points: Pt[], f: number): Pt {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y)), total = lengths.reduce((s, v) => s + v, 0);
  let left = f * total;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) { const t = lengths[i] ? Math.min(1, left / lengths[i]) : 0; return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t }; }
    left -= lengths[i];
  }
  return points.at(-1)!;
}

/**
 * Shorts and trousers in 3D, meshed from the leg panels themselves: each panel is a grid between its side seam and its
 * centre seam then inseam, so its UVs are its flat pattern position (cm). Above the hip line the four panels make one
 * tube round the hips; below it each pair turns in to its own leg, the centre seams meeting under the body at the
 * crotch point; below the crotch each leg is a tube. The waistband rises from the open waist.
 */
function trouserMesh(product: Product): PartMesh[] {
  const d = trouserDimensions(product), { columns, upper, lower, hip } = trouserGrid(product), rows = upper + lower;
  // Each panel's two long edges at every row, in pattern cm (x from the side seam, y down from the waist).
  const edges = (front: boolean) => {
    const hipWidth = front ? d.frontHip : d.backHip, crotch = front ? d.frontCrotch : d.backCrotch, raise = front ? 0 : d.backRaise;
    const hem = front ? d.frontHem : d.backHem, centre = (hipWidth + crotch) / 2, hipY = raise + d.hipDepth, crotchY = raise + d.rise, hemY = crotchY + d.inseam;
    const sideHem = { x: centre - hem / 2, y: hemY }, sideCrotch = { x: sideHem.x * (crotchY - hipY) / (hemY - hipY), y: crotchY };
    const curve: Pt[] = [];
    for (let i = 0; i <= 6; i++) { const t = Math.PI / 2 * i / 6; curve.push({ x: hipWidth + crotch * (1 - Math.cos(t)), y: hipY + (crotchY - hipY) * Math.sin(t) }); }
    return Array.from({ length: rows + 1 }, (_, r): [Pt, Pt] => {
      if (r <= hip) { const t = r / hip; return [{ x: 0.5 * (1 - t), y: raise + d.hipDepth * t }, { x: hipWidth - 0.5 * (1 - t), y: hipY * t }]; }
      if (r <= upper) { const t = (r - hip) / (upper - hip); return [{ x: sideCrotch.x * t, y: hipY + (crotchY - hipY) * t }, alongPolyline(curve, t)]; }
      const t = (r - upper) / lower, end = curve.at(-1)!;
      return [{ x: sideCrotch.x + (sideHem.x - sideCrotch.x) * t, y: crotchY + d.inseam * t }, { x: end.x + (centre + hem / 2 - end.x) * t, y: crotchY + d.inseam * t }];
    });
  };
  const front = edges(true), back = edges(false), width = (e: [Pt, Pt][], r: number) => Math.hypot(e[r][1].x - e[r][0].x, e[r][1].y - e[r][0].y);
  // Per row: height, the arc each panel spans (a quarter round the hips, half round a leg), radius and leg centre.
  // Between the hip line and the crotch the centre seams follow a quarter ellipse from the hips down to the crotch
  // point, so the shell passes under a body's seat rather than through it.
  const hipRadius = (width(front, hip) + width(back, hip)) / Math.PI;
  const shape = Array.from({ length: rows + 1 }, (_, r) => {
    const w = width(front, r) + width(back, r);
    const y = r <= hip ? d.length - d.hipDepth * r / hip : r <= upper ? d.length - d.hipDepth - (d.rise - d.hipDepth) * (r - hip) / (upper - hip) : d.inseam * (1 - (r - upper) / lower);
    let span = r <= hip ? Math.PI / 2 : Math.PI;
    if (r > hip && r < upper) {
      // The span whose centre seam stands out by the ellipse's depth here; that depth falls as the span grows.
      const k = (r - hip) / (upper - hip), depth = hipRadius * Math.sqrt(1 - k * k);
      let low = Math.PI / 2, high = Math.PI;
      for (let i = 0; i < 40; i++) { span = (low + high) / 2; if (w / (2 * span) * Math.sin(span) > depth) low = span; else high = span; }
    }
    return { y, span, radius: w / (2 * span), squeeze: 1, centre: 0 };
  });
  // Round legs as wide as the trouser thighs would stand out past the hips, so the legs are narrowed side to side
  // (squeezed) from the hip line down, as far as keeps both legs within the hips' width.
  const legSqueeze = Math.min(1, hipRadius / (2 * shape[upper].radius));
  for (let r = hip; r <= rows; r++) {
    const row = shape[r], crotch = shape[upper];
    if (r <= upper) row.squeeze = Math.min(1, hipRadius / (row.radius * (1 - Math.cos(row.span))));
    else {
      // Below the crotch the legs round out toward the hems, each inseam staying clear of the other leg's.
      const k = (r - upper) / lower;
      row.radius = Math.min(row.radius, crotch.radius);
      row.squeeze = Math.min(legSqueeze + (1 - legSqueeze) * k, legSqueeze * crotch.radius * (1 - 0.3 * k) / row.radius);
    }
    row.centre = r <= upper ? -row.squeeze * row.radius * Math.cos(row.span) : legSqueeze * crotch.radius;
  }
  const point = (r: number, u: number, side: number, leg: number) => {
    const { y, span, radius, squeeze, centre } = shape[r], angle = span * u;
    // The centre seam lies on x = 0 and the inseam on z = 0: snap rounding there so the panels share those points.
    const x = u === 1 && r <= upper ? 0 : centre + squeeze * radius * Math.cos(angle), z = u === 0 || (u === 1 && r >= upper) ? 0 : side * radius * Math.sin(angle);
    return { x: leg * x, y, z };
  };
  const meshes = new Map<PartId, PartMesh>();
  for (const [part, e, side] of [['front', front, 1], ['back', back, -1]] as const) {
    const mesh: PartMesh = { part, positions: [], uvs: [], indices: [] };
    for (const leg of [1, -1]) {
      const base = mesh.positions.length / 3;
      for (let r = 0; r <= rows; r++) for (let c = 0; c <= columns; c++) {
        const u = c / columns, p = point(r, u, side, leg), [left, right] = e[r];
        mesh.positions.push(p.x, p.y, p.z); mesh.uvs.push(left.x + (right.x - left.x) * u, left.y + (right.y - left.y) * u);
        if (r < rows && c < columns) {
          const a = base + r * (columns + 1) + c, b = a + 1, g = a + columns + 1, h = g + 1;
          // Mirrored and back panels keep their faces turned outward.
          mesh.indices.push(...(side * leg > 0 ? [a, b, g, b, h, g] : [a, g, b, b, g, h]));
        }
      }
    }
    meshes.set(part, mesh);
  }
  // The waistband rises from the open waist: left front side to centre to right side, then the back right to left.
  const top = (side: number, leg: number, from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => point(0, (from + Math.sign(to - from) * i) / columns, side, leg));
  const ring = [...top(1, -1, 0, columns), ...top(1, 1, columns - 1, 0), ...top(-1, 1, 1, columns), ...top(-1, -1, columns - 1, 1)];
  const band: PartMesh = { part: 'waistband', positions: [], uvs: [], indices: [] };
  neckRib(band, ring, d.waistbandHeight);
  meshes.set('waistband', band);
  return partsOf(product).map(id => meshes.get(id)!).filter(group => group.indices.length);
}
function area(points: { x: number; y: number }[]) { let s = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
/**
 * A top's front or back body piece in pattern cm (y down from the neck points), in runs: the left neck point, the left
 * armhole from the shoulder point to the underarm, the hem between the side seams, the right armhole from the underarm
 * to the shoulder point, the right neck point and the neckline between the neck points (right to left). The side seams
 * run from the underarm to the hem width; a body cut above a hem band ends `length` down, where they cross the band.
 */
function bodyOutline(product: Product, front: boolean, length: number) {
  const m = topMeasurements(product), panel = panelSize(m), dims = teeDimensions(product), w = panel.width, half = w / 2;
  const shoulderDrop = dims.shoulderDrop, neckWidth = dims.neckHalf, armDepth = dims.armDepth;
  const armY = shoulderDrop + armDepth, inset = (half - dims.hemHalf) * (length - armY) / (panel.length - armY);
  const neckDepth = front ? dims.neckDepthFront : dims.neckDepthBack, shoulder = half - dims.shoulderX, scoop = Math.max(1.5, shoulder + 1.5);
  // A flared (A-line) hem is wider than the chest: shift the piece so it starts at x = 0 like the others.
  const shift = (p: Pt) => ({ x: p.x + flare(product), y: p.y });
  return {
    neckLeft: shift({ x: half - neckWidth, y: 0 }),
    armholeLeft: [{ x: shoulder, y: shoulderDrop }, { x: scoop, y: shoulderDrop + armDepth * 0.55 }, { x: 0, y: armY }].map(shift),
    hem: hemLine(w - 2 * inset, length, dims.hemCurve).map(p => shift({ x: p.x + inset, y: p.y })),
    armholeRight: [{ x: w, y: armY }, { x: w - scoop, y: shoulderDrop + armDepth * 0.55 }, { x: w - shoulder, y: shoulderDrop }].map(shift),
    neckRight: shift({ x: half + neckWidth, y: 0 }),
    // Neckline: a curve for crew/back, a straight V for v-neck fronts.
    neckline: neckPath(neckWidth, neckDepth, front && product.neckline === 'v').slice(1, -1).map(p => shift({ x: half + p.x, y: p.y })),
  };
}

/**
 * A top's sleeve piece in pattern cm: the cap from one underarm point over the top to the other, then the opening from
 * the end of the first underarm seam to the end of the second. A banded sleeve ends above its cuff and is cut 4 cm wider
 * there, for the rib to gather.
 */
function sleeveOutline(product: Product) {
  const m = topMeasurements(product), dims = teeDimensions(product), cap = dims.capWidth, end = sleeveSize(m).length - dims.cuffHeight;
  // The sleeve length runs from the shoulder point, where the top of the cap is sewn, so it includes the cap.
  const capHeight = Math.min(14, m.chest * 0.11, end * 0.6), opening = dims.cuffHalf * 2 + (dims.cuffHeight ? 4 : 0);
  return {
    cap: Array.from({ length: 13 }, (_, i) => { const t = i / 12; return { x: t * cap, y: capHeight * (1 - Math.sin(Math.PI * t)) }; }),
    opening: [{ x: (cap - opening) / 2, y: end }, { x: (cap + opening) / 2, y: end }] as [Pt, Pt],
  };
}

/** Simplified flat pattern pieces (finished size, no seam allowance) in cm, origin at the top-left. */
export function patternPieces(product: Product): PatternPiece[] {
  if (product.base === 'skirt') return skirtPieces(product);
  if (isBottoms(product)) return trouserPieces(product);
  const m = topMeasurements(product), panel = panelSize(m), dims = teeDimensions(product);
  const body = (front: boolean, length = panel.length) => {
    const o = bodyOutline(product, front, length);
    return [o.neckLeft, ...o.armholeLeft, ...o.hem, ...o.armholeRight, o.neckRight, ...o.neckline];
  };
  const sleevePiece = () => { const s = sleeveOutline(product); return [...s.cap, s.opening[1], s.opening[0]]; };
  const rect = (wd: number, ht: number) => [{ x: 0, y: 0 }, { x: wd, y: 0 }, { x: wd, y: ht }, { x: 0, y: ht }];
  // Chest pocket: finished size plus the folded-down facing at the top.
  const chestPocket = () => chestPocketOutline(dims.chestPocketWidth, dims.chestPocketHeight + POCKET_FOLD_CM, 0, 0);
  const make = (part: PartId, outline: { x: number; y: number }[], cutCount: number): PatternPiece => ({
    part, outline, cutCount, width: Math.max(...outline.map(p => p.x)), height: Math.max(...outline.map(p => p.y)), areaCm2: area(outline),
  });
  const modules = optionsOf(product).chestPocket ? [make('chestPocket', chestPocket(), 1)] : [];
  if (product.base === 'tee') {
    return [make('front', body(true), 1), make('back', body(false), 1), make('sleeveLeft', sleevePiece(), 1), make('sleeveRight', sleevePiece(), 1), make('neckband', rect(dims.ribLength, dims.ribHeight * 2), 1), ...modules];
  }
  // Sweatshirts and hoodies: body and sleeves end above rib bands cut on the fold (band height × 2).
  const band = dims.band;
  const pieces = [make('front', body(true, panel.length - band), 1), make('back', body(false, panel.length - band), 1)];
  pieces.push(make('sleeveLeft', sleevePiece(), 1), make('sleeveRight', sleevePiece(), 1));
  if (product.base === 'sweatshirt') pieces.push(make('neckband', rect(dims.ribLength, dims.ribHeight * 2), 1));
  // Rib trims are cut about 15% shorter than the edge they finish so they hug it.
  pieces.push(make('cuffLeft', rect(dims.cuffHalf * 2 * 0.85, dims.cuffHeight * 2), 1), make('cuffRight', rect(dims.cuffHalf * 2 * 0.85, dims.cuffHeight * 2), 1),
    make('hemBand', rect(dims.hemHalf * 2 * 2 * 0.85, band * 2), 1));
  if (product.base === 'hoodie') {
    // Hood side panel (cut 2, mirrored): neck edge along the bottom, face edge on the left, rounded crown and back.
    const H = dims.hoodHeight, W = dims.hoodWidth, hood = [{ x: 0, y: H }, { x: 0, y: 6 }];
    for (let i = 0; i <= 8; i++) { const t = Math.PI / 2 * i / 8; hood.push({ x: W * 0.55 * (1 - Math.cos(t)) + 0, y: 6 * (1 - Math.sin(t)) }); }
    hood.push({ x: W, y: H * 0.45 }, { x: W * 0.9, y: H });
    pieces.push(make('hood', hood.map(p => ({ x: p.x, y: p.y })), 2));
    const top = dims.pocketHalfTop, bottom = dims.pocketHalfBottom, h = 22;
    pieces.push(make('pocket', [{ x: bottom - top + 5, y: 0 }, { x: bottom + top - 5, y: 0 }, { x: bottom * 2, y: h }, { x: 0, y: h }], 1));
  }
  return [...pieces, ...modules];
}

/** The hem from the left side seam to the right one: straight, or a shirttail curve `curve` cm higher at the sides. */
function hemLine(width: number, length: number, curve: number): { x: number; y: number }[] {
  if (!curve) return [{ x: 0, y: length }, { x: width, y: length }];
  return Array.from({ length: 13 }, (_, i) => { const x = width * i / 12, t = (x - width / 2) / (width / 2); return { x, y: length - curve * t * t }; });
}
/** A patch pocket with chamfered lower corners, top-left at (x, y). */
function chestPocketOutline(width: number, height: number, x: number, y: number): { x: number; y: number }[] {
  const c = POCKET_CHAMFER_CM;
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height - c }, { x: x + width - c, y: y + height }, { x: x + c, y: y + height }, { x, y: y + height - c }];
}

// 3D mesh ---------------------------------------------------------------------------------------

export interface PartMesh { part: PartId; positions: number[]; uvs: number[]; indices: number[] }
type Pt = { x: number; y: number };
function inside(p: Pt, polygon: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

type DelaunatorLike = { from(points: number[][]): { triangles: Uint32Array | number[] } };
type P3 = { x: number; y: number; z: number };
/** Largest edge, cm, along the open and sewn edges of a top's 3D pieces. */
const MESH_STEP = 1.5;

/** A polyline with each segment split into equal parts at most `step` long; its own points are kept. */
function densify(points: Pt[], step = MESH_STEP): Pt[] {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step - 1e-9));
    for (let k = 1; k < n; k++) out.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
    out.push(b);
  }
  return out;
}

/** The product's 3D parts: tops sewn from their pattern pieces (topMesh), skirts and trousers from their panels. */
export function teeMesh(product: Product, Delaunator: DelaunatorLike): PartMesh[] {
  if (product.base === 'skirt') return skirtMesh(product);
  if (isBottoms(product)) return trouserMesh(product);
  return topMesh(product, Delaunator);
}

/**
 * A top in 3D, sewn from its pattern pieces. The front and back body pieces are triangulated flat and "inflated" by
 * their distance from the shoulder and side seams, where they meet exactly; the hem, neck and armholes stay open. Each
 * sleeve piece is a tube from its armhole (the front armhole up to the shoulder point, then the back armhole down
 * again) along the sleeve angle to its opening: its cap meets the armhole point for point and its two underarm seams
 * meet each other. Rib cuffs and the hem band continue the sleeve openings and the hem, cut 15% shorter so that they
 * gather them, and the neck rib or hood rises from the neckline. y is up (hem at 0), z toward the viewer and x toward
 * the wearer's left, in cm. UVs are each piece's flat pattern position in cm (mirrored on the back so prints read left
 * to right from behind).
 */
function topMesh(product: Product, Delaunator: DelaunatorLike): PartMesh[] {
  const m = topMeasurements(product), depth = m.chest / (2 * Math.PI) * 0.85, top = m.length, dims = teeDimensions(product);
  const groups = new Map<PartId, PartMesh>();
  for (const id of PART_IDS) groups.set(id, { part: id, positions: [], uvs: [], indices: [] });
  // Body pieces centred: x across from the centre line, y down from the neck points.
  const centre = flare(product) + panelSize(m).width / 2, centred = (p: Pt) => ({ x: p.x - centre, y: p.y });
  const outline = (front: boolean) => {
    const o = bodyOutline(product, front, m.length - dims.band);
    return { neckLeft: centred(o.neckLeft), armholeLeft: densify(o.armholeLeft.map(centred)), hem: densify(o.hem.map(centred)),
      armholeRight: densify(o.armholeRight.map(centred)), neck: densify([o.neckRight, ...o.neckline, o.neckLeft].map(centred)) };
  };
  const front = outline(true), back = outline(false);
  // The shoulder and side seams, which the front and back share.
  const seams: [Pt, Pt][] = [[front.neckLeft, front.armholeLeft[0]], [front.armholeRight.at(-1)!, front.neck[0]],
    [front.armholeLeft.at(-1)!, front.hem[0]], [front.hem.at(-1)!, front.armholeRight[0]]];
  // Rounding-level distances are on a seam: snap them so the front and back coincide exactly there.
  const rise = (p: Pt) => { const d = Math.min(depth, ...seams.map(([a, b]) => segmentDistance(p, a, b))); return d < 1e-6 ? 0 : depth * Math.sqrt(1 - (1 - d / depth) ** 2); };
  const shell = (p: Pt, sign: number): P3 => ({ x: p.x, y: top - p.y, z: sign * rise(p) });
  for (const [side, o] of [['front', front], ['back', back]] as const) {
    const sign = side === 'front' ? 1 : -1;
    fillRegion(groups.get(side)!, [o.neckLeft, ...o.armholeLeft, ...o.hem, ...o.armholeRight, ...o.neck.slice(0, -1)], Delaunator, p => sign * rise(p), top, side);
  }
  if (product.base === 'hoodie') {
    // The kangaroo pocket sits just above the hem band, slightly proud of the front body.
    const y0 = dims.pocketTop, y1 = m.length - dims.band - 0.01;
    fillRegion(groups.get('pocket')!, [{ x: dims.pocketHalfTop, y: y0 }, { x: dims.pocketHalfBottom, y: y1 }, { x: -dims.pocketHalfBottom, y: y1 }, { x: -dims.pocketHalfTop, y: y0 }],
      Delaunator, p => rise(p) + 0.5, top, 'front');
  }
  if (optionsOf(product).chestPocket) {
    fillRegion(groups.get('chestPocket')!, chestPocketOutline(dims.chestPocketWidth, dims.chestPocketHeight, dims.chestPocketX - dims.chestPocketWidth / 2, dims.chestPocketY),
      Delaunator, p => rise(p) + 0.35, top, 'front');
  }
  // Sleeves, posed along the sleeve angle like the body's arms; flat directions have y down.
  const sleeve = sleeveOutline(product), angle = dims.sleeveAngle * Math.PI / 180, along = { x: Math.cos(angle), y: Math.sin(angle) }, across = { x: -Math.sin(angle), y: Math.cos(angle) };
  const length = sleeve.opening[0].y, opening = sleeve.opening[1].x - sleeve.opening[0].x, radius = opening / (2 * Math.PI);
  for (const [part, cuff, x, frontArmhole, backArmhole] of [
    ['sleeveLeft', 'cuffLeft', 1, front.armholeRight, back.armholeRight],
    ['sleeveRight', 'cuffRight', -1, [...front.armholeLeft].reverse(), [...back.armholeLeft].reverse()],
  ] as const) {
    // Underarm to shoulder point on the front, then back down to the underarm.
    const loop = [...frontArmhole.map(p => shell(p, 1)), ...[...backArmhole].reverse().slice(1).map(p => shell(p, -1))], columns = loop.length - 1;
    // The opening: a ring round the sleeve's centre line, which starts at the shoulder point, its underarm point
    // nearest the body and its top on that line.
    const ring = (distance: number, r: number) => {
      const c = { x: dims.shoulderX + along.x * distance + across.x * r, y: dims.shoulderDrop + along.y * distance + across.y * r };
      return loop.map((_, k): P3 => {
        // The last column is the first again, exactly, so the underarm seam closes.
        const theta = 2 * Math.PI * (k % columns) / columns;
        return { x: x * (c.x + across.x * r * Math.cos(theta)), y: top - c.y - across.y * r * Math.cos(theta), z: r * Math.sin(theta) };
      });
    };
    const end = ring(length, radius), rows = Math.max(2, Math.ceil(length / 2));
    const capAt = (k: number) => alongPolyline(sleeve.cap, k / columns);
    tube(groups.get(part)!, rows, columns, k => [loop[k], end[k]], (k, v) => {
      const a = capAt(k), b = { x: sleeve.opening[0].x + opening * k / columns, y: sleeve.opening[0].y };
      return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
    });
    if (dims.cuffHeight) {
      // Rib cuffs are cut about 15% shorter than the sleeve opening they finish.
      const width = dims.cuffHalf * 2 * 0.85, rib = ring(length + dims.cuffHeight, width / (2 * Math.PI));
      tube(groups.get(cuff)!, Math.max(2, Math.ceil(dims.cuffHeight / MESH_STEP)), columns, k => [end[k], rib[k]], (k, v) => ({ x: width * k / columns, y: dims.cuffHeight * v }));
    }
  }
  if (dims.band) {
    // The hem band: round the open hem, front left to right, then back right to left, hanging straight down.
    const flat = [...front.hem, ...[...back.hem].reverse().slice(1)], hem = flat.map((p, k) => shell(p, k < front.hem.length ? 1 : -1)), cut = [0];
    // The band is cut 15% shorter than the hem it finishes.
    for (let k = 1; k < flat.length; k++) cut.push(cut[k - 1] + Math.hypot(flat[k].x - flat[k - 1].x, flat[k].y - flat[k - 1].y) * 0.85);
    tube(groups.get('hemBand')!, Math.max(2, Math.ceil(dims.band / MESH_STEP)), flat.length - 1, k => [hem[k], { ...hem[k], y: hem[k].y - dims.band }], (k, v) => ({ x: cut[k], y: dims.band * v }));
  }
  // The open neck edge, front curve (left to right) then back curve (right to left).
  const neck = [...[...front.neck].reverse().map(p => shell(p, 1)), ...back.neck.map(p => shell(p, -1))];
  if (product.base === 'hoodie') hoodMesh(groups.get('hood')!, neck, new Set(front.neck.map((_, i) => i)), dims);
  else neckRib(groups.get('neckband')!, neck, dims.ribHeight);
  return partsOf(product).map(id => groups.get(id)!).filter(group => group.indices.length);
}

/**
 * A tube of `rows` rows into `mesh` between the two ends `ends(k)` of each column k (its first and last columns meet),
 * with flat pattern positions `flat(k, v)` at v from 0 to 1 along it. Faces are wound outward, away from its centre line.
 */
function tube(mesh: PartMesh, rows: number, columns: number, ends: (k: number) => [P3, P3], flat: (k: number, v: number) => Pt) {
  const base = mesh.positions.length / 3, at = (r: number, k: number) => base + r * (columns + 1) + k;
  for (let r = 0; r <= rows; r++) for (let k = 0; k <= columns; k++) {
    const v = r / rows, [a, b] = ends(k), f = flat(k, v);
    mesh.positions.push(a.x + (b.x - a.x) * v, a.y + (b.y - a.y) * v, a.z + (b.z - a.z) * v);
    mesh.uvs.push(f.x, f.y);
  }
  const point = (i: number) => ({ x: mesh.positions[i * 3], y: mesh.positions[i * 3 + 1], z: mesh.positions[i * 3 + 2] });
  // Which way round is outward, from one quad halfway along: its normal against its offset from the row's centre.
  const r = Math.floor(rows / 2), k = Math.floor(columns / 4), a = point(at(r, k)), b = point(at(r, k + 1)), c = point(at(r + 1, k)), middle = { x: 0, y: 0, z: 0 };
  for (let j = 0; j < columns; j++) { const q = point(at(r, j)); middle.x += q.x / columns; middle.y += q.y / columns; middle.z += q.z / columns; }
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  const outward = (uy * vz - uz * vy) * (a.x - middle.x) + (uz * vx - ux * vz) * (a.y - middle.y) + (ux * vy - uy * vx) * (a.z - middle.z) > 0;
  for (let r = 0; r < rows; r++) for (let k = 0; k < columns; k++) {
    const p = at(r, k), q = at(r, k + 1), s = at(r + 1, k), t = at(r + 1, k + 1);
    mesh.indices.push(...(outward ? [p, q, s, q, t, s] : [p, s, q, q, s, t]));
  }
}
/**
 * Triangulates a flat region (boundary samples every 1.5 cm plus a 2 cm interior grid) into `group`: x stays, y is
 * flipped so the hem sits at 0 below `top`, z comes from `z`, and UVs are flat cm (mirrored on the back so prints
 * read left to right from behind).
 */
function fillRegion(group: PartMesh, polygon: Pt[], Delaunator: DelaunatorLike, z: (p: Pt) => number, top: number, side: 'front' | 'back') {
  const samples: Pt[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / MESH_STEP - 1e-9));
    for (let k = 0; k < n; k++) samples.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y), boundary = samples.length;
  for (let y = Math.min(...ys) + 1; y < Math.max(...ys); y += 2) for (let x = Math.min(...xs) + 1; x < Math.max(...xs); x += 2) {
    const p = { x, y };
    if (inside(p, polygon) && samples.slice(0, boundary).every(q => Math.hypot(q.x - x, q.y - y) > 0.9)) samples.push(p);
  }
  const triangles = Delaunator.from(samples.map(p => [p.x, p.y])).triangles, ids = new Map<number, number>();
  const vertex = (index: number) => {
    let id = ids.get(index);
    if (id === undefined) {
      const p = samples[index]; id = group.positions.length / 3; ids.set(index, id);
      group.positions.push(p.x, top - p.y, z(p));
      group.uvs.push(side === 'front' ? p.x : -p.x, p.y);
    }
    return id;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const tri = [triangles[t], triangles[t + 1], triangles[t + 2]], pts = tri.map(i => samples[i]);
    if (!inside({ x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3 }, polygon)) continue;
    // Inspect winding in flat coordinates; mapping y downward to world y upward reverses its sign.
    const cross = (pts[1].x - pts[0].x) * (pts[2].y - pts[0].y) - (pts[1].y - pts[0].y) * (pts[2].x - pts[0].x);
    if (Math.abs(cross) < 1e-9) continue;
    const [a, b, d] = tri.map(vertex);
    if ((side === 'front') === (cross < 0)) group.indices.push(a, b, d); else group.indices.push(a, d, b);
  }
}

/** Neck rib: a band rising from the open neck edge. */
function neckRib(rib: PartMesh, ring: { x: number; y: number; z: number }[], width: number) {
  let along = 0;
  ring.forEach((p, i) => {
    if (i) along += Math.hypot(p.x - ring[i - 1].x, p.y - ring[i - 1].y, p.z - ring[i - 1].z);
    rib.positions.push(p.x, p.y, p.z, p.x * 1.03, p.y + width, p.z * 1.03); rib.uvs.push(along, 0, along, width);
    if (i) { const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1; rib.indices.push(a, c, b, b, c, d); }
  });
  { const last = (ring.length - 1) * 2; rib.indices.push(last, 0, last + 1, last + 1, 0, 1); }
}

/**
 * Hood: a shell lofted from the sides and back of the neck edge up to a closed crown. The middle of the front
 * neck stays open as the face opening. Rows ease from the neck curve toward a head-sized ellipse set slightly back.
 */
function hoodMesh(hood: PartMesh, ring: { x: number; y: number; z: number }[], front: ReadonlySet<number>,
  dims: { neckHalf: number; hoodHeight: number; hoodWidth: number; hoodHalf: number }) {
  const open = dims.neckHalf * 0.55;
  const frontRight = ring.filter((p, i) => front.has(i) && p.x >= open), back = ring.filter((_, i) => !front.has(i)), frontLeft = ring.filter((p, i) => front.has(i) && p.x <= -open);
  const base = [...frontRight, ...back, ...frontLeft], rows = 16;
  const along: number[] = [0];
  for (let i = 1; i < base.length; i++) along.push(along[i - 1] + Math.hypot(base[i].x - base[i - 1].x, base[i].z - base[i - 1].z));
  // Columns go round the head from one side of the face opening, over the back, to the other side.
  const opening = 0.32 * Math.PI, total = along.at(-1) || 1;
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, ease = 1 - (1 - t) ** 2.4;
    // Toward the crown the two sides close onto the centre seam: x narrows, front-to-back depth stays.
    const crown = t < 0.6 ? 1 : Math.cos(((t - 0.6) / 0.4) * Math.PI / 2), rise = dims.hoodHeight * t + (t > 0.6 ? 3 * Math.sin(((t - 0.6) / 0.4) * Math.PI / 2) : 0);
    for (let i = 0; i < base.length; i++) {
      const b = base[i], theta = opening + (2 * Math.PI - 2 * opening) * along[i] / total;
      const dome = { x: dims.hoodHalf * Math.sin(theta), z: -5 + 14 * (dims.hoodWidth / 26) * Math.cos(theta) };
      const x = (b.x + (dome.x - b.x) * ease) * crown, z = b.z + (dome.z - b.z) * ease;
      hood.positions.push(x, b.y + rise, z);
      hood.uvs.push(along[i], dims.hoodHeight * t);
    }
  }
  const columns = base.length;
  for (let j = 0; j < rows; j++) for (let i = 0; i + 1 < columns; i++) {
    const a = j * columns + i, b = a + 1, c = a + columns, d = c + 1;
    hood.indices.push(a, b, c, b, d, c);
  }
}
