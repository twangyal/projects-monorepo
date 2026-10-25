import { validateRasterHeader } from './media.ts';
// Product designs: a base garment built from named parts, each styled with a fabric, color and optional
// repeat print, plus placed artwork. Pure data, geometry and validation; rendering lives in product-3d.ts.

/** Base products. Each declares the parts a design styles; the 3D shell, pattern and tech pack follow them. */
export const BASES = ['tee', 'sweatshirt', 'hoodie', 'trousers'] as const;
export type Base = typeof BASES[number];
export const BASE_NAMES: Record<Base, string> = { tee: 'T-shirt', sweatshirt: 'Crew sweatshirt', hoodie: 'Pullover hoodie', trousers: 'Pull-on trousers' };
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
};
/** A part's display name on this design: the front and back of shorts and trousers are leg panels. */
export function partName(product: Pick<Product, 'base'>, part: PartId): string {
  if (isBottoms(product) && (part === 'front' || part === 'back')) return part === 'front' ? 'Front legs' : 'Back legs';
  return PART_NAMES[part];
}
/** Bottoms take leg measurements (waist, hip, rise, inseam, leg opening) instead of chest, length and sleeve. */
export function isBottoms(product: Pick<Product, 'base'>): boolean { return product.base === 'trousers'; }
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

export interface Material { id: string; name: string; composition: string; gsm: number; texture: 'jersey' | 'rib' | 'pique' | 'slub' | 'terry' | 'linen' | 'twill' | 'canvas'; tileCm: number; sheen: number }
export const MATERIALS: readonly Material[] = [
  { id: 'jersey-180', name: 'Cotton jersey', composition: '100% cotton, single jersey', gsm: 180, texture: 'jersey', tileCm: 1.2, sheen: 0.05 },
  { id: 'jersey-240', name: 'Heavyweight jersey', composition: '100% cotton, single jersey', gsm: 240, texture: 'jersey', tileCm: 1.6, sheen: 0.04 },
  { id: 'slub-160', name: 'Slub jersey', composition: '100% cotton, slub yarn', gsm: 160, texture: 'slub', tileCm: 6, sheen: 0.05 },
  { id: 'rib-220', name: '1×1 rib knit', composition: '95% cotton, 5% elastane', gsm: 220, texture: 'rib', tileCm: 1, sheen: 0.06 },
  { id: 'pique-200', name: 'Cotton piqué', composition: '100% cotton, piqué knit', gsm: 200, texture: 'pique', tileCm: 1.2, sheen: 0.05 },
  { id: 'terry-300', name: 'French terry', composition: '80% cotton, 20% polyester', gsm: 300, texture: 'terry', tileCm: 2, sheen: 0.03 },
  { id: 'linen-170', name: 'Linen', composition: '100% linen, plain weave', gsm: 170, texture: 'linen', tileCm: 4, sheen: 0.08 },
  { id: 'denim-340', name: 'Denim twill', composition: '100% cotton, 3×1 twill', gsm: 340, texture: 'twill', tileCm: 2, sheen: 0.07 },
];
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
  /** Tops take Measurements; bottoms (isBottoms) take LegMeasurements. Bottoms keep a 'crew' neckline value. */
  base: Base; name: string; measurements: Measurements | LegMeasurements; neckline: 'crew' | 'v';
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
  return isBottoms(product) ? fail('Shorts and trousers use leg measurements.') : product.measurements as Measurements;
}
/** Shorts' and trousers' leg measurements. */
export function legMeasurements(product: Pick<Product, 'base' | 'measurements'>): LegMeasurements {
  return isBottoms(product) ? product.measurements as LegMeasurements : fail('Only shorts and trousers have leg measurements.');
}

export function material(id: string): Material { return MATERIALS.find(item => item.id === id) ?? fail('Choose a fabric from the library.'); }

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
  let measurements: Measurements | LegMeasurements;
  if (base === 'trousers') {
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
  if (base === 'trousers' && p.neckline !== 'crew') fail('Shorts and trousers have no neckline.');
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
    if (base === 'trousers') fail('Fit measurements are for tops; shorts and trousers use their leg measurements.');
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
  if (base === 'trousers' && (p.artwork as unknown[]).length) fail('Artwork placement is available on tops.');
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
  if (product.fit?.cuffHeight !== undefined) {
    const c = teeSilhouette(product as Product, 'front').points;
    const edge = (a: number, b: number) => Math.hypot(c[a].x - c[b].x, c[a].y - c[b].y);
    if (Math.min(edge(2, 1), edge(3, 4)) - d.cuffHeight < 2) fail('The cuff must leave at least 2 cm along both actual sleeve edges.');
  }
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

/**
 * The flat front (and back) of shorts or trousers in cm, x across from the centre and y down from the waist: the
 * gathered waist, hips, two legs and the crotch point between them. Side seams and inseams join front to back;
 * the waist and the leg hems stay open.
 */
export function trouserSilhouette(product: Product): Silhouette {
  const d = trouserDimensions(product), half = d.legOpening / 4, centre = Math.max(d.hipHalf * 0.5 + 2.5, half + 1);
  const side: Pt[] = [];
  for (let i = 0; i <= 4; i++) { const t = i / 4; side.push({ x: d.waistHalf + (d.hipHalf - d.waistHalf) * Math.sin(t * Math.PI / 2), y: d.hipDepth * t }); }
  side.push({ x: d.hipHalf, y: d.rise });
  const mirror = (p: Pt) => ({ x: -p.x, y: p.y });
  const right = [...side, { x: centre + half, y: d.length }, { x: centre - half, y: d.length }];
  const points = [...right, { x: 0, y: d.rise }, ...right.map(mirror).reverse()];
  // Edge i runs from point i to i + 1: side seams and inseams are joined; the hems and the waist (last edge) are open.
  const n = side.length, pinned = points.map((_, i) => i !== n && i !== points.length - n - 2 && i !== points.length - 1);
  return { points, pinned, neck: points.map(() => false), armholes: [] };
}

function trouserMesh(product: Product, Delaunator: DelaunatorLike): PartMesh[] {
  const d = trouserDimensions(product), depth = d.hip / (2 * Math.PI) * 0.85, s = trouserSilhouette(product);
  const groups = new Map<PartId, PartMesh>(PART_IDS.map(id => [id, { part: id, positions: [], uvs: [], indices: [] }]));
  const height = (p: Pt, sign: number) => { const dist = Math.min(seamDistance(p, s), depth); return dist < 1e-6 ? 0 : sign * depth * Math.sqrt(1 - (1 - dist / depth) ** 2); };
  for (const side of ['front', 'back'] as const) fillRegion(groups.get(side)!, s.points, Delaunator, p => height(p, side === 'front' ? 1 : -1), d.length, side);
  // The waistband rises from the open waist edge: front left to right, then back right to left.
  const ring: { x: number; y: number; z: number }[] = [];
  for (const sign of [1, -1]) for (let i = 0; i <= 16; i++) {
    const x = sign * (-d.waistHalf + 2 * d.waistHalf * i / 16);
    ring.push({ x, y: d.length, z: height({ x, y: 0 }, sign) });
  }
  neckRib(groups.get('waistband')!, ring, d.waistbandHeight);
  return partsOf(product).map(id => groups.get(id)!).filter(group => group.indices.length);
}
function area(points: { x: number; y: number }[]) { let s = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
/** Simplified flat pattern pieces (finished size, no seam allowance) in cm, origin at the top-left. */
export function patternPieces(product: Product): PatternPiece[] {
  if (isBottoms(product)) return trouserPieces(product);
  const m = topMeasurements(product), panel = panelSize(m), sleeve = sleeveSize(m);
  const dims = teeDimensions(product), w = panel.width, half = w / 2, shoulderDrop = dims.shoulderDrop, neckWidth = dims.neckHalf, armDepth = dims.armDepth;
  // The side seams run from the underarm to the hem width; a body cut above a hem band ends where they cross the band.
  const armY = shoulderDrop + armDepth, hemInset = (y: number) => (half - dims.hemHalf) * (y - armY) / (panel.length - armY);
  const body = (front: boolean, length = panel.length) => {
    const neckDepth = front ? dims.neckDepthFront : dims.neckDepthBack, inset = hemInset(length), shoulder = half - dims.shoulderX;
    const hem = hemLine(w - 2 * inset, length, dims.hemCurve).map(p => ({ x: p.x + inset, y: p.y }));
    const scoop = Math.max(1.5, shoulder + 1.5);
    const pts = [{ x: half - neckWidth, y: 0 }, { x: shoulder, y: shoulderDrop }, { x: scoop, y: shoulderDrop + armDepth * 0.55 }, { x: 0, y: armY },
      ...hem, { x: w, y: armY }, { x: w - scoop, y: shoulderDrop + armDepth * 0.55 }, { x: w - shoulder, y: shoulderDrop }, { x: half + neckWidth, y: 0 }];
    // Neckline: a curve for crew/back, a straight V for v-neck fronts.
    pts.push(...neckPath(neckWidth, neckDepth, front && product.neckline === 'v').slice(1, -1).map(p => ({ x: half + p.x, y: p.y })));
    // A flared (A-line) hem is wider than the chest: shift the piece so it starts at x = 0 like the others.
    return pts.map(p => ({ x: p.x + flare(product), y: p.y }));
  };
  const sleevePiece = () => {
    const cap = dims.capWidth, cuff = dims.cuffHalf * 2, capHeight = Math.min(14, m.chest * 0.11), pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push({ x: t * cap, y: capHeight * (1 - Math.sin(Math.PI * t)) }); }
    pts.push({ x: (cap + cuff) / 2, y: capHeight + sleeve.length }, { x: (cap - cuff) / 2, y: capHeight + sleeve.length });
    return pts;
  };
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
  const capHeight = Math.min(14, m.chest * 0.11), sleeveOutline = () => {
    const cap = dims.capWidth, cuff = dims.cuffHalf * 2 + 4, pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push({ x: t * cap, y: capHeight * (1 - Math.sin(Math.PI * t)) }); }
    pts.push({ x: (cap + cuff) / 2, y: capHeight + sleeve.length - dims.cuffHeight }, { x: (cap - cuff) / 2, y: capHeight + sleeve.length - dims.cuffHeight });
    return pts;
  };
  pieces.push(make('sleeveLeft', sleeveOutline(), 1), make('sleeveRight', sleeveOutline(), 1));
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
interface Silhouette { points: Pt[]; pinned: boolean[]; neck: boolean[]; armholes: [Pt, Pt][] }

/**
 * The tee's flat front (or back) silhouette in cm, x across from the centre and y down from the shoulder line:
 * shoulders, sleeves angled down, side seams, hem and neckline. `pinned` marks seam edges where the front and
 * back meet (shoulders, sleeve edges, sides); the hem, cuffs and neck stay open. `armholes` are the sleeve seams.
 */
export function teeSilhouette(product: Product, side: 'front' | 'back'): Silhouette {
  const m = topMeasurements(product), half = panelSize(m).width / 2;
  const { neckHalf, shoulderX, shoulderDrop, armDepth } = teeDimensions(product);
  const angle = teeDimensions(product).sleeveAngle * Math.PI / 180, dir = { x: Math.cos(angle), y: Math.sin(angle) }, perp = { x: -Math.sin(angle), y: Math.cos(angle) };
  const shoulder = { x: shoulderX, y: shoulderDrop }, underarm = { x: half, y: shoulderDrop + armDepth };
  const cuffHalf = teeDimensions(product).cuffHalf, top = { x: shoulder.x + dir.x * m.sleeve, y: shoulder.y + dir.y * m.sleeve };
  const bottom = { x: top.x + perp.x * cuffHalf, y: top.y + perp.y * cuffHalf };
  const neckDepth = side === 'front' ? teeDimensions(product).neckDepthFront : teeDimensions(product).neckDepthBack;
  const mirror = (p: Pt) => ({ x: -p.x, y: p.y });
  const neckPoint = { x: neckHalf, y: 0 }, hem = { x: teeDimensions(product).hemHalf, y: m.length - teeDimensions(product).hemCurve };
  // Corners clockwise from the right neck point; edge i runs from corner i to corner i+1.
  const corners = [neckPoint, shoulder, top, bottom, underarm, hem, mirror(hem), mirror(underarm), mirror(bottom), mirror(top), mirror(shoulder), mirror(neckPoint)];
  //            shoulder  sleeve-top cuff   sleeve-bottom side  hem    side  sleeve-bottom cuff  sleeve-top shoulder neck
  const seams = [true,     true,      false, true,         true,  false, true, true,         false, true,      true,    false];
  const points: Pt[] = [...corners], pinned = [...seams], neck: boolean[] = seams.map((_, i) => i === 11);
  // The neckline runs from the left neck point back to the right one.
  for (let k = 1; k < 10; k++) {
    const x = -neckHalf + 2 * neckHalf * k / 10;
    const y = product.neckline === 'v' && side === 'front' ? neckDepth * (1 - Math.abs(x) / neckHalf) : neckDepth * Math.sqrt(Math.max(0, 1 - (x / neckHalf) ** 2));
    points.push({ x, y }); pinned.push(false); neck.push(true);
  }
  return { points, pinned, neck, armholes: [[shoulder, underarm], [{ x: -shoulder.x, y: shoulder.y }, { x: -underarm.x, y: underarm.y }]] };
}

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

/** Distance from the seams the front and back are joined along. */
function seamDistance(p: Pt, s: Silhouette): number {
  let best = Infinity;
  for (let i = 0; i < s.points.length; i++) if (s.pinned[i]) best = Math.min(best, segmentDistance(p, s.points[i], s.points[(i + 1) % s.points.length]));
  return best;
}

/**
 * A styling surface built from the flat silhouettes: each side is triangulated and "inflated" by its distance
 * from the joined seams, so the front and back meet exactly along the shoulders, sleeves and sides while the
 * hem, cuffs and neck stay open. y is up (hem at 0), z toward the viewer, units cm. UVs are flat cm.
 */
export function teeMesh(product: Product, Delaunator: { from(points: number[][]): { triangles: Uint32Array | number[] } }): PartMesh[] {
  if (isBottoms(product)) return trouserMesh(product, Delaunator);
  const m = topMeasurements(product), depth = m.chest / (2 * Math.PI) * 0.85, top = m.length, dims = teeDimensions(product);
  const groups = new Map<PartId, PartMesh>();
  for (const id of PART_IDS) groups.set(id, { part: id, positions: [], uvs: [], indices: [] });
  for (const side of ['front', 'back'] as const) {
    const s = teeSilhouette(product, side), sign = side === 'front' ? 1 : -1, c = s.points;
    // Rounding-level distances are on the seam: snap them so front and back coincide exactly there.
    const height = (p: Pt) => { const d = Math.min(seamDistance(p, s), depth); return d < 1e-6 ? 0 : sign * depth * Math.sqrt(1 - (1 - d / depth) ** 2); };
    // Regions share their armhole edges exactly, so the sleeve seams join without gaps.
    // Corner indices: 0 neck, 1 shoulder, 2 sleeve top, 3 cuff bottom, 4 underarm, 5 hem (and mirrored 6–11).
    // A curved hem dips from the side seams to the centre: points between the hem corners (right to left).
    const hem = dims.hemCurve ? hemLine(dims.hemHalf * 2, m.length, dims.hemCurve).slice(1, -1).reverse().map(p => ({ x: p.x - dims.hemHalf, y: p.y })) : [];
    let regions: { part: PartId; polygon: Pt[] }[] = [
      { part: side, polygon: [c[0], c[1], c[4], c[5], ...hem, c[6], c[7], c[10], ...c.slice(11)] },
      { part: 'sleeveLeft', polygon: [c[1], c[2], c[3], c[4]] },
      { part: 'sleeveRight', polygon: [c[7], c[8], c[9], c[10]] },
    ];
    if (dims.band) {
      // Rib bands: the body ends above the hem band and each sleeve above its cuff. Split points lie on the
      // silhouette's own edges, so the shell's seams are unchanged and neighbouring regions share edges.
      const toward = (from: Pt, to: Pt, distance: number) => { const length = Math.hypot(to.x - from.x, to.y - from.y); return { x: from.x + (to.x - from.x) * distance / length, y: from.y + (to.y - from.y) * distance / length }; };
      // The band's top corners lie on the (possibly slanted) side seams.
      const onSide = (a: Pt, b: Pt, y: number) => ({ x: a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y), y });
      const bandTop = m.length - dims.band, right = onSide(c[4], c[5], bandTop), left = onSide(c[7], c[6], bandTop);
      const leftTop = toward(c[2], c[1], dims.cuffHeight), leftBottom = toward(c[3], c[4], dims.cuffHeight);
      const rightTop = toward(c[9], c[10], dims.cuffHeight), rightBottom = toward(c[8], c[7], dims.cuffHeight);
      regions = [
        { part: side, polygon: [c[0], c[1], c[4], right, left, c[7], c[10], ...c.slice(11)] },
        { part: 'hemBand', polygon: [right, c[5], c[6], left] },
        { part: 'sleeveLeft', polygon: [c[1], leftTop, leftBottom, c[4]] },
        { part: 'cuffLeft', polygon: [leftTop, c[2], c[3], leftBottom] },
        { part: 'sleeveRight', polygon: [c[7], rightBottom, rightTop, c[10]] },
        { part: 'cuffRight', polygon: [rightBottom, c[8], c[9], rightTop] },
      ];
    }
    if (side === 'front' && product.base === 'hoodie') {
      // The kangaroo pocket sits just above the hem band, slightly proud of the front body.
      const y0 = dims.pocketTop, y1 = m.length - dims.band - 0.01;
      regions.push({ part: 'pocket', polygon: [{ x: dims.pocketHalfTop, y: y0 }, { x: dims.pocketHalfBottom, y: y1 }, { x: -dims.pocketHalfBottom, y: y1 }, { x: -dims.pocketHalfTop, y: y0 }] });
    }
    if (side === 'front' && optionsOf(product).chestPocket) {
      regions.push({ part: 'chestPocket', polygon: chestPocketOutline(dims.chestPocketWidth, dims.chestPocketHeight, dims.chestPocketX - dims.chestPocketWidth / 2, dims.chestPocketY) });
    }
    for (const { part, polygon } of regions) {
      const lift = part === 'pocket' ? 0.5 : part === 'chestPocket' ? 0.35 : 0;
      fillRegion(groups.get(part)!, polygon, Delaunator, p => height(p) + lift, top, side);
    }
  }
  // The open neck edge, front curve (left to right) then back curve (right to left).
  const ring: { x: number; y: number; z: number }[] = [], fronts: number[] = [];
  for (const side of ['front', 'back'] as const) {
    const s = teeSilhouette(product, side), sign = side === 'front' ? 1 : -1;
    const neckPoints = s.points.filter((_, i) => s.neck[i] || s.neck[(i - 1 + s.points.length) % s.points.length]).sort((a, b) => a.x - b.x);
    const ordered = side === 'front' ? neckPoints : [...neckPoints].reverse();
    for (const p of ordered) { const d = Math.min(seamDistance(p, s), depth); if (side === 'front') fronts.push(ring.length); ring.push({ x: p.x, y: top - p.y, z: d < 1e-6 ? 0 : sign * depth * Math.sqrt(1 - (1 - d / depth) ** 2) }); }
  }
  if (product.base === 'hoodie') hoodMesh(groups.get('hood')!, ring, new Set(fronts), dims);
  else neckRib(groups.get('neckband')!, ring, dims.ribHeight);
  return partsOf(product).map(id => groups.get(id)!).filter(group => group.indices.length);
}

type DelaunatorLike = { from(points: number[][]): { triangles: Uint32Array | number[] } };
/**
 * Triangulates a flat region (boundary samples every 1.5 cm plus a 2 cm interior grid) into `group`: x stays, y is
 * flipped so the hem sits at 0 below `top`, z comes from `z`, and UVs are flat cm (mirrored on the back so prints
 * read left to right from behind).
 */
function fillRegion(group: PartMesh, polygon: Pt[], Delaunator: DelaunatorLike, z: (p: Pt) => number, top: number, side: 'front' | 'back') {
  const samples: Pt[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
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
