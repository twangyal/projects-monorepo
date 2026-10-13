// Product designs: a base garment built from named parts, each styled with a fabric, color and optional
// repeat print, plus placed artwork. Pure data, geometry and validation; rendering lives in product-3d.ts.

export const PART_IDS = ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband'] as const;
export type PartId = typeof PART_IDS[number];
export const PART_NAMES: Record<PartId, string> = { front: 'Front body', back: 'Back body', sleeveLeft: 'Left sleeve', sleeveRight: 'Right sleeve', neckband: 'Neck rib' };

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
export interface Print { motif: PrintMotif; color: string; scaleCm: number; layout: Layout }
/** A designer's own motif image, repeated like library motifs (drawn as uploaded; print color does not tint it). */
export interface UploadedMotif { id: string; name: string; dataUrl: string; width: number; height: number }
export interface PartStyle { material: string; color: string; print: Print | null }
export interface Artwork { part: 'front' | 'back'; dataUrl: string; width: number; height: number; name: string; xCm: number; yCm: number; widthCm: number }
export interface Measurements { chest: number; length: number; sleeve: number }
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
  base: 'tee'; name: string; measurements: Measurements; neckline: 'crew' | 'v';
  parts: Record<PartId, PartStyle>; artwork: Artwork[];
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
  chest: [80, 150], length: [55, 90], sleeve: [10, 65], scaleCm: [2, 40], artworkWidthCm: [3, 40], artworkBytes: 1_500_000, name: 80,
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

export function material(id: string): Material { return MATERIALS.find(item => item.id === id) ?? fail('Choose a fabric from the library.'); }

function validatePrint(value: unknown, uploaded: ReadonlySet<string>): Print | null {
  if (value === null) return null;
  const p = plain(value, ['motif', 'color', 'scaleCm', 'layout'], 'Print');
  const upload = typeof p.motif === 'string' && p.motif.startsWith('upload:') ? p.motif.slice(7) : null;
  if (upload !== null ? !uploaded.has(upload) : !MOTIFS.includes(p.motif as Motif)) fail('Choose a print from the library or an uploaded motif.');
  if (!LAYOUTS.includes(p.layout as Layout)) fail('Print repeat must be standard, half drop, half brick or mirror.');
  return { motif: p.motif as PrintMotif, color: hex(p.color, 'Print color'), scaleCm: finite(p.scaleCm, LIMITS.scaleCm, 'Print repeat size (cm)'), layout: p.layout as Layout };
}
function validateArtwork(value: unknown, measurements: Measurements): Artwork {
  const a = plain(value, ['part', 'dataUrl', 'width', 'height', 'name', 'xCm', 'yCm', 'widthCm'], 'Artwork');
  if (a.part !== 'front' && a.part !== 'back') fail('Artwork goes on the front or back.');
  if (typeof a.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(a.dataUrl) || a.dataUrl.length > LIMITS.artworkBytes * 1.4) fail('Artwork must be a PNG, JPEG or WebP image of at most 1.5 MB.');
  const width = finite(a.width, [1, 4096], 'Artwork pixel width'), height = finite(a.height, [1, 4096], 'Artwork pixel height');
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail('Artwork pixel size must be whole numbers.');
  if (typeof a.name !== 'string' || a.name.length > 120) fail('Artwork name must be at most 120 characters.');
  const panel = panelSize(measurements);
  const widthCm = finite(a.widthCm, LIMITS.artworkWidthCm, 'Artwork width (cm)');
  return { part: a.part as Artwork['part'], dataUrl: a.dataUrl as string, width, height, name: a.name as string, xCm: finite(a.xCm, [-panel.width / 2, panel.width / 2], 'Artwork horizontal position (cm)'),
    yCm: finite(a.yCm, [0, panel.length], 'Artwork distance below the neck (cm)'), widthCm };
}

function validateParts(value: unknown, uploaded: ReadonlySet<string>): Record<PartId, PartStyle> {
  const rawParts = plain(value, PART_IDS, 'Parts');
  return Object.fromEntries(PART_IDS.map(id => {
    const s = plain(rawParts[id], ['material', 'color', 'print'], PART_NAMES[id]);
    if (typeof s.material !== 'string') fail('Choose a fabric from the library.');
    material(s.material as string);
    return [id, { material: s.material as string, color: hex(s.color, `${PART_NAMES[id]} color`), print: validatePrint(s.print, uploaded) }];
  })) as Record<PartId, PartStyle>;
}
const plainText = (value: unknown, limit: number, label: string) =>
  typeof value === 'string' && value.length <= limit && ![...value].some(c => c.charCodeAt(0) < 32) ? value.trim() : fail(`${label} must be at most ${limit} characters of plain text.`);
function validateColorways(value: unknown, uploaded: ReadonlySet<string>): Colorway[] {
  if (!Array.isArray(value) || value.length > LIMITS.colorways) fail(`Keep at most ${LIMITS.colorways} colorways.`);
  const colorways = (value as unknown[]).map(item => {
    const c = plain(item, ['id', 'name', 'parts', 'units'], 'Colorway');
    if (typeof c.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(c.id)) fail('Colorway IDs must be short lowercase letters and digits.');
    const name = plainText(c.name, LIMITS.colorwayName, 'Colorway name');
    if (!name) fail('Name each colorway.');
    const units = finite(c.units, LIMITS.units, 'Planned units');
    if (!Number.isInteger(units)) fail('Planned units must be a whole number.');
    return { id: c.id as string, name, parts: validateParts(c.parts, uploaded), units };
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
    const name = plainText(m.name, 60, 'Motif name');
    return { id: m.id as string, name: name || 'Uploaded motif', dataUrl: m.dataUrl as string, width, height };
  });
  if (new Set(motifs.map(m => m.id)).size !== motifs.length) fail('Motif IDs must be unique.');
  return motifs;
}
/** The display name of a part's print. */
export function printName(print: Print, product: Pick<Product, 'motifs'>): string {
  if (print.motif.startsWith('upload:')) return product.motifs?.find(m => `upload:${m.id}` === print.motif)?.name ?? 'Uploaded motif';
  return MOTIF_NAMES[print.motif as Motif];
}

const OPTIONAL = ['spec', 'colorways', 'costing', 'motifs'] as const;
export function validateProduct(value: unknown): Product {
  const present = value && typeof value === 'object' ? OPTIONAL.filter(key => Object.hasOwn(value, key)) : [];
  const p = plain(value, ['base', 'name', 'measurements', 'neckline', 'parts', 'artwork', ...present], 'Product');
  if (p.base !== 'tee') fail('Unsupported base product.');
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > LIMITS.name) fail('Product name must contain 1–80 characters.');
  const m = plain(p.measurements, ['chest', 'length', 'sleeve'], 'Measurements');
  const measurements = { chest: finite(m.chest, LIMITS.chest, 'Chest (cm)'), length: finite(m.length, LIMITS.length, 'Body length (cm)'), sleeve: finite(m.sleeve, LIMITS.sleeve, 'Sleeve length (cm)') };
  if (p.neckline !== 'crew' && p.neckline !== 'v') fail('Neckline must be crew or v.');
  const motifs = p.motifs !== undefined ? validateMotifs(p.motifs) : undefined;
  const uploaded = new Set((motifs ?? []).map(m => m.id));
  const parts = validateParts(p.parts, uploaded);
  if (!Array.isArray(p.artwork) || p.artwork.length > 2) fail('Place at most one artwork on the front and one on the back.');
  const artwork = (p.artwork as unknown[]).map(item => validateArtwork(item, measurements));
  if (new Set(artwork.map(item => item.part)).size !== artwork.length) fail('Place at most one artwork per side.');
  let spec: Spec | undefined;
  if (p.spec !== undefined) {
    const raw = plain(p.spec, ['styleNumber', 'season', 'sampleSize'], 'Tech pack details');
    if (!SIZES.includes(raw.sampleSize as Size)) fail('Sample size must be XS, S, M, L or XL.');
    spec = { styleNumber: plainText(raw.styleNumber, 40, 'Style number'), season: plainText(raw.season, 40, 'Season'), sampleSize: raw.sampleSize as Size };
  }
  return { base: 'tee', name: (p.name as string).trim(), measurements, neckline: p.neckline as Product['neckline'], parts, artwork, ...(spec ? { spec } : {}),
    ...(p.colorways !== undefined ? { colorways: validateColorways(p.colorways, uploaded) } : {}), ...(p.costing !== undefined ? { costing: validateCosting(p.costing) } : {}),
    ...(motifs ? { motifs } : {}) };
}

const style = (material: string, color: string, print: Print | null = null): PartStyle => ({ material, color, print });
const allParts = (part: PartStyle, overrides: Partial<Record<PartId, PartStyle>> = {}) =>
  Object.fromEntries(PART_IDS.map(id => [id, overrides[id] ?? (id === 'neckband' ? { ...part, material: 'rib-220', print: null } : part)])) as Record<PartId, PartStyle>;
const measurements: Measurements = { chest: 104, length: 72, sleeve: 21 };

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
];
export function template(id: string): Product {
  const found = TEMPLATES.find(item => item.id === id) ?? fail('Choose a template from the library.');
  return validateProduct(structuredClone(found.product));
}

// Geometry -------------------------------------------------------------------------------------

/** Flat width and length of the front (and back) body panel, in cm: half the chest plus 2 cm ease. */
export function panelSize(m: Measurements) { return { width: m.chest / 2 + 2, length: m.length }; }
export function sleeveSize(m: Measurements) { const armhole = m.chest * 0.23 + 4; return { capWidth: armhole * 2, cuffWidth: Math.max(28, armhole * 1.55 - m.sleeve * 0.25), length: m.sleeve }; }
export function neckSize(m: Measurements, neckline: Product['neckline']) { const neck = m.chest * 0.41 + 6; return { length: neckline === 'v' ? neck + 6 : neck, width: 2 }; }

/** Every derived tee dimension, in cm, from one place: the 3D shell, pattern pieces and tech pack agree. */
export function teeDimensions(product: Product) {
  const m = product.measurements, panel = panelSize(m), sleeve = sleeveSize(m), half = panel.width / 2;
  return {
    panelWidth: panel.width, length: m.length, half, neckHalf: m.chest * 0.08 + 7, shoulderX: half * 0.86 + 1, shoulderDrop: 4,
    armDepth: m.chest * 0.23 + 2, sleeveLength: m.sleeve, cuffHalf: Math.max(sleeve.cuffWidth / 2, 10), capWidth: sleeve.capWidth,
    neckDepthFront: product.neckline === 'v' ? 15 : 8, neckDepthBack: 2, ribHeight: neckSize(m, product.neckline).width, ribLength: neckSize(m, product.neckline).length,
  };
}

export interface PatternPiece { part: PartId; outline: { x: number; y: number }[]; width: number; height: number; areaCm2: number; cutCount: number }
function area(points: { x: number; y: number }[]) { let s = 0; for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
/** Simplified flat pattern pieces (finished size, no seam allowance) in cm, origin at the top-left. */
export function patternPieces(product: Product): PatternPiece[] {
  const m = product.measurements, panel = panelSize(m), sleeve = sleeveSize(m), neck = neckSize(m, product.neckline);
  const dims = teeDimensions(product), w = panel.width, half = w / 2, shoulderDrop = dims.shoulderDrop, neckWidth = dims.neckHalf, armDepth = dims.armDepth;
  const body = (front: boolean) => {
    const neckDepth = front ? (product.neckline === 'v' ? 15 : 8) : 2;
    const pts = [{ x: half - neckWidth, y: 0 }, { x: 0, y: shoulderDrop }, { x: 1.5, y: shoulderDrop + armDepth * 0.55 }, { x: 0, y: shoulderDrop + armDepth }, { x: 0, y: panel.length },
      { x: w, y: panel.length }, { x: w, y: shoulderDrop + armDepth }, { x: w - 1.5, y: shoulderDrop + armDepth * 0.55 }, { x: w, y: shoulderDrop }, { x: half + neckWidth, y: 0 }];
    // Neckline: a curve for crew/back, a straight V for v-neck fronts.
    if (front && product.neckline === 'v') pts.push({ x: half, y: neckDepth });
    else for (let i = 1; i < 8; i++) { const t = Math.PI * i / 8; pts.push({ x: half + neckWidth * Math.cos(t), y: neckDepth * Math.sin(t) }); }
    return pts;
  };
  const sleevePiece = () => {
    const cap = sleeve.capWidth, cuff = sleeve.cuffWidth, capHeight = Math.min(14, m.chest * 0.11), pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push({ x: t * cap, y: capHeight * (1 - Math.sin(Math.PI * t)) }); }
    pts.push({ x: (cap + cuff) / 2, y: capHeight + sleeve.length }, { x: (cap - cuff) / 2, y: capHeight + sleeve.length });
    return pts;
  };
  const rect = (wd: number, ht: number) => [{ x: 0, y: 0 }, { x: wd, y: 0 }, { x: wd, y: ht }, { x: 0, y: ht }];
  const make = (part: PartId, outline: { x: number; y: number }[], cutCount: number): PatternPiece => ({
    part, outline, cutCount, width: Math.max(...outline.map(p => p.x)), height: Math.max(...outline.map(p => p.y)), areaCm2: area(outline),
  });
  return [make('front', body(true), 1), make('back', body(false), 1), make('sleeveLeft', sleevePiece(), 1), make('sleeveRight', sleevePiece(), 1), make('neckband', rect(neck.length, neck.width * 2), 1)];
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
  const m = product.measurements, half = panelSize(m).width / 2;
  const { neckHalf, shoulderX, shoulderDrop, armDepth } = teeDimensions(product);
  const angle = 38 * Math.PI / 180, dir = { x: Math.cos(angle), y: Math.sin(angle) }, perp = { x: -Math.sin(angle), y: Math.cos(angle) };
  const shoulder = { x: shoulderX, y: shoulderDrop }, underarm = { x: half, y: shoulderDrop + armDepth };
  const cuffHalf = teeDimensions(product).cuffHalf, top = { x: shoulder.x + dir.x * m.sleeve, y: shoulder.y + dir.y * m.sleeve };
  const bottom = { x: top.x + perp.x * cuffHalf, y: top.y + perp.y * cuffHalf };
  const neckDepth = side === 'front' ? (product.neckline === 'v' ? 15 : 8) : 2;
  const mirror = (p: Pt) => ({ x: -p.x, y: p.y });
  const neckPoint = { x: neckHalf, y: 0 }, hem = { x: half, y: m.length };
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
  const m = product.measurements, depth = m.chest / (2 * Math.PI) * 0.85, top = m.length;
  const groups = new Map<PartId, PartMesh>();
  for (const id of PART_IDS) groups.set(id, { part: id, positions: [], uvs: [], indices: [] });
  for (const side of ['front', 'back'] as const) {
    const s = teeSilhouette(product, side), sign = side === 'front' ? 1 : -1, c = s.points;
    // Rounding-level distances are on the seam: snap them so front and back coincide exactly there.
    const height = (p: Pt) => { const d = Math.min(seamDistance(p, s), depth); return d < 1e-6 ? 0 : sign * depth * Math.sqrt(1 - (1 - d / depth) ** 2); };
    // Regions share their armhole edges exactly, so the sleeve seams join without gaps.
    // Corner indices: 0 neck, 1 shoulder, 2 sleeve top, 3 cuff bottom, 4 underarm, 5 hem (and mirrored 6–11).
    const regions: { part: PartId; polygon: Pt[] }[] = [
      { part: side, polygon: [c[0], c[1], c[4], c[5], c[6], c[7], c[10], ...c.slice(11)] },
      { part: 'sleeveLeft', polygon: [c[1], c[2], c[3], c[4]] },
      { part: 'sleeveRight', polygon: [c[7], c[8], c[9], c[10]] },
    ];
    for (const { part, polygon } of regions) {
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
      const triangles = Delaunator.from(samples.map(p => [p.x, p.y])).triangles, group = groups.get(part)!, ids = new Map<number, number>();
      const vertex = (index: number) => {
        let id = ids.get(index);
        if (id === undefined) {
          const p = samples[index]; id = group.positions.length / 3; ids.set(index, id);
          group.positions.push(p.x, top - p.y, height(p));
          // Seen from behind, the back's prints read left to right like the front's.
          group.uvs.push(side === 'front' ? p.x : -p.x, p.y);
        }
        return id;
      };
      for (let t = 0; t < triangles.length; t += 3) {
        const tri = [triangles[t], triangles[t + 1], triangles[t + 2]], pts = tri.map(i => samples[i]);
        if (!inside({ x: (pts[0].x + pts[1].x + pts[2].x) / 3, y: (pts[0].y + pts[1].y + pts[2].y) / 3 }, polygon)) continue;
        const [a, b, d] = tri.map(vertex);
        // Counter-clockwise from outside: flat y grows downward, so the front's order flips.
        if (side === 'front') group.indices.push(a, d, b); else group.indices.push(a, b, d);
      }
    }
  }
  // Neck rib: a 2 cm band rising from the open neck edge, front curve then back curve.
  const rib = groups.get('neckband')!, width = neckSize(m, product.neckline).width, ring: { x: number; y: number; z: number }[] = [];
  for (const side of ['front', 'back'] as const) {
    const s = teeSilhouette(product, side), sign = side === 'front' ? 1 : -1;
    const neckPoints = s.points.filter((_, i) => s.neck[i] || s.neck[(i - 1 + s.points.length) % s.points.length]).sort((a, b) => a.x - b.x);
    const ordered = side === 'front' ? neckPoints : [...neckPoints].reverse();
    for (const p of ordered) { const d = Math.min(seamDistance(p, s), depth); ring.push({ x: p.x, y: top - p.y, z: d < 1e-6 ? 0 : sign * depth * Math.sqrt(1 - (1 - d / depth) ** 2) }); }
  }
  let along = 0;
  ring.forEach((p, i) => {
    if (i) along += Math.hypot(p.x - ring[i - 1].x, p.y - ring[i - 1].y, p.z - ring[i - 1].z);
    rib.positions.push(p.x, p.y, p.z, p.x * 1.03, p.y + width, p.z * 1.03); rib.uvs.push(along, 0, along, width);
    if (i) { const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1; rib.indices.push(a, c, b, b, c, d); }
  });
  { const last = (ring.length - 1) * 2; rib.indices.push(last, 0, last + 1, last + 1, 0, 1); }
  return PART_IDS.map(id => groups.get(id)!).filter(group => group.indices.length);
}
