import { validateSkirtMeasures, skirtBandHeight, skirtDraft, skirtPieces, skirtMesh, skirtHeight, type SkirtMeasures } from './product-skirt.ts';
import { validateRasterHeader } from './media.ts';
import { material } from './materials.ts';
// Product designs: a base garment built from named parts, each styled with a fabric, color and optional
// repeat print, plus placed artwork. Pure data, geometry and validation; rendering lives in product-3d.ts.

/** Base products. Each declares the parts a design styles; the 3D shell, pattern and tech pack follow them. */
export const BASES = ['tee', 'sweatshirt', 'hoodie', 'trousers', 'skirt'] as const;
export type Base = typeof BASES[number];
export const BASE_NAMES: Record<Base, string> = { tee: 'T-shirt', sweatshirt: 'Crew sweatshirt', hoodie: 'Pullover hoodie', trousers: 'Pull-on trousers', skirt: 'Flared skirt' };
/** A top at least this long (cm, shoulder to hem) reaches past the hips and is worn as a dress. */
export const DRESS_LENGTH = 85;
/** A maxi dress's length, ending at the ankles, and a floor-length one's, just above the floor, for a mid-height body. */
export const MAXI_LENGTH = 128;
export const FLOOR_LENGTH = 136;
/** A top at most this long ends above the waist: a crop top. */
export const CROP_LENGTH = 52;
/** Half the gap a zip hoodie's pocket halves leave for the zip, cm. */
export const ZIP_CLEAR = 1.2;
/** Half the parting between an open zip's front halves in 3D, cm. */
export const OPEN_ZIP_GAP = 0.15;
const CROP_NAMES: Partial<Record<Base, string>> = { tee: 'Crop top', sweatshirt: 'Cropped sweatshirt', hoodie: 'Cropped hoodie' };
const DRESS_NAMES: Partial<Record<Base, string>> = { tee: 'T-shirt dress', sweatshirt: 'Sweatshirt dress', hoodie: 'Hoodie dress' };
/** What the garment is, as a buyer or factory would call it: a long top is a dress and short trousers are shorts. */
export function garmentName(product: Pick<Product, 'base' | 'measurements'> & { options?: Options }): string {
  if (product.base === 'trousers') return legMeasurements(product).inseam < 35 ? 'Pull-on shorts' : legMeasurements(product).cuffHeight ? 'Joggers' : BASE_NAMES.trousers;
  // A hoodie with a front zip is a zip hoodie, cropped or as a dress too.
  const zip = (name: string) => (product.base !== 'hoodie' || !product.options?.zip ? name
    : name === BASE_NAMES.hoodie ? 'Zip hoodie' : name.replace(/hoodie/i, match => `${match[0] === 'H' ? 'Zip' : 'zip'} ${match.toLowerCase()}`));
  // A sweatshirt with a front zip and a rib stand collar is a bomber jacket; with only one of them, a zip sweatshirt or a
  // funnel-neck sweatshirt.
  if (product.base === 'sweatshirt' && (product.options?.zip || product.options?.collar)) {
    const named = product.options.zip ? (product.options.collar ? 'Bomber jacket' : 'Zip sweatshirt') : 'Funnel-neck sweatshirt', length = topMeasurements(product).length;
    return length <= CROP_LENGTH ? `Cropped ${named.toLowerCase()}` : length >= DRESS_LENGTH ? `${product.options.zip ? 'Zip' : 'Funnel-neck'} sweatshirt dress` : named;
  }
  // A shirt cut long and roomy to go over other tops is a coat.
  if (product.base === 'tee' && product.options?.coat) return 'Coat';
  // A tee with a button front is a shirt: with the collar a button-up shirt, without it a collarless one.
  if (product.base === 'tee' && product.options?.buttons) {
    const { length, sleeve } = topMeasurements(product);
    const named = !product.options.collar ? 'Collarless shirt' : sleeve < SHORT_SLEEVE ? 'Short-sleeved shirt' : 'Button-up shirt';
    return length <= CROP_LENGTH ? `Cropped ${named.toLowerCase()}` : length >= DRESS_LENGTH ? 'Shirt dress' : sleeveless(product) ? 'Sleeveless shirt' : named;
  }
  // A tee with a polo collar is a polo, cropped or long too.
  if (product.base === 'tee' && product.options?.collar) {
    const length = topMeasurements(product).length;
    return length <= CROP_LENGTH ? 'Cropped polo' : length >= DRESS_LENGTH ? 'Polo dress' : sleeveless(product) ? 'Sleeveless polo' : 'Polo shirt';
  }
  if (product.base !== 'skirt' && topMeasurements(product).length <= CROP_LENGTH) return zip(sleeveless(product) ? 'Cropped tank top' : CROP_NAMES[product.base]!);
  if (sleeveless(product)) return topMeasurements(product).length >= DRESS_LENGTH ? 'Tank dress' : 'Tank top';
  if (product.base !== 'skirt' && topMeasurements(product).length >= DRESS_LENGTH) return zip(DRESS_NAMES[product.base]!);
  // Pleats name a skirt: box pleats by their kind, knife pleats just pleated.
  if (product.base === 'skirt') {
    const m = product.measurements as SkirtMeasures;
    // A fitted skirt narrowing to its hem is a pencil skirt; one as wide at the hem as the hip, a straight skirt.
    if (m.hip !== undefined) return m.hem < m.hip - 2 ? 'Pencil skirt' : m.hem > m.hip + 6 ? 'Fitted A-line skirt' : 'Straight skirt';
    if (m.pleats) return m.pleats.style === 'box' ? 'Box-pleated skirt' : 'Pleated skirt';
  }
  return zip(BASE_NAMES[product.base]);
}
export const PART_IDS = ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband', 'cuffLeft', 'cuffRight', 'hemBand', 'hood', 'pocket', 'chestPocket', 'waistband', 'collar', 'placket', 'skirtFront', 'skirtBack', 'yoke', 'backPocket', 'frontPocket', 'beltLoop'] as const;
export type PartId = typeof PART_IDS[number];
export const PART_NAMES: Record<PartId, string> = { front: 'Front body', back: 'Back body', sleeveLeft: 'Left sleeve', sleeveRight: 'Right sleeve', neckband: 'Neck rib',
  cuffLeft: 'Left cuff', cuffRight: 'Right cuff', hemBand: 'Hem band', hood: 'Hood', pocket: 'Pocket', chestPocket: 'Chest pocket', waistband: 'Waistband', collar: 'Collar', placket: 'Placket',
  skirtFront: 'Front skirt', skirtBack: 'Back skirt', yoke: 'Back yoke', backPocket: 'Back pockets', frontPocket: 'Front pockets', beltLoop: 'Belt loops' };
export const BASE_PARTS: Record<Base, readonly PartId[]> = {
  tee: ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband'],
  sweatshirt: ['front', 'back', 'sleeveLeft', 'sleeveRight', 'neckband', 'cuffLeft', 'cuffRight', 'hemBand'],
  hoodie: ['front', 'back', 'sleeveLeft', 'sleeveRight', 'cuffLeft', 'cuffRight', 'hemBand', 'hood', 'pocket'],
  // Shorts and trousers: front and back leg panels (cut in pairs) and a waistband, elasticated or, with a fly, buttoned.
  trousers: ['front', 'back', 'waistband'],
  skirt: ['front', 'back'],
};
/** A part's display name on this design: the front and back of shorts and trousers are leg panels. */
export function partName(product: Pick<Product, 'base'>, part: PartId): string {
  if (product.base === 'trousers' && (part === 'front' || part === 'back')) return part === 'front' ? 'Front legs' : 'Back legs';
  if (product.base === 'trousers' && (part === 'cuffLeft' || part === 'cuffRight')) return part === 'cuffLeft' ? 'Left ankle cuff' : 'Right ankle cuff';
  return PART_NAMES[part];
}
/** Bottoms use their own measured panels instead of top measurements or the top drape. */
export function isBottoms(product: Pick<Product, 'base'>): boolean { return product.base === 'trousers' || product.base === 'skirt'; }
/** A top worn over another: one made on the T-shirt base (a tee, tank, crop top, T-shirt dress or shirt) under a
 * sweatshirt, a hoodie or a coat, or one without a button front under a button-front shirt, worn open or buttoned.
 * Null for any other pair. */
export function layerOrder<T extends Pick<Product, 'base' | 'options'>>(a: T, b: T): { inner: T; outer: T } | null {
  const shirt = (product: T) => product.base === 'tee' && !!product.options?.buttons;
  const coat = (product: T) => product.base === 'tee' && !!product.options?.coat;
  const over = (outer: T, inner: T) => inner.base === 'tee' && !coat(inner)
    && (coat(outer) || outer.base === 'sweatshirt' || outer.base === 'hoodie' || (shirt(outer) && !shirt(inner)));
  if (over(b, a)) return { inner: a, outer: b };
  if (over(a, b)) return { inner: b, outer: a };
  return null;
}
/** Whether two designs make an outfit: a top with bottoms, or a top over another (see layerOrder). */
export function canWearTogether(a: Pick<Product, 'base' | 'options'>, b: Pick<Product, 'base' | 'options'>): boolean { return isBottoms(a) !== isBottoms(b) || layerOrder(a, b) !== null; }
// A top worn under another is made for the outer one's arm pose, so its sleeves lie round the same arms. The pose is
// kept beside the copy made for the drape, never in the saved design.
const SLEEVE_POSE = new WeakMap<object, number>();
/** How far the arms are lowered from the horizontal for this top's 3D shell and drape, degrees. */
export function sleeveAngleOf(product: Product): number { return SLEEVE_POSE.get(product) ?? (product.base === 'tee' ? 38 : 58); }
/** A copy of `product` made and draped with its arms at `angle` degrees below the horizontal. */
export function withSleeveAngle(product: Product, angle: number): Product { const copy = { ...product }; SLEEVE_POSE.set(copy, angle); return copy; }
/** Parts knitted as rib trims: they keep their rib fabric when a style is copied to every part. */
export const RIB_PARTS: ReadonlySet<PartId> = new Set(['neckband', 'cuffLeft', 'cuffRight', 'hemBand', 'collar']);
/** The parts of this design: its base's parts plus any optional module parts, in display order. */
export function partsOf(product: Pick<Product, 'base' | 'options'> & Partial<Pick<Product, 'measurements'>>): readonly PartId[] {
  const parts = product.base === 'skirt' && (product.measurements as SkirtMeasures | undefined)?.waistbandHeight
    ? [...BASE_PARTS.skirt, 'waistband' as const]
    : product.base === 'trousers' && (product.measurements as LegMeasurements | undefined)?.cuffHeight
      ? [...BASE_PARTS.trousers, 'cuffLeft' as const, 'cuffRight' as const] : BASE_PARTS[product.base];
  const kept = sleeveless(product) ? parts.filter(part => part !== 'sleeveLeft' && part !== 'sleeveRight') : parts;
  // A polo's knit collar takes the neck rib's place, and its buttoned placket lies on the front.
  const { collar, buttons } = optionsOf(product), placket = product.base === 'tee' && (collar || buttons);
  const collared = !collar && !placket ? kept
    : [...kept.filter(part => !collar || part !== 'neckband'), ...(collar ? ['collar' as const] : []), ...(placket ? ['placket' as const] : [])];
  // A dress cut at the waist: the front and back bodies end at the waist seam, and a skirt front and back hang from it.
  const seamed = product.base === 'tee' && optionsOf(product).waistSeam ? [...collared, 'skirtFront' as const, 'skirtBack' as const] : collared;
  // A shirt's back yoke, across the shoulders above the back body, or trousers', across the seat below the waist.
  const yoked = (product.base === 'tee' || product.base === 'trousers') && optionsOf(product).yoke ? [...seamed, 'yoke' as const] : seamed;
  // A long-sleeved shirt's buttoned cuffs.
  const cuffed = product.base === 'tee' && optionsOf(product).cuffs ? [...yoked, 'cuffLeft' as const, 'cuffRight' as const] : yoked;
  // Trousers' front scoop pockets and back patch pockets.
  const fronted = product.base === 'trousers' && optionsOf(product).frontPockets ? [...cuffed, 'frontPocket' as const] : cuffed;
  const pocketed = product.base === 'trousers' && optionsOf(product).backPockets ? [...fronted, 'backPocket' as const] : fronted;
  // A buttoned waistband's belt loops.
  const looped = product.base === 'trousers' && optionsOf(product).fly && optionsOf(product).beltLoops ? [...pocketed, 'beltLoop' as const] : pocketed;
  return optionsOf(product).chestPocket ? [...looped, 'chestPocket'] : looped;
}

/**
 * The design with a new sleeve length, in place. Going sleeveless (a tee at 0) removes the sleeves' styles from the
 * design and every colourway; sleeves coming back start in the front body's style.
 */
export function withSleeveLength<T extends Pick<Product, 'base' | 'measurements' | 'parts' | 'options'> & { colorways?: Product['colorways'] }>(product: T, sleeve: number): T {
  (product.measurements as Measurements).sleeve = sleeve;
  // A sleeveless top has no sleeves to puff, and short sleeves have no cuffs.
  if (sleeve === 0) delete (product.measurements as Measurements).sleeveGather;
  // A coat shortened below COAT_LENGTH, or given short sleeves, is a shirt again.
  if (product.base === 'tee' && product.options?.coat && !coatAllowed(product, product.options)) {
    const options = { ...product.options };
    delete options.coat;
    product.options = options;
  }
  if (product.base === 'tee' && product.options?.cuffs && sleeve < CUFFED_SLEEVE) {
    const options = { ...product.options };
    delete options.cuffs;
    product.options = options;
    const drop = (parts: Product['parts']) => { delete (parts as Partial<Product['parts']>).cuffLeft; delete (parts as Partial<Product['parts']>).cuffRight; };
    drop(product.parts); for (const colourway of product.colorways ?? []) drop(colourway.parts);
  }
  const ids = new Set(partsOf(product));
  const fix = (parts: Product['parts']) => {
    for (const id of ['sleeveLeft', 'sleeveRight'] as const) {
      if (ids.has(id)) parts[id] ??= structuredClone(parts.front);
      else delete (parts as Partial<Product['parts']>)[id];
    }
  };
  fix(product.parts); for (const colourway of product.colorways ?? []) fix(colourway.parts);
  // Artwork follows the sleeves: moved to stay on a shorter one, removed with them.
  if ('artwork' in product && Array.isArray(product.artwork)) keepArtworkInside(product as unknown as Product);
  return product;
}

/** Add, resize or remove ankle cuffs on trousers (making them joggers), without losing independently styled
 * colourways: new cuffs take the legs' colour in rib. */
export function withLegCuffs(product: Product, height: number): Product {
  if (product.base !== 'trousers') fail('Choose trousers to give them ankle cuffs.');
  const draft = structuredClone(product), m = draft.measurements as LegMeasurements;
  if (height === 0) delete m.cuffHeight;
  else m.cuffHeight = height;
  const update = (parts: Product['parts']) => {
    for (const id of ['cuffLeft', 'cuffRight'] as const) {
      if (height === 0) delete (parts as Partial<Product['parts']>)[id];
      else parts[id] ??= { ...structuredClone(parts.front), material: 'rib-220', print: null };
    }
  };
  update(draft.parts); for (const colourway of draft.colorways ?? []) update(colourway.parts);
  // Cuffs shorten the legs, so artwork near the hem moves up.
  keepArtworkInside(draft);
  return validateProduct(draft);
}

/** Add, resize or remove the skirt band without losing independently styled colourways. */
export function withSkirtWaistband(product: Product, height: number): Product {
  if(product.base !== 'skirt') fail('Choose a flared skirt to edit its waistband.');
  const draft=structuredClone(product),m=draft.measurements as SkirtMeasures;
  if(height === 0) delete m.waistbandHeight;
  else m.waistbandHeight=height;
  const update=(parts: Product['parts'])=>{
    if(height === 0) delete (parts as Partial<Product['parts']>).waistband;
    else parts.waistband ??= structuredClone(parts.front);
  };
  update(draft.parts);for(const colourway of draft.colorways ?? [])update(colourway.parts);
  // Measurements applied with the band may have shortened the skirt under its artwork.
  keepArtworkInside(draft);
  return validateProduct(draft);
}

/**
 * Modules a base product can be switched between, as in product-library tools. A curved (shirttail) hem needs an
 * unbanded hem, so only the tee has it; the hoodie's kangaroo pocket takes the place of a chest pocket.
 */
export const HEMS = ['straight', 'curved'] as const;
export type Hem = typeof HEMS[number];
export const HEM_NAMES: Record<Hem, string> = { straight: 'Straight', curved: 'Curved shirttail' };
export interface Options { hem: Hem; chestPocket: boolean; /** A centre-front zip (hoodies): the front is cut as two halves. */ zip?: boolean;
  /** A zip hoodie worn open: in 3D its front halves and hem band are not joined at the centre front, so they hang apart. */ zipOpen?: boolean;
  /** A collar instead of the neck rib: on a tee a polo's flat-knit collar and buttoned placket, on a sweatshirt a rib
   * stand collar (a bomber jacket's, with the front zip). */ collar?: boolean;
  /** A button front (tees): the front opens down its length on a buttoned placket; with the collar, a shirt. */ buttons?: boolean;
  /** A waist seam (T-shirt dresses): the front and back are cut at the waist line into a bodice and a skirt, each styled
   * on its own. */ waistSeam?: boolean;
  /** A back yoke (shirts): the back is cut across YOKE_CM below the neck points into a yoke over the shoulders and the
   * back body, each styled on its own; on trousers and shorts, the back legs are cut across the seat below the waist,
   * deeper at the centre back seam than at the side (see trouserYoke), as jeans are. */ yoke?: boolean;
  /** Back patch pockets (trousers and shorts), one on each back leg below the waist (and the yoke), styled on their
   * own. */ backPockets?: boolean;
  /** Front scoop pockets (trousers and shorts): each front leg is cut away in a curve from the waist to the side seam
   * (see frontPocketOf), showing the pocket facing behind it, styled on its own. */ frontPockets?: boolean;
  /** A zip fly (trousers and shorts): the front legs close with a zip under a fly topstitched in a J on the wearer's
   * left, and the waistband is a straight band fastened with a shank button, so the waist is fitted: the legs narrow
   * from the hips to the waist instead of being gathered into an elastic (see trouserDimensions). */ fly?: boolean;
  /** Five belt loops round a buttoned waistband (with the fly), styled on their own. */ beltLoops?: boolean;
  /** Buttoned cuffs (long-sleeved shirts): each sleeve ends SHIRT_CUFF_CM above its measured length in a woven cuff,
   * styled on its own, into which it is pleated. */ cuffs?: boolean;
  /** A coat (shirts at least COAT_LENGTH long with long sleeves): worn over a T-shirt, shirt, polo or dress, with coat
   * buttons and hems. */ coat?: boolean }
export const DEFAULT_OPTIONS: Options = { hem: 'straight', chestPocket: false };
export function optionsOf(product: Pick<Product, 'options'>): Options { return product.options ?? DEFAULT_OPTIONS; }
export function hemAllowed(base: Base, hem: Hem): boolean { return hem === 'straight' || base === 'tee'; }
export function chestPocketAllowed(base: Base): boolean { return base === 'tee' || base === 'sweatshirt'; }
export function zipAllowed(base: Base): boolean { return base === 'hoodie' || base === 'sweatshirt'; }
/** A back yoke goes on a shirt with a button front, or on trousers and shorts. */
export function yokeAllowed(base: Base, options: Pick<Options, 'buttons'>): boolean { return base === 'trousers' || (base === 'tee' && !!options.buttons); }
export function backPocketsAllowed(base: Base): boolean { return base === 'trousers'; }
/** How much deeper than its opening a front pocket's facing is cut, so the front's edge lies over it. */
export const FRONT_POCKET_FACING_CM = 3;
export function frontPocketsAllowed(base: Base): boolean { return base === 'trousers'; }
export function flyAllowed(base: Base): boolean { return base === 'trousers'; }
/** Belt loops go on a buttoned waistband: trousers or shorts with the fly. */
export function beltLoopsAllowed(base: Base, options: Pick<Options, 'fly'>): boolean { return base === 'trousers' && !!options.fly; }
export function collarAllowed(base: Base): boolean { return base === 'tee' || base === 'sweatshirt'; }
export function buttonsAllowed(base: Base): boolean { return base === 'tee'; }
/** How far below the neck points a shirt's back yoke seam runs across the back, cm. */
export const YOKE_CM = 9;
/** A shirt cuff's finished height, cm, and the shortest sleeve (cm) that has cuffs. */
export const SHIRT_CUFF_CM = 6, CUFFED_SLEEVE = 45;
/** Cuffs go on a long-sleeved shirt: a T-shirt base with a button front and sleeves at least CUFFED_SLEEVE long. */
export function cuffsAllowed(product: Pick<Product, 'base'> & Partial<Pick<Product, 'measurements'>>, options: Options): boolean {
  return product.base === 'tee' && !!options.buttons && ((product.measurements as Measurements | undefined)?.sleeve ?? 0) >= CUFFED_SLEEVE;
}
/** The shortest coat, cm. */
export const COAT_LENGTH = 70;
/** A coat is a long shirt: a T-shirt base with a button front and collar, at least COAT_LENGTH long, with sleeves at
 * least CUFFED_SLEEVE long. */
export function coatAllowed(product: Pick<Product, 'base'> & Partial<Pick<Product, 'measurements'>>, options: Options): boolean {
  const m = product.measurements as Measurements | undefined;
  return product.base === 'tee' && !!options.buttons && !!options.collar && (m?.length ?? 0) >= COAT_LENGTH && (m?.sleeve ?? 0) >= CUFFED_SLEEVE;
}
/** A waist seam goes on a dress: a T-shirt base at least DRESS_LENGTH long. */
export function waistSeamAllowed(product: Pick<Product, 'base'> & Partial<Pick<Product, 'measurements'>>): boolean {
  return product.base === 'tee' && ((product.measurements as Measurements | undefined)?.length ?? 0) >= DRESS_LENGTH;
}
/** A polo/shirt collar's flat height from neck sewing edge to outer fall edge, and the polo placket, cm. */
export const COLLAR_CM = 7, PLACKET_CM = { length: 14, width: 3, buttons: 3 } as const;
/** A sweatshirt's rib stand collar (a bomber jacket's), its finished height, cm. */
export const STAND_COLLAR_CM = 6;
/** A shirt's button placket width, cm, and the spacing its buttons are counted from; sleeves shorter than this are short. */
const SHIRT_PLACKET_CM = 3.2, BUTTON_SPACING_CM = 9.5, SHORT_SLEEVE = 35;
/** A tee's placket: a polo's short one under the collar, or a button front's from the neckline to the hem. */
export function placketOf(product: Product): { length: number; width: number; buttons: number } {
  if (!optionsOf(product).buttons) return PLACKET_CM;
  const d = teeDimensions(product), length = Math.round((d.length - d.neckDepthFront) * 2) / 2;
  return { length, width: SHIRT_PLACKET_CM, buttons: Math.max(4, Math.round(length / BUTTON_SPACING_CM)) };
}
/** A front zip's length: from the centre-front neck down through the hem band. */
export function zipLength(product: Product): number { const d = teeDimensions(product); return Math.round((d.length - d.neckDepthFront) * 2) / 2; }
/** Sleeve-length presets in cm; the measurement stays editable. */
export const SLEEVE_PRESETS = [{ id: 'short', name: 'Short', cm: 21 }, { id: 'elbow', name: 'Elbow', cm: 35 }, { id: 'long', name: 'Long', cm: 60 }, { id: 'sleeveless', name: 'Sleeveless', cm: 0 }] as const;
/** A tee with a sleeve length of 0 has no sleeves: a tank top, its armholes left open (finished with binding). */
export function sleeveless(product: Pick<Product, 'base'> & Partial<Pick<Product, 'measurements'>>): boolean {
  return product.base === 'tee' && (product.measurements as Measurements | undefined)?.sleeve === 0;
}

/** The design with new module options: a new chest pocket starts in the front body's style, here and in every colorway. */
export function withOptions(product: Product, next: Options): Product {
  if (!hemAllowed(product.base, next.hem)) fail(`A ${BASE_NAMES[product.base].toLowerCase()} has a rib hem band, so its hem stays straight.`);
  if (next.chestPocket && !chestPocketAllowed(product.base)) fail(product.base === 'hoodie' ? 'A hoodie has a kangaroo pocket instead of a chest pocket.' : 'A chest pocket goes on a top.');
  if (next.collar && !collarAllowed(product.base)) fail('A collar goes on a T-shirt (a polo collar) or a sweatshirt (a stand collar).');
  if (next.buttons && !buttonsAllowed(product.base)) fail('A button front goes on a T-shirt, to make a shirt.');
  if (next.zipOpen && !next.zip && !next.buttons) fail('Only a garment with a front zip or buttons can be worn open.');
  if (next.waistSeam && !waistSeamAllowed(product)) fail(`A waist seam goes on a T-shirt dress: lengthen it to at least ${DRESS_LENGTH} cm first.`);
  if (next.yoke && !yokeAllowed(product.base, next)) fail(product.base === 'tee' ? 'A back yoke goes on a shirt: add the button front first.' : 'A back yoke goes on a shirt or on trousers.');
  if (next.backPockets && !backPocketsAllowed(product.base)) fail('Back pockets go on trousers or shorts.');
  if (next.frontPockets && !frontPocketsAllowed(product.base)) fail('Front pockets go on trousers or shorts.');
  if (next.fly && !flyAllowed(product.base)) fail('A fly front goes on trousers or shorts.');
  if (next.beltLoops && !beltLoopsAllowed(product.base, next)) fail(product.base === 'trousers' ? 'Belt loops go on a buttoned waistband: add the fly front first.' : 'Belt loops go on trousers or shorts.');
  if (next.cuffs && !cuffsAllowed(product, next)) fail(`Cuffs go on a long-sleeved shirt: add the button front and make the sleeves at least ${CUFFED_SLEEVE} cm first.`);
  if (next.coat && !coatAllowed(product, next)) fail(`A coat is a long shirt: add the button front and collar, and make it at least ${COAT_LENGTH} cm long with sleeves of at least ${CUFFED_SLEEVE} cm first.`);
  if (next.coat && next.waistSeam) fail('A coat is not cut at the waist: take the waist seam off first.');
  if (next.collar && product.neckline !== 'crew') fail(product.base === 'tee' ? 'A polo has a round neck under its collar; choose the crew neckline first.'
    : 'A stand collar is sewn to a round neck; choose the crew neckline first.');
  const draft = structuredClone(product);
  // The collar takes the neck rib's style, and the placket the front's; taking them off gives the rib back.
  const setCollar = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (next.collar) {
      // A shirt's collar is cut from its own fabric; a polo's and a stand collar are knitted like the neck rib.
      all.collar ??= structuredClone(next.buttons ? parts.front : all.neckband ?? { ...parts.front, material: 'rib-220', print: null });
      delete all.neckband;
    }
    else if (all.collar) { all.neckband ??= structuredClone(all.collar); delete all.collar; }
    if (product.base === 'tee' && (next.collar || next.buttons)) all.placket ??= structuredClone(parts.front);
    else delete all.placket;
  };
  setCollar(draft.parts);
  for (const colorway of draft.colorways ?? []) setCollar(colorway.parts);
  const setPocket = (parts: Record<PartId, PartStyle>) => {
    if (next.chestPocket) parts.chestPocket ??= structuredClone(parts.front);
    else delete (parts as Partial<Record<PartId, PartStyle>>).chestPocket;
  };
  setPocket(draft.parts);
  for (const colorway of draft.colorways ?? []) setPocket(colorway.parts);
  // A new skirt starts in its body's style; taking the seam off sews the body back in one piece.
  const setSkirt = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (next.waistSeam) { all.skirtFront ??= structuredClone(parts.front); all.skirtBack ??= structuredClone(parts.back); }
    else { delete all.skirtFront; delete all.skirtBack; }
  };
  if (!next.waistSeam && product.base === 'tee') delete (draft.measurements as Measurements).gather;
  setSkirt(draft.parts);
  for (const colorway of draft.colorways ?? []) setSkirt(colorway.parts);
  // A new yoke starts in the back's style.
  const setYoke = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (next.yoke) all.yoke ??= structuredClone(parts.back); else delete all.yoke;
  };
  setYoke(draft.parts);
  for (const colorway of draft.colorways ?? []) setYoke(colorway.parts);
  // New back pockets start in the back legs' style.
  const setBackPockets = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (next.backPockets) all.backPocket ??= structuredClone(parts.back); else delete all.backPocket;
  };
  setBackPockets(draft.parts);
  for (const colorway of draft.colorways ?? []) setBackPockets(colorway.parts);
  // New front pocket facings start in the front legs' style.
  const setFrontPockets = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (next.frontPockets) all.frontPocket ??= structuredClone(parts.front); else delete all.frontPocket;
  };
  setFrontPockets(draft.parts);
  for (const colorway of draft.colorways ?? []) setFrontPockets(colorway.parts);
  // New belt loops start in the waistband's style.
  const setBeltLoops = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (next.fly && next.beltLoops) all.beltLoop ??= structuredClone(parts.waistband ?? parts.front); else delete all.beltLoop;
  };
  if (product.base === 'trousers') { setBeltLoops(draft.parts); for (const colorway of draft.colorways ?? []) setBeltLoops(colorway.parts); }
  // New cuffs start in their sleeves' styles (woven, unlike a sweatshirt's rib cuffs).
  const setCuffs = (parts: Record<PartId, PartStyle>) => {
    const all = parts as Partial<Record<PartId, PartStyle>>;
    if (product.base !== 'tee') return;
    if (next.cuffs) { all.cuffLeft ??= structuredClone(parts.sleeveLeft); all.cuffRight ??= structuredClone(parts.sleeveRight); }
    else { delete all.cuffLeft; delete all.cuffRight; }
  };
  setCuffs(draft.parts);
  for (const colorway of draft.colorways ?? []) setCuffs(colorway.parts);
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
/** Where artwork goes: the front or back body, projected straight on as seen from that side, or on a top with sleeves
 * either sleeve, placed on the sleeve's pattern piece so that it wraps round the arm (see sleeveArtworkFrame). */
export const ARTWORK_PARTS = ['front', 'back', 'sleeveLeft', 'sleeveRight'] as const;
export type ArtworkPart = typeof ARTWORK_PARTS[number];
/** Each place for artwork as it is named in a sentence ("Upload artwork for the left sleeve first"). */
export const ARTWORK_PART_NAMES: Record<ArtworkPart, string> = { front: 'front', back: 'back', sleeveLeft: 'left sleeve', sleeveRight: 'right sleeve' };
export const isSleeveArtwork = (part: ArtworkPart): part is 'sleeveLeft' | 'sleeveRight' => part === 'sleeveLeft' || part === 'sleeveRight';
export interface Artwork { part: ArtworkPart; dataUrl: string; width: number; height: number; name: string; xCm: number; yCm: number; widthCm: number; /** Clockwise viewed from outside, about the existing centre; absent means zero. */ rotation?: number }
export interface Measurements { chest: number; length: number; sleeve: number;
  /** A dress cut at the waist: its skirt's waist edge is cut this many times longer than the seam and gathered into it
   * (DRESS_GATHER); absent for a smooth skirt. */ gather?: number;
  /** Puff sleeves: each sleeve cap is cut this many times as long as the armhole it is gathered into (SLEEVE_GATHER);
   * absent for a plain sleeve, whose cap is CAP_EASE longer. */ sleeveGather?: number }
/** How many times longer a dress skirt's waist edge may be cut than the waist seam it is gathered into. */
export const DRESS_GATHER = [1.1, 2] as const;
/** How many times as long as its armhole a puff sleeve's cap may be cut. */
export const SLEEVE_GATHER = [1.2, 1.7] as const;
/**
 * A top's editable points of measure, in cm, as the tech pack states them: shoulder width (E), shoulder drop (U), neck width (F), front
 * neck drop (G), back neck drop (H), armhole depth (D), hem width ½ (I, side seam to side seam) and sleeve opening ½ (J). Each one left
 * out keeps its default. Optional chest-pocket width/height/placement use P/Q/R/V. Defaults are chest-based where applicable; back neck drop is 2 cm and shoulder drop is 4 cm.
 */
export const POCKET_FIT_KEYS = ['chestPocketWidth', 'chestPocketHeight', 'chestPocketX', 'chestPocketY'] as const;
export const FIT_KEYS = ['shoulderWidth', 'shoulderDrop', 'neckWidth', 'frontNeckDrop', 'backNeckDrop', 'hoodHeight', 'hoodWidth', 'neckRibHeight', 'cuffHeight', 'hemBandHeight', 'armholeDepth', 'waistWidth', 'waistPosition', 'hemWidth', 'sleeveOpening', ...POCKET_FIT_KEYS] as const;
/** A T-shirt's waist shaping (X, Y): with a waist width its side seams curve in through it at the waist position. */
export const WAIST_FIT_KEYS = ['waistWidth', 'waistPosition'] as const;
export type FitKey = typeof FIT_KEYS[number];
export type Fit = Partial<Record<FitKey, number>>;
export const FIT_NAMES: Record<FitKey, string> = { shoulderWidth: 'Shoulder width', shoulderDrop: 'Shoulder drop', neckWidth: 'Neck width', frontNeckDrop: 'Front neck drop', backNeckDrop: 'Back neck drop', hoodHeight: 'Hood side height', hoodWidth: 'Hood side width', neckRibHeight: 'Neck rib height', cuffHeight: 'Cuff height', hemBandHeight: 'Hem band height',
  chestPocketWidth: 'Chest pocket width', chestPocketHeight: 'Chest pocket height', chestPocketX: 'Pocket centre offset', chestPocketY: 'Pocket top placement',
  armholeDepth: 'Armhole depth', waistWidth: 'Waist width (½)', waistPosition: 'Waist position', hemWidth: 'Hem width (½)', sleeveOpening: 'Sleeve opening (½)' };
/** Finished leg measurements in cm: relaxed elastic waist, hip, front rise, inseam and leg opening (circumference). */
export interface LegMeasurements { waist: number; hip: number; rise: number; inseam: number; legOpening: number; waistbandHeight?: number;
  /** Rib cuffs at the leg openings, which gather them (joggers), cm high; absent without cuffs. */ cuffHeight?: number }
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
  /** Colours picked from a reference photo (the photo itself is not kept); absent until picked. */
  palette?: string[];
}

export const LIMITS = {
  chest: [80, 150], length: [40, 150], sleeve: [10, 65], waist: [56, 130], hip: [80, 150], rise: [18, 40], inseam: [8, 90], legOpening: [30, 80], waistbandHeight: [4, 10], legCuffHeight: [4, 12], scaleCm: [2, 40], artworkWidthCm: [3, 40], artworkBytes: 1_500_000, name: 80,
  fit: { shoulderWidth: [30, 70], shoulderDrop: [1, 8], neckWidth: [12, 28], frontNeckDrop: [2, 25], backNeckDrop: [1, 12], hoodHeight: [24, 44], hoodWidth: [20, 34], neckRibHeight: [1, 4], cuffHeight: [2, 12], hemBandHeight: [2, 12], armholeDepth: [15, 36], waistWidth: [28, 76], waistPosition: [25, 70], hemWidth: [35, 95], sleeveOpening: [8, 30], chestPocketWidth: [6, 20], chestPocketHeight: [6, 24], chestPocketX: [-22, 22], chestPocketY: [8, 45] } as Record<FitKey, readonly [number, number]>,
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
/** Artwork on bottoms is placed from the waist seam: the seam's height in 3D (where the panels end under any band) and
 * the garment's length below it. */
export function bottomsArtworkFrame(product: Product): { top: number; length: number } {
  if (product.base === 'skirt') { const top = skirtHeight(product) - skirtBandHeight(product); return { top, length: top }; }
  const d = trouserDimensions(product);
  return { top: d.length, length: d.length };
}
type Placed = Pick<Artwork, 'part' | 'xCm' | 'yCm' | 'widthCm' | 'width' | 'height'>;
/** The part that artwork on a side of bottoms is projected onto in 3D, unshaped by any drape, and the artwork's centre
 * in the front view (behind, where artwork is measured as seen from behind, across is mirrored). */
function bottomsTarget(product: Product, art: Placed): { mesh: PartMesh; x: number; y: number } {
  const mesh = (product.base === 'skirt' ? skirtMesh(product) : trouserMesh(product)).find(part => part.part === art.part)!;
  return { mesh, x: art.part === 'front' ? art.xCm : -art.xCm, y: bottomsArtworkFrame(product).top - art.yCm - art.widthCm * art.height / art.width / 2 };
}
/** Whether the point (x, y) of the front view lies over the mesh, so that a ray straight through it meets the mesh. */
function over(mesh: PartMesh, x: number, y: number): boolean {
  const p = mesh.positions, ix = mesh.indices;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i]! * 3, b = ix[i + 1]! * 3, c = ix[i + 2]! * 3;
    // Triangles seen edge-on cover nothing.
    if (Math.abs((p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) - (p[b + 1]! - p[a + 1]!) * (p[c]! - p[a]!)) < 1e-9) continue;
    const ab = (p[b]! - p[a]!) * (y - p[a + 1]!) - (p[b + 1]! - p[a + 1]!) * (x - p[a]!);
    const bc = (p[c]! - p[b]!) * (y - p[b + 1]!) - (p[c + 1]! - p[b + 1]!) * (x - p[b]!);
    const ca = (p[a]! - p[c]!) * (y - p[c + 1]!) - (p[a + 1]! - p[c + 1]!) * (x - p[c]!);
    if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true;
  }
  return false;
}
/** The nearest x of the front view at height y that lies over the mesh, a centimetre further in where the mesh is that
 * wide, or null when the mesh does not reach that height. */
function nearestOver(mesh: PartMesh, x: number, y: number): number | null {
  for (let step = 1; step <= 400; step++) for (const sign of [1, -1]) {
    const at = x + sign * step * 0.25;
    if (over(mesh, at, y)) return over(mesh, at + sign, y) ? at + sign : at;
  }
  return null;
}
/**
 * Why artwork would not print on bottoms, or null when it would. It is projected straight onto its side's part, as in
 * 3D, so its centre must lie over that part as seen from outside (not beside the hips, between the legs or on a jeans
 * yoke, which is a part of its own), and it must end above the hem.
 */
export function bottomsArtworkProblem(product: Product, art: Placed): string | null {
  const name = garmentName(product).toLowerCase();
  if (art.yCm + art.widthCm * art.height / art.width > bottomsArtworkFrame(product).length + 1e-9) return `Artwork on ${name} must end above the hem.`;
  const { mesh, x, y } = bottomsTarget(product, art);
  if (over(mesh, x, y)) return null;
  const near = nearestOver(mesh, x, y), across = near === null ? 0 : Math.round((art.part === 'front' ? near : -near) * 10) / 10;
  const where = near !== null ? ` At ${Math.round(art.yCm * 10) / 10} cm below the waist, the nearest place is ${across === 0 ? 'the centre' : `${Math.abs(across)} cm ${across > 0 ? 'right' : 'left'} of centre`}.`
    // Behind jeans, the yoke across the top is a part of its own.
    : art.part === 'back' && optionsOf(product).yoke ? ` Place it below the back yoke, which reaches ${Math.round(trouserYoke(product).back * 10) / 10} cm below the waist at the centre back.` : '';
  return `Artwork on ${name} must be centred on the ${partName(product, art.part).toLowerCase()}, as seen from outside.${where}`;
}
/**
 * Artwork that a change of measurements, size or sleeves leaves off the garment is moved back onto it, as tops' front
 * and back artwork is: on bottoms up to end above the hem, then across to the nearest place on its side's part; on a
 * sleeve up or down it, then onto its centre line, then made smaller. A top without sleeves loses their artwork.
 */
export function keepArtworkInside(product: Product): void {
  if (!isBottoms(product)) {
    if (sleeveless(product)) product.artwork = product.artwork.filter(art => !isSleeveArtwork(art.part));
    if (!product.artwork.some(art => isSleeveArtwork(art.part))) return;
    const frame = sleeveArtworkFrame(product);
    for (const art of product.artwork) if (isSleeveArtwork(art.part)) fitOnSleeve(frame, art);
    return;
  }
  product.artwork = product.artwork.filter(art => !isSleeveArtwork(art.part));
  if (!product.artwork.length) return;
  const { length } = bottomsArtworkFrame(product);
  for (const art of product.artwork) {
    art.yCm = Math.max(0, Math.min(art.yCm, Math.floor((length - art.widthCm * art.height / art.width) * 10) / 10));
    const { mesh, x, y } = bottomsTarget(product, art);
    if (over(mesh, x, y)) continue;
    const near = nearestOver(mesh, x, y);
    if (near !== null) art.xCm = Math.round((art.part === 'front' ? near : -near) * 10) / 10;
  }
}
/**
 * Artwork on a sleeve is placed on the sleeve's pattern piece, as a placement print is, so it wraps round the arm and
 * follows the drape: across from the piece's centre line (which runs from the shoulder point to the middle of the
 * opening), positive to the right as seen from outside with the shoulder up, and its top below the shoulder point. Seen
 * so, the right is toward the back on the left sleeve and toward the front on the right sleeve, which is its mirror image
 * (`mirror` maps across to the piece's own x). `outline` is the piece as cut, in the 3D sleeve's flat coordinates.
 */
export function sleeveArtworkFrame(product: Product): { centre: number; length: number; outline: Pt[]; mirror: (part: ArtworkPart) => 1 | -1 } {
  const s = sleeveOutline(product);
  return { centre: (s.opening[0].x + s.opening[1].x) / 2, length: s.opening[0].y, outline: [...s.cap, s.opening[1], s.opening[0]], mirror: part => (part === 'sleeveRight' ? -1 : 1) };
}
type SleevePlaced = Pick<Artwork, 'part' | 'xCm' | 'yCm' | 'widthCm' | 'width' | 'height' | 'rotation'>;
/** The flat points of the sleeve piece under the artwork's corners, turned clockwise (as seen from outside) about its
 * centre by its rotation. */
function sleeveArtworkCorners(frame: ReturnType<typeof sleeveArtworkFrame>, art: SleevePlaced): Pt[] {
  const height = art.widthCm * art.height / art.width, angle = (art.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), mirror = frame.mirror(art.part);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const x = i! * art.widthCm / 2, y = j! * height / 2;
    return { x: frame.centre + mirror * (art.xCm + x * cos - y * sin), y: art.yCm + height / 2 + x * sin + y * cos };
  });
}
/** Where a flat point of the sleeve piece falls on the artwork's image, (0, 0) at its bottom left and (1, 1) at its top
 * right: the point is printed only inside that square. */
export function sleeveArtworkUv(frame: ReturnType<typeof sleeveArtworkFrame>, art: SleevePlaced): (x: number, y: number) => [number, number] {
  const height = art.widthCm * art.height / art.width, angle = (art.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), mirror = frame.mirror(art.part);
  return (x, y) => {
    const across = mirror * (x - frame.centre) - art.xCm, down = y - art.yCm - height / 2;
    return [(across * cos + down * sin) / art.widthCm + 0.5, 0.5 - (down * cos - across * sin) / height];
  };
}
const onSleeve = (frame: ReturnType<typeof sleeveArtworkFrame>, art: SleevePlaced) => sleeveArtworkCorners(frame, art).every(p => inside(p, frame.outline));
/** The heights (cm below the shoulder point, every half centimetre) at which the artwork's top lies with all of it on
 * the sleeve, as placed across; the piece is convex, so they run without a gap. */
function sleeveArtworkTops(frame: ReturnType<typeof sleeveArtworkFrame>, art: SleevePlaced): number[] {
  const tops: number[] = [];
  for (let y = 0; y <= frame.length; y += 0.5) if (onSleeve(frame, { ...art, yCm: y })) tops.push(y);
  return tops;
}
const nearestOf = (values: number[], to: number) => values.reduce((best, value) => (Math.abs(value - to) < Math.abs(best - to) ? value : best));
/** Why artwork would not print on a sleeve, or null when it would: it is printed on the cut sleeve before sewing, so
 * all of it must lie on the piece, clear of the seams. */
export function sleeveArtworkProblem(product: Product, art: SleevePlaced): string | null {
  const name = ARTWORK_PART_NAMES[art.part];
  if (isBottoms(product)) return `Artwork goes on the front or back of ${garmentName(product).toLowerCase()}, which have no sleeves.`;
  if (sleeveless(product)) return `A sleeveless top has no ${name} for artwork.`;
  const frame = sleeveArtworkFrame(product);
  if (onSleeve(frame, art)) return null;
  const tops = sleeveArtworkTops(frame, art), cm = (value: number) => `${Math.round(value * 10) / 10} cm`;
  return `Artwork on the ${name} must lie within the sleeve, clear of its seams: ${tops.length
    ? `as wide and as far across as this, its top can be from ${cm(tops[0]!)} to ${cm(tops.at(-1)!)} below the shoulder point.`
    : `${cm(art.widthCm)} wide${art.xCm ? ` and ${cm(Math.abs(art.xCm))} from the centre line` : ''}, it does not fit. Make it smaller${art.xCm ? ' or move it toward the centre line' : ''}.`}`;
}
/** Artwork moved back onto its sleeve: to the nearest height where it fits, else onto the centre line, else smaller. */
function fitOnSleeve(frame: ReturnType<typeof sleeveArtworkFrame>, art: Artwork): void {
  if (onSleeve(frame, art)) return;
  for (const xCm of [art.xCm, 0]) {
    const tops = sleeveArtworkTops(frame, { ...art, xCm });
    if (tops.length) { art.xCm = xCm; art.yCm = nearestOf(tops, art.yCm); return; }
  }
  for (let widthCm = Math.floor(art.widthCm * 2) / 2 - 0.5; widthCm >= LIMITS.artworkWidthCm[0]; widthCm -= 0.5) {
    const tops = sleeveArtworkTops(frame, { ...art, xCm: 0, widthCm });
    if (tops.length) { Object.assign(art, { xCm: 0, widthCm, yCm: nearestOf(tops, art.yCm) }); return; }
  }
}

/** Where new artwork goes on a side: centred 10 cm below the shoulder on tops (12 behind); on trousers and shorts on the
 * wearer's left hip at the front and the right hip behind, halfway from the centre seam to the side as seen from that
 * side; centred below a skirt's waist. */
export function artworkDefaults(product: Product, side: Artwork['part'], image: { width: number; height: number; rotation?: number } = { width: 1, height: 1 }): { xCm: number; yCm: number; widthCm: number } {
  if (isSleeveArtwork(side)) {
    // On the upper arm: on the centre line with its top 5 cm below the shoulder point, or as near that as it fits, up
    // to 8 cm wide (smaller on a narrow sleeve). Turned to run down the sleeve, it is up to 24 cm long instead.
    const frame = sleeveArtworkFrame(product), placed = { part: side, xCm: 0, yCm: 5, widthCm: 8, ...image };
    const along = Math.abs((Math.abs(image.rotation ?? 0) % 180) - 90) < 45;
    for (let widthCm = along ? Math.min(24, Math.floor(frame.length - 6)) : 8; widthCm >= LIMITS.artworkWidthCm[0]; widthCm -= 0.5) {
      const tops = sleeveArtworkTops(frame, { ...placed, widthCm });
      if (tops.length) return { xCm: 0, yCm: nearestOf(tops, 5), widthCm };
    }
    return { xCm: 0, yCm: 5, widthCm: LIMITS.artworkWidthCm[0] };
  }
  if (product.base === 'skirt') return { xCm: 0, yCm: 12, widthCm: Math.min(16, Math.round(skirtDraft(product).waist / 6)) };
  if (isBottoms(product)) {
    const hip = legMeasurements(product).hip, yCm = side === 'front' ? 12 : 8, widthCm = side === 'front' ? Math.min(10, Math.round(hip / 10)) : Math.min(8, Math.round(hip / 12));
    // The side of the hips, seen from that side, at the height of a print half as tall as it is wide.
    const { mesh, y } = bottomsTarget(product, { part: side, xCm: 0, yCm, widthCm, width: 2, height: 1 });
    let edge = 0;
    while (edge < 80 && over(mesh, side === 'front' ? edge + 0.5 : -(edge + 0.5), y)) edge += 0.5;
    return { xCm: Math.round(edge / 2), yCm, widthCm };
  }
  return { xCm: 0, yCm: side === 'front' ? 10 : 12, widthCm: Math.min(24, topMeasurements(product).chest / 4) };
}

function validateArtwork(value: unknown, measurements: Measurements | null): Artwork {
  const rotated = !!value && typeof value === 'object' && Object.hasOwn(value, 'rotation');
  const a = plain(value, ['part', 'dataUrl', 'width', 'height', 'name', 'xCm', 'yCm', 'widthCm', ...(rotated ? ['rotation'] : [])], 'Artwork');
  if (!ARTWORK_PARTS.includes(a.part as ArtworkPart)) fail('Artwork goes on the front, the back or a sleeve.');
  if (typeof a.dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(a.dataUrl) || a.dataUrl.length > LIMITS.artworkBytes * 1.4) fail('Artwork must be a PNG, JPEG or WebP image of at most 1.5 MB.');
  const width = finite(a.width, [1, 4096], 'Artwork pixel width'), height = finite(a.height, [1, 4096], 'Artwork pixel height');
  if (!Number.isInteger(width) || !Number.isInteger(height)) fail('Artwork pixel size must be whole numbers.');
  validateRasterHeader({dataUrl:a.dataUrl as string,width,height}, LIMITS.artworkBytes, 4096);
  if (typeof a.name !== 'string' || a.name.length > 120) fail('Artwork name must be at most 120 characters.');
  // Bottoms' and sleeves' bounds are checked once the garment is whole (see bottomsArtworkFrame and sleeveArtworkFrame).
  const panel = measurements && !isSleeveArtwork(a.part as ArtworkPart) ? panelSize(measurements) : { width: 400, length: 200 };
  const widthCm = finite(a.widthCm, LIMITS.artworkWidthCm, 'Artwork width (cm)');
  return { part: a.part as Artwork['part'], dataUrl: a.dataUrl as string, width, height, name: a.name as string, xCm: finite(a.xCm, [-panel.width / 2, panel.width / 2], 'Artwork horizontal position (cm)'),
    yCm: finite(a.yCm, [0, panel.length], measurements ? 'Artwork distance below the neck (cm)' : 'Artwork distance below the waist (cm)'), widthCm,
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

const OPTIONAL = ['spec', 'colorways', 'costing', 'motifs', 'options', 'fit', 'palette'] as const;
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
    const has = (key: string) => !!p.measurements && typeof p.measurements === 'object' && Object.hasOwn(p.measurements, key);
    const band = has('waistbandHeight'), cuffs = has('cuffHeight');
    const m = plain(p.measurements, ['waist', 'hip', 'rise', 'inseam', 'legOpening', ...(band ? ['waistbandHeight'] : []), ...(cuffs ? ['cuffHeight'] : [])], 'Leg measurements');
    measurements = { waist: finite(m.waist, LIMITS.waist, 'Waist (cm)'), hip: finite(m.hip, LIMITS.hip, 'Hip (cm)'), rise: finite(m.rise, LIMITS.rise, 'Front rise (cm)'),
      inseam: finite(m.inseam, LIMITS.inseam, 'Inseam (cm)'), legOpening: finite(m.legOpening, LIMITS.legOpening, 'Leg opening (cm)'),
      ...(band ? { waistbandHeight: finite(m.waistbandHeight, LIMITS.waistbandHeight, 'Waistband height (cm)') } : {}),
      ...(cuffs ? { cuffHeight: finite(m.cuffHeight, LIMITS.legCuffHeight, 'Cuff height (cm)') } : {}) };
    if (cuffs && measurements.inseam < 35) fail('Shorts have no ankle cuffs: lengthen the inseam to make joggers.');
    if (measurements.hip < measurements.waist) fail('Hip must be at least the waist: the waistband has to pull on over the hips.');
    if (measurements.legOpening > measurements.hip * 0.8) fail('Leg opening must be narrower than the thigh (at most 80% of the hip).');
  } else {
    const has = (key: string) => !!p.measurements && typeof p.measurements === 'object' && Object.hasOwn(p.measurements, key);
    const gathered = has('gather'), puffed = has('sleeveGather');
    const m = plain(p.measurements, ['chest', 'length', 'sleeve', ...(gathered ? ['gather'] : []), ...(puffed ? ['sleeveGather'] : [])], 'Measurements');
    // A tee's sleeve length of 0 makes it sleeveless.
    const sleeve = base === 'tee' && m.sleeve === 0 ? 0 : finite(m.sleeve, LIMITS.sleeve, base === 'tee' ? 'Sleeve length (cm; 0 for sleeveless)' : 'Sleeve length (cm)');
    measurements = { chest: finite(m.chest, LIMITS.chest, 'Chest (cm)'), length: finite(m.length, LIMITS.length, 'Body length (cm)'), sleeve,
      ...(gathered ? { gather: finite(m.gather, DRESS_GATHER, 'Skirt gathering (× waist seam)') } : {}),
      ...(puffed ? { sleeveGather: finite(m.sleeveGather, SLEEVE_GATHER, 'Sleeve cap gathering (× armhole)') } : {}) };
    if (puffed && (base !== 'tee' || sleeve === 0)) fail(base === 'tee' ? 'A sleeveless top has no sleeves to puff: give it sleeves first.' : 'Puff sleeves go on T-shirts, shirts and tee dresses; a sweatshirt\'s sleeves end in rib cuffs.');
  }
  if (p.neckline !== 'crew' && p.neckline !== 'v') fail('Neckline must be crew or v.');
  if (base === 'hoodie' && p.neckline !== 'crew') fail('A hoodie has a hood, not a V-neck.');
  if (isBottoms({base}) && p.neckline !== 'crew') fail('Bottoms have no neckline.');
  let options: Options | undefined;
  if (p.options !== undefined) {
    const o = plain(p.options, ['hem', 'chestPocket', ...(['zip', 'zipOpen', 'collar', 'buttons', 'waistSeam', 'yoke', 'cuffs', 'coat', 'backPockets', 'frontPockets', 'fly', 'beltLoops'] as const).filter(key => Object.hasOwn(p.options as object, key))], 'Modules');
    if (!HEMS.includes(o.hem as Hem)) fail('Hem must be straight or curved.');
    if (typeof o.chestPocket !== 'boolean') fail('Chest pocket must be on or off.');
    if (o.zip !== undefined && typeof o.zip !== 'boolean') fail('Front zip must be on or off.');
    if (!hemAllowed(base, o.hem as Hem)) fail('Only a tee can have a curved hem; banded hems stay straight.');
    if (o.chestPocket && !chestPocketAllowed(base)) fail('A hoodie has a kangaroo pocket instead of a chest pocket.');
    if (o.zip && !zipAllowed(base)) fail('Only a hoodie or a sweatshirt can have a front zip.');
    if (o.zipOpen !== undefined && typeof o.zipOpen !== 'boolean') fail('An open zip must be open or closed.');
    if (o.buttons !== undefined && typeof o.buttons !== 'boolean') fail('A button front must be on or off.');
    if (o.buttons && !buttonsAllowed(base)) fail('A button front goes on a T-shirt, to make a shirt.');
    if (o.zipOpen && !o.zip && !o.buttons) fail('Only a garment with a front zip or buttons can be worn open.');
    if (o.collar !== undefined && typeof o.collar !== 'boolean') fail('A polo collar must be on or off.');
    if (o.collar && !collarAllowed(base)) fail('A collar goes on a T-shirt (a polo collar) or a sweatshirt (a stand collar).');
    if (o.collar && p.neckline !== 'crew') fail('A collar is sewn to a round neck.');
    if (o.waistSeam !== undefined && typeof o.waistSeam !== 'boolean') fail('A waist seam must be on or off.');
    if (o.yoke !== undefined && typeof o.yoke !== 'boolean') fail('A back yoke must be on or off.');
    if (o.yoke && !yokeAllowed(base, o as Pick<Options, 'buttons'>)) fail('A back yoke goes on a shirt with a button front, or on trousers.');
    if (o.backPockets !== undefined && typeof o.backPockets !== 'boolean') fail('Back pockets must be on or off.');
    if (o.backPockets && !backPocketsAllowed(base)) fail('Back pockets go on trousers or shorts.');
    if (o.frontPockets !== undefined && typeof o.frontPockets !== 'boolean') fail('Front pockets must be on or off.');
    if (o.frontPockets && !frontPocketsAllowed(base)) fail('Front pockets go on trousers or shorts.');
    if (o.fly !== undefined && typeof o.fly !== 'boolean') fail('A fly front must be on or off.');
    if (o.fly && !flyAllowed(base)) fail('A fly front goes on trousers or shorts.');
    if (o.beltLoops !== undefined && typeof o.beltLoops !== 'boolean') fail('Belt loops must be on or off.');
    if (o.beltLoops && !beltLoopsAllowed(base, o as Pick<Options, 'fly'>)) fail('Belt loops go on trousers or shorts with a fly front.');
    if (o.cuffs !== undefined && typeof o.cuffs !== 'boolean') fail('Shirt cuffs must be on or off.');
    if (o.cuffs && !cuffsAllowed({ base, measurements: measurements as Product['measurements'] }, o as unknown as Options)) fail(`Cuffs go on a long-sleeved shirt with a button front and sleeves of at least ${CUFFED_SLEEVE} cm.`);
    if (o.waistSeam && !waistSeamAllowed({ base, measurements: measurements as Product['measurements'] })) fail(`A waist seam goes on a T-shirt dress, at least ${DRESS_LENGTH} cm long: lengthen it or take the waist seam off.`);
    if (o.coat !== undefined && typeof o.coat !== 'boolean') fail('A coat must be on or off.');
    if (o.coat && !coatAllowed({ base, measurements: measurements as Product['measurements'] }, o as unknown as Options)) fail(`A coat is a shirt at least ${COAT_LENGTH} cm long, with a button front, a collar and sleeves of at least ${CUFFED_SLEEVE} cm.`);
    if (o.coat && o.waistSeam) fail('A coat is not cut at the waist.');
    options = { hem: o.hem as Hem, chestPocket: o.chestPocket as boolean, ...(o.zip ? { zip: true } : {}), ...(o.buttons ? { buttons: true } : {}),
      ...((o.zip || o.buttons) && o.zipOpen ? { zipOpen: true } : {}), ...(o.collar ? { collar: true } : {}), ...(o.waistSeam ? { waistSeam: true } : {}), ...(o.yoke ? { yoke: true } : {}), ...(o.cuffs ? { cuffs: true } : {}), ...(o.coat ? { coat: true } : {}), ...(o.backPockets ? { backPockets: true } : {}), ...(o.frontPockets ? { frontPockets: true } : {}), ...(o.fly ? { fly: true } : {}), ...(o.fly && o.beltLoops ? { beltLoops: true } : {}) };
  }
  const ids = partsOf({ base, options, measurements });
  let fit: Fit | undefined;
  if (p.fit !== undefined) {
    if (isBottoms({base})) fail('Fit measurements are for tops; bottoms use their own measurements.');
    const raw = p.fit && typeof p.fit === 'object' && !Array.isArray(p.fit) ? Object.keys(p.fit as object) : [];
    const f = plain(p.fit, raw.filter(key => FIT_KEYS.includes(key as FitKey)).length === raw.length ? raw : FIT_KEYS, 'Fit');
    fit = Object.fromEntries(Object.keys(f).map(key => [key, finite(f[key], LIMITS.fit[key as FitKey], `${FIT_NAMES[key as FitKey]} (cm)`)])) as Fit;
    checkFit({ base, measurements: measurements as Measurements, neckline: p.neckline as Product['neckline'], fit, options });
  }
  checkChestPocket({ base, measurements, neckline: p.neckline as Product['neckline'], fit, options });
  checkGather({ base, measurements, neckline: p.neckline as Product['neckline'], fit, options });
  const motifs = p.motifs !== undefined ? validateMotifs(p.motifs) : undefined;
  const uploaded = new Set((motifs ?? []).map(m => m.id));
  const parts = validateParts(p.parts, uploaded, ids);
  if (!Array.isArray(p.artwork) || p.artwork.length > ARTWORK_PARTS.length) fail('Place at most one artwork on each of the front, the back and the sleeves.');
  const artwork = (p.artwork as unknown[]).map(item => validateArtwork(item, isBottoms({ base }) ? null : measurements as Measurements));
  if (new Set(artwork.map(item => item.part)).size !== artwork.length) fail('Place at most one artwork on each side and sleeve.');
  let spec: Spec | undefined;
  if (p.spec !== undefined) {
    const raw = plain(p.spec, ['styleNumber', 'season', 'sampleSize'], 'Tech pack details');
    if (!SIZES.includes(raw.sampleSize as Size)) fail('Sample size must be XS, S, M, L or XL.');
    spec = { styleNumber: plainText(raw.styleNumber, 40, 'Style number'), season: plainText(raw.season, 40, 'Season'), sampleSize: raw.sampleSize as Size };
  }
  let palette: string[] | undefined;
  if (p.palette !== undefined) {
    if (!Array.isArray(p.palette) || !p.palette.length || p.palette.length > 8) fail('Keep 1–8 photo colours.');
    palette = (p.palette as unknown[]).map(colour => hex(colour, 'Photo colour'));
    if (new Set(palette).size !== palette.length) fail('Photo colours must differ.');
  }
  const product: Product = { base, name: (p.name as string).trim(), measurements, neckline: p.neckline as Product['neckline'], parts, artwork, ...(spec ? { spec } : {}),
    ...(p.colorways !== undefined ? { colorways: validateColorways(p.colorways, uploaded, ids) } : {}), ...(p.costing !== undefined ? { costing: validateCosting(p.costing) } : {}),
    ...(motifs ? { motifs } : {}), ...(palette ? { palette } : {}), ...(options ? { options } : {}), ...(fit && Object.keys(fit).length ? { fit } : {}) };
  for (const art of artwork) {
    const problem = isSleeveArtwork(art.part) ? sleeveArtworkProblem(product, art) : isBottoms(product) ? bottomsArtworkProblem(product, art) : null;
    if (problem) fail(problem);
  }
  return product;
}

const style = (material: string, color: string, print: Print | null = null): PartStyle => ({ material, color, print });
const allParts = (part: PartStyle, overrides: Partial<Record<PartId, PartStyle>> = {}, base: Base = 'tee') =>
  Object.fromEntries(BASE_PARTS[base].map(id => [id, overrides[id] ?? (RIB_PARTS.has(id) ? { ...part, material: 'rib-220', print: null } : part)])) as Record<PartId, PartStyle>;
const measurements: Measurements = { chest: 104, length: 72, sleeve: 21 };
// A polo's parts: the body fabric, a matching flat-knit collar in place of the neck rib, and a placket.
const polo = (body: PartStyle) => {
  const parts: Partial<Record<PartId, PartStyle>> = allParts(body);
  delete parts.neckband;
  return { ...parts, collar: { ...body, material: 'rib-220', print: null }, placket: { ...body } } as Record<PartId, PartStyle>;
};
const fleece: Measurements = { chest: 112, length: 70, sleeve: 62 };
// A shirt's parts: all in its own woven fabric, the collar and buttoned placket too, with a chest pocket.
const shirt = (body: PartStyle) => {
  const parts: Partial<Record<PartId, PartStyle>> = allParts(body);
  delete parts.neckband;
  return { ...parts, collar: { ...body }, placket: { ...body }, chestPocket: { ...body } } as Record<PartId, PartStyle>;
};
// A coat's parts: all in its own woven fabric, the collar and buttoned placket too.
const coat = (body: PartStyle) => {
  const parts: Partial<Record<PartId, PartStyle>> = allParts(body);
  delete parts.neckband;
  return { ...parts, collar: { ...body }, placket: { ...body } } as Record<PartId, PartStyle>;
};
// A bomber jacket's parts: the shell fabric, and rib cuffs, hem band and stand collar in place of the neck rib.
const bomber = (shell: PartStyle, rib: PartStyle) => {
  const parts: Partial<Record<PartId, PartStyle>> = allParts(shell, { cuffLeft: rib, cuffRight: rib, hemBand: rib }, 'sweatshirt');
  delete parts.neckband;
  return { ...parts, collar: rib } as Record<PartId, PartStyle>;
};
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
  { id: 'tank-top', name: 'Tank top', description: 'Black cotton jersey, sleeveless, with narrow shoulders and a low front neck.',
    product: { base: 'tee', name: 'Tank top', measurements: { chest: 96, length: 68, sleeve: 0 }, neckline: 'crew', fit: { shoulderWidth: 34, neckWidth: 18, armholeDepth: 24, frontNeckDrop: 12 },
      parts: Object.fromEntries(Object.entries(allParts(style('jersey-180', '#1d1f1e'))).filter(([id]) => !id.startsWith('sleeve'))) as Record<PartId, PartStyle>, artwork: [] } },
  { id: 'crop-top', name: 'Crop top', description: 'A boxy cropped tee in sage cotton jersey that ends above the waist.',
    product: { base: 'tee', name: 'Crop top', measurements: { chest: 100, length: 46, sleeve: 19 }, neckline: 'crew', parts: allParts(style('jersey-180', '#9fae91'), { neckband: style('rib-220', '#9fae91') }), artwork: [] } },
  { id: 'tee-dress', name: 'T-shirt dress', description: 'A knee-length jersey dress that flares gently from the hips.',
    product: { base: 'tee', name: 'T-shirt dress', measurements: { ...measurements, length: 100 }, neckline: 'crew', fit: { hemWidth: 64 },
      parts: allParts(style('jersey-240', '#2f3b33'), { neckband: style('rib-220', '#2f3b33') }), artwork: [] } },
  { id: 'fit-flare', name: 'Fit-and-flare dress', description: 'Navy jersey shaped at the waist and cut into a bodice and a polka-dot skirt that flares to the knee.',
    product: { base: 'tee', name: 'Fit-and-flare dress', measurements: { chest: 96, length: 95, sleeve: 21 }, neckline: 'crew', fit: { waistWidth: 40, hemWidth: 76 },
      options: { hem: 'straight', chestPocket: false, waistSeam: true },
      parts: { ...allParts(style('jersey-240', '#1f2a4f'), { neckband: style('rib-220', '#1f2a4f') }),
        skirtFront: style('jersey-240', '#1f2a4f', { motif: 'dots', color: '#f4efe3', scaleCm: 4, layout: 'half-drop' }),
        skirtBack: style('jersey-240', '#1f2a4f', { motif: 'dots', color: '#f4efe3', scaleCm: 4, layout: 'half-drop' }) }, artwork: [] } },
  { id: 'polo', name: 'Polo shirt', description: 'Navy cotton piqué with a flat-knit collar and a three-button placket.',
    product: { base: 'tee', name: 'Polo shirt', measurements: { ...measurements, chest: 106, length: 72, sleeve: 22 }, neckline: 'crew', options: { hem: 'straight', chestPocket: false, collar: true },
      parts: polo(style('pique-200', '#1f2a4f')), artwork: [] } },
  { id: 'bomber', name: 'Bomber jacket', description: 'Sage nylon poplin with a front zip, rib stand collar, cuffs and hem band.',
    product: { base: 'sweatshirt', name: 'Bomber jacket', measurements: { ...fleece, chest: 116, length: 64 }, neckline: 'crew',
      options: { hem: 'straight', chestPocket: false, zip: true, collar: true }, parts: bomber(style('nylon-150', '#5b6346'), style('rib-220', '#474d37')), artwork: [] } },
  { id: 'shirt', name: 'Oxford shirt', description: 'Pale blue cotton poplin with a button front, shirt collar, chest pocket and curved hem.',
    product: { base: 'tee', name: 'Oxford shirt', measurements: { chest: 108, length: 76, sleeve: 62 }, neckline: 'crew',
      options: { hem: 'curved', chestPocket: true, buttons: true, collar: true }, parts: shirt(style('poplin-120', '#c9d8ec')), artwork: [] } },
  { id: 'coat', name: 'Wool coat', description: 'Knee-length charcoal wool twill with a button front and collar, cut roomy to go over a shirt or tee.',
    product: { base: 'tee', name: 'Wool coat', measurements: { chest: 118, length: 96, sleeve: 64 }, neckline: 'crew',
      options: { hem: 'straight', chestPocket: false, buttons: true, collar: true, coat: true }, parts: coat(style('wool-260', '#3f3b38')), artwork: [] } },
  { id: 'crew-sweat', name: 'Crew sweatshirt', description: 'Heather grey French terry with rib neck, cuffs and hem.',
    product: { base: 'sweatshirt', name: 'Crew sweatshirt', measurements: fleece, neckline: 'crew', parts: allParts(style('terry-300', '#b7b4ad'), {}, 'sweatshirt'), artwork: [] } },
  { id: 'sweat-dress', name: 'Sweatshirt dress', description: 'Oatmeal French terry, long sleeves and a rib hem above the knee.',
    product: { base: 'sweatshirt', name: 'Sweatshirt dress', measurements: { ...fleece, length: 92 }, neckline: 'crew', fit: { hemWidth: 60 }, parts: allParts(style('terry-300', '#d8cbb3'), {}, 'sweatshirt'), artwork: [] } },
  { id: 'hoodie', name: 'Pullover hoodie', description: 'Navy French terry with a hood, kangaroo pocket and rib trims.',
    product: { base: 'hoodie', name: 'Pullover hoodie', measurements: { ...fleece, length: 72 }, neckline: 'crew', parts: allParts(style('terry-300', '#1f2a4f'), {}, 'hoodie'), artwork: [] } },
  { id: 'zip-hoodie', name: 'Zip hoodie', description: 'Heather grey French terry with a centre-front zip, split kangaroo pocket and rib trims.',
    product: { base: 'hoodie', name: 'Zip hoodie', measurements: { ...fleece, length: 72 }, neckline: 'crew', options: { hem: 'straight', chestPocket: false, zip: true }, parts: allParts(style('terry-300', '#9a9c9a'), {}, 'hoodie'), artwork: [] } },
  { id: 'shorts', name: 'Pull-on shorts', description: 'Washed linen shorts with an elasticated waistband.',
    product: { base: 'trousers', name: 'Pull-on shorts', measurements: { ...legFit, inseam: 18, legOpening: 58 }, neckline: 'crew', parts: allParts(style('linen-170', '#c9b48f'), {}, 'trousers'), artwork: [] } },
  { id: 'flared-skirt', name: 'Flared skirt', description: 'Two measured linen panels, with editable waist, hem and slant.',
    product: { base: 'skirt', name: 'Flared skirt', measurements: { waist: 80, hem: 140, slant: 60 }, neckline: 'crew', parts: allParts(style('linen-170', '#9fae91'), {}, 'skirt'), artwork: [] } },
  { id: 'gathered-skirt', name: 'Gathered skirt', description: 'Floral cotton poplin gathered into a 4 cm waistband.',
    product: { base: 'skirt', name: 'Gathered skirt', measurements: { waist: 72, hem: 150, slant: 62, waistbandHeight: 4, gather: 1.6 }, neckline: 'crew',
      parts: { ...allParts(style('poplin-120', '#f3ead8', { motif: 'floral', color: '#b5523b', scaleCm: 5, layout: 'half-drop' }), {}, 'skirt'), waistband: style('poplin-120', '#b5523b') }, artwork: [] } },
  { id: 'pleated-skirt', name: 'Pleated skirt', description: 'Grey wool twill with 24 pressed knife pleats, sewn into a 4 cm waistband.',
    product: { base: 'skirt', name: 'Pleated skirt', measurements: { waist: 72, hem: 120, slant: 60, waistbandHeight: 4, pleats: { style: 'knife', count: 24, depth: 1.5 } }, neckline: 'crew',
      parts: { ...allParts(style('wool-260', '#8b8e93'), {}, 'skirt'), waistband: style('wool-260', '#8b8e93') }, artwork: [] } },
  { id: 'pencil-skirt', name: 'Pencil skirt', description: 'Charcoal wool twill, fitted to a 96 cm hip with waist darts and narrowing to the hem, on a 3 cm waistband.',
    product: { base: 'skirt', name: 'Pencil skirt', measurements: { waist: 70, hem: 90, slant: 60, waistbandHeight: 3, hip: 96 }, neckline: 'crew',
      parts: { ...allParts(style('wool-260', '#45484e'), {}, 'skirt'), waistband: style('wool-260', '#45484e') }, artwork: [] } },
  { id: 'joggers', name: 'Joggers', description: 'Heather grey French terry, tapered leg gathered into rib ankle cuffs, elasticated waist.',
    product: { base: 'trousers', name: 'Joggers', measurements: { ...legFit, inseam: 74, legOpening: 36, cuffHeight: 8 }, neckline: 'crew',
      parts: { ...allParts(style('terry-300', '#9a9c9a'), {}, 'trousers'), cuffLeft: style('rib-220', '#9a9c9a'), cuffRight: style('rib-220', '#9a9c9a') }, artwork: [] } },
  { id: 'trousers', name: 'Straight trousers', description: 'Indigo denim twill, straight leg, elasticated waist.',
    product: { base: 'trousers', name: 'Straight trousers', measurements: legFit, neckline: 'crew', parts: allParts(style('denim-340', '#2d3f5c'), {}, 'trousers'), artwork: [] } },
  { id: 'jeans', name: 'Jeans', description: 'Dark indigo denim with a zip fly, a buttoned waistband with belt loops, scoop front pockets, a back yoke and back patch pockets, straight leg.',
    product: { base: 'trousers', name: 'Jeans', measurements: legFit, neckline: 'crew', options: { hem: 'straight', chestPocket: false, yoke: true, backPockets: true, frontPockets: true, fly: true, beltLoops: true },
      parts: { ...allParts(style('denim-340', '#26324a'), {}, 'trousers'), yoke: style('denim-340', '#26324a'), backPocket: style('denim-340', '#26324a'), frontPocket: style('denim-340', '#26324a'), beltLoop: style('denim-340', '#26324a') }, artwork: [] } },
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
/** The sleeve cap is cut this much longer than the armhole it is sewn into: a little ease, as knits need. */
export const CAP_EASE = 0.03;

/** How much further the front armhole scoops in at its lower curve than the back, cm: the front of the arm sits forward. */
export const FRONT_SCOOP_CM = 1.2;
/**
 * A body piece's left armhole in pattern cm (y down from the neck points, the side seam at x = 0), from the shoulder
 * point down to the underarm: it runs a little inside the shoulder point, across the chest or back, and turns out
 * level into the side seam. The front scoops FRONT_SCOOP_CM deeper into the chest near the underarm than the back; both
 * meet the same shoulder and underarm points, so the shoulder and side seams still match.
 */
function armholeCurve(half: number, shoulderX: number, shoulderDrop: number, armDepth: number, front: boolean): Pt[] {
  const shoulder = half - shoulderX, scoop = Math.max(1.5, shoulder + 1.5), armY = shoulderDrop + armDepth, deeper = front ? FRONT_SCOOP_CM : 0;
  const [p0, p1, p2, p3] = [{ x: shoulder, y: shoulderDrop }, { x: scoop + deeper / 3, y: shoulderDrop + armDepth * 0.5 }, { x: scoop + deeper, y: armY }, { x: 0, y: armY }];
  return Array.from({ length: 17 }, (_, i) => {
    const t = i / 16, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
  });
}
const polylineLength = (points: Pt[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
/** A sleeve cap `width` wide and `height` high, from one underarm point over the top to the other. */
const capCurve = (width: number, height: number): Pt[] =>
  Array.from({ length: 13 }, (_, i) => { const t = i / 12; return { x: t * width, y: height * (1 - Math.sin(Math.PI * t)) }; });

/** Every derived tee dimension, in cm, from one place: the 3D shell, pattern pieces and tech pack agree. */
/** Every fit point of measure of a top as it is now: edited ones as edited, the rest at their proportional values. */
export function fitValues(product: Product): Record<FitKey, number> {
  const d = teeDimensions(product);
  return { chestPocketWidth: d.chestPocketWidth, chestPocketHeight: d.chestPocketHeight, chestPocketX: d.chestPocketX, chestPocketY: d.chestPocketY, shoulderWidth: d.shoulderX * 2, shoulderDrop: d.shoulderDrop, neckWidth: d.neckHalf * 2, frontNeckDrop: d.neckDepthFront, backNeckDrop: d.neckDepthBack, neckRibHeight: d.ribHeight, cuffHeight: d.cuffHeight, hemBandHeight: d.band, hoodHeight: d.hoodHeight, hoodWidth: d.hoodWidth, armholeDepth: d.armDepth, waistWidth: d.waistHalf * 2, waistPosition: d.waistY, hemWidth: d.hemHalf * 2, sleeveOpening: d.cuffHalf };
}

export function teeDimensions(product: Product) {
  const m = topMeasurements(product), panel = panelSize(m), sleeve = sleeveSize(m), half = panel.width / 2, fit = product.fit ?? {}, shoulderDrop = fit.shoulderDrop ?? 4;
  const armDepth = fit.armholeDepth ?? m.chest * 0.23 + 2, shoulderX = (fit.shoulderWidth ?? (half * 0.86 + 1) * 2) / 2;
  const cuffHeight = product.base === 'tee' ? (optionsOf(product).cuffs ? SHIRT_CUFF_CM : 0) : fit.cuffHeight ?? BAND_CM;
  // The sleeve is drafted from its armhole: its cap rises capHeight above the underarm line and is as wide as makes it
  // CAP_EASE longer than the front and back armholes it is sewn into together (the cap itself stays symmetrical).
  const capHeight = Math.min(14, m.chest * 0.11, (m.sleeve - cuffHeight) * 0.6);
  const capLength = (polylineLength(armholeCurve(half, shoulderX, shoulderDrop, armDepth, true)) + polylineLength(armholeCurve(half, shoulderX, shoulderDrop, armDepth, false))) * (1 + CAP_EASE);
  let low = 0, high = capLength;
  for (let i = 0; i < 50; i++) { const width = (low + high) / 2; if (polylineLength(capCurve(width, capHeight)) < capLength) low = width; else high = width; }
  return {
    panelWidth: panel.width, length: m.length, half, neckHalf: (fit.neckWidth ?? (m.chest * 0.08 + 7) * 2) / 2, shoulderX, shoulderDrop,
    armDepth, sleeveLength: m.sleeve,
    // Half the hem, side seam to side seam; the side seams run straight from the underarm to it, or curve in through a
    // T-shirt's waist when it has a waist width (see seamHalfAt). The waist sits where the default body's waist is.
    hemHalf: (fit.hemWidth ?? panel.width) / 2,
    waistY: fit.waistPosition ?? waistPositionFor(m.chest), shaped: product.base === 'tee' && fit.waistWidth !== undefined,
    waistHalf: fit.waistWidth !== undefined ? fit.waistWidth / 2 : straightSeamHalf(half, (fit.hemWidth ?? panel.width) / 2, shoulderDrop + armDepth, m.length, fit.waistPosition ?? waistPositionFor(m.chest)),
    // Long sleeves taper to a rib cuff; tee sleeves stay open and wide.
    cuffHalf: fit.sleeveOpening ?? (product.base === 'tee' ? Math.max(sleeve.cuffWidth / 2, 10) : Math.max(9, m.chest * 0.1)), capWidth: low, capHeight,
    neckDepthFront: fit.frontNeckDrop ?? (product.neckline === 'v' ? 15 : 8), neckDepthBack: fit.backNeckDrop ?? 2, ribHeight: neckSize(m, product.neckline, fit).width, ribLength: neckSize(m, product.neckline, fit).length,
    band: product.base === 'tee' ? 0 : fit.hemBandHeight ?? BAND_CM, cuffHeight, sleeveAngle: sleeveAngleOf(product),
    hoodHeight: fit.hoodHeight ?? 32, hoodWidth: fit.hoodWidth ?? 26, hoodHalf: 13, pocketTop: m.length - (fit.hemBandHeight ?? BAND_CM) - 22, pocketHalfTop: panel.width * 0.27, pocketHalfBottom: panel.width * 0.31,
    // A curved hem rises this far at the side seams; the body length is still measured at the centre.
    hemCurve: optionsOf(product).hem === 'curved' ? HEM_CURVE_CM : 0,
    // Chest pocket on the wearer's left (+x seen from the front): centre, top below the shoulder line, finished size.
    chestPocketX: fit.chestPocketX ?? half * 0.45, chestPocketY: fit.chestPocketY ?? shoulderDrop + armDepth * 0.5, chestPocketWidth: fit.chestPocketWidth ?? 12, chestPocketHeight: fit.chestPocketHeight ?? 13.5,
  };
}

/**
 * Whether a top can be shaped at the waist: a T-shirt base (tee, shirt, polo, tank or tee dress). Its armhole ends at
 * least 12 cm above the hem, so there is always room for a waist line 5 cm below the underarm and above the hem.
 */
export function waistShapeable(product: Pick<Product, 'base'>): boolean { return product.base === 'tee'; }

/** The default waist position, cm below the neck points: where the waist of the body a top of this chest drapes on is. */
export function waistPositionFor(chest: number): number { return Math.round(0.44 * (chest - 10) * 2) / 2; }
function straightSeamHalf(half: number, hemHalf: number, armY: number, length: number, y: number): number {
  return half - (half - hemHalf) * (y - armY) / (length - armY);
}
/** A shaped side seam keeps the full chest width this far below the underarm, where the chest is measured (A). */
export const CHEST_LINE_CM = 2.5;
/**
 * Half a top's body piece, side seam to side seam, `y` cm below the neck points between the underarm and the hem: on a
 * straight side seam from the chest to the hem width, or, with a shaped waist, straight down to the chest line and then
 * on a smooth curve through the waist width to the hem (a monotone cubic, level at the chest line and at the waist when
 * it is the narrowest or widest point, so the seam never bulges past its widths).
 */
export function seamHalfAt(d: ReturnType<typeof teeDimensions>, y: number): number {
  const armY = d.shoulderDrop + d.armDepth;
  if (!d.shaped) return straightSeamHalf(d.half, d.hemHalf, armY, d.length, y);
  const ys = [armY + CHEST_LINE_CM, d.waistY, d.length], widths = [d.half, d.waistHalf, d.hemHalf];
  if (y <= ys[0]!) return d.half;
  const above = (widths[1]! - widths[0]!) / (ys[1]! - ys[0]!), below = (widths[2]! - widths[1]!) / (ys[2]! - ys[1]!);
  const middle = above * below <= 0 ? 0 : 2 / (1 / above + 1 / below);
  const k = y <= d.waistY ? 0 : 1, h = ys[k + 1]! - ys[k]!, t = Math.min(1, Math.max(0, (y - ys[k]!) / h));
  const [start, end] = k === 0 ? [0, middle] : [middle, below];
  return (2 * t ** 3 - 3 * t ** 2 + 1) * widths[k]! + (t ** 3 - 2 * t ** 2 + t) * h * start + (-2 * t ** 3 + 3 * t ** 2) * widths[k + 1]! + (t ** 3 - t ** 2) * h * end;
}

/** How far a flared hem reaches past the chest on each side of the flat body piece (0 when it does not). */
export function flare(product: Product): number { const d = teeDimensions(product); return Math.max(0, d.hemHalf - d.half); }

/** Edited points of measure must still make a garment: the neck inside the shoulders, the armhole and neck within the body. */
function checkFit(product: Pick<Product, 'base' | 'measurements' | 'neckline' | 'fit' | 'options'>) {
  if (product.base !== 'hoodie' && (product.fit?.hoodHeight !== undefined || product.fit?.hoodWidth !== undefined)) fail('Hood side dimensions apply only to hoodies.');
  if (product.base === 'hoodie' && product.fit?.neckRibHeight !== undefined) fail('A hoodie has a hood instead of a neck rib.');
  if (product.base === 'tee' && (product.fit?.cuffHeight !== undefined || product.fit?.hemBandHeight !== undefined)) fail('Cuff and hem band heights apply only to sweatshirts and hoodies.');
  const d = teeDimensions(product as Product), sleeves = !sleeveless(product);
  if (sleeves && d.cuffHeight && d.sleeveLength - d.cuffHeight < 2) fail('The cuff must leave at least 2 cm of measured sleeve fabric.');
  // The sleeve's underarm seams run from the cap to the opening above the cuff.
  if (sleeves && d.cuffHeight) {
    const sleeve = sleeveOutline(product as Product);
    if (sleeve.opening[0].y - sleeve.cap[0].y < 2) fail('The cuff must leave at least 2 cm along the sleeve\'s underarm seams.');
  }
  if (d.neckHalf + 4 > d.shoulderX) fail('The neck must be at least 8 cm narrower than the shoulders.');
  if (d.shoulderX > d.half + 8) fail('The shoulders can drop at most 8 cm past the chest on each side.');
  if (d.neckDepthFront + 4 > d.shoulderDrop + d.armDepth) fail('The front neck must end above the underarm.');
  if (d.shoulderDrop + d.armDepth + 12 > d.length - d.band) fail('The armhole must end at least 12 cm above the hem.');
  if (d.hemHalf < d.half * 0.7 || d.hemHalf > d.half * 1.6) fail(`Hem width (½) must be between ${(d.half * 1.4).toFixed(1)} and ${(d.half * 3.2).toFixed(1)} cm for this chest.`);
  if (WAIST_FIT_KEYS.some(key => product.fit?.[key] !== undefined) && product.base !== 'tee') fail('Waist shaping applies only to T-shirts, shirts and tee dresses; sweatshirts and hoodies are held by their hem band.');
  if (d.shaped || (product.base === 'tee' && optionsOf(product).waistSeam)) {
    const armY = d.shoulderDrop + d.armDepth, low = armY + 5, high = d.length - 5;
    if (d.waistY < low || d.waistY > high) fail(`Waist position must be between ${low.toFixed(1)} and ${high.toFixed(1)} cm below the neck points for this top, at least 5 cm below the underarm and above the hem.`);
    if (d.shaped && (d.waistHalf > d.half || d.waistHalf < d.half * 0.7)) fail(`Waist width (½) must be between ${(d.half * 1.4).toFixed(1)} and ${(d.half * 2).toFixed(1)} cm for this chest: no wider than the chest.`);
  }
  if (sleeves && d.cuffHalf * 2 > d.capWidth - 4) fail('The sleeve opening must be narrower than the sleeve at the armhole.');
}

/** A gathered skirt hangs from a waist seam, and its gathered waist edge is no longer than its hem. */
function checkGather(product: Pick<Product, 'base' | 'measurements' | 'neckline' | 'fit' | 'options'>) {
  const gather = isBottoms(product) ? undefined : (product.measurements as Measurements).gather;
  if (gather === undefined) return;
  if (product.base !== 'tee' || !optionsOf(product).waistSeam) fail('Skirt gathering goes on a dress cut at the waist: add the waist seam first.');
  const d = teeDimensions(product as Product), waist = 2 * seamHalfAt(d, d.waistY) * gather, hem = 2 * d.hemHalf;
  if (waist > hem + 1e-9) fail(`A gathered skirt's waist edge (${waist.toFixed(1)} cm a piece) must be no longer than its hem (${hem.toFixed(1)} cm): widen the hem or gather less.`);
}

/** How many times wider a dress skirt piece is cut than its 3D shell at `y` cm below the neck points: its gathering at
 * the waist seam, easing to none at the hem. */
export function skirtGatherAt(d: ReturnType<typeof teeDimensions>, gather: number, y: number): number {
  const t = Math.min(1, Math.max(0, (y - d.waistY) / (d.length - d.waistY)));
  return gather + (1 - gather) * t;
}

/** Keep an enabled finished pocket's bounding rectangle at least 0.5 cm inside the actual front sewing outline. */
function checkChestPocket(product: Pick<Product, 'base' | 'measurements' | 'neckline' | 'fit' | 'options'>) {
  if (POCKET_FIT_KEYS.some(key => product.fit?.[key] !== undefined) && !chestPocketAllowed(product.base)) fail('Chest-pocket measurements apply only to tees and sweatshirts.');
  if (!optionsOf(product).chestPocket) return;
  const design = product as Product, d = teeDimensions(design), cx = flare(design) + d.half + d.chestPocketX;
  const left = cx - d.chestPocketWidth / 2, right = cx + d.chestPocketWidth / 2, top = d.chestPocketY, bottom = top + d.chestPocketHeight;
  const rectangle = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  // A front cut as halves for a zip or button front is checked whole, and the pocket must clear the opening.
  const { zip, buttons } = optionsOf(design), split = !!zip || !!buttons;
  const outline = topBodyOutline(design, true);
  const clear = (buttons && design.base === 'tee' ? placketOf(design).width / 2 : ZIP_CLEAR) + 0.5, centre = flare(design) + d.half;
  if (split && left < centre + clear && right > centre - clear) fail(`Keep the chest pocket at least ${clear} cm from the centre front, clear of the ${buttons ? 'button placket' : 'zip'}.`);
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

export interface PatternPiece { part: PartId; outline: { x: number; y: number }[]; width: number; height: number; areaCm2: number; cutCount: number; foldLine?: [{x:number;y:number},{x:number;y:number}];
  /** Pleats: each pleat's fold line and the placement line it is folded over to, waist end first. */
  pleats?: { fold: [{ x: number; y: number }, { x: number; y: number }]; placement: [{ x: number; y: number }, { x: number; y: number }] }[];
  /** Darts: each one's left leg at the edge, its point, and its right leg at the edge. */
  darts?: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }][] }

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

/** How far a buttoned waistband reaches past the centre front for its button, and how far from the centre front a fly
 * is topstitched, cm. */
export const FLY_EXTENSION_CM = 3.5, FLY_WIDTH_CM = 3.5;
/** A belt loop's finished width and how far it reaches above and below the waistband, cm. */
export const BELT_LOOP_CM = { width: 1.2, above: 0.3, below: 0.8 } as const;

/**
 * Every derived trouser dimension in cm, from one place. Pull-on trousers have their panels cut straight at the waist
 * wide enough to pass the hips, and an elastic in the waistband gathers them to the waist. With a fly the waist is
 * fitted instead: each panel narrows from the hip line to the waist (front to a quarter of the waist, back to a quarter
 * plus 0.5 cm, eased 1 cm into the band), along a side seam that takes three quarters of the front's narrowing and half
 * the back's, and a centre seam that takes the rest; the waistband is the waist plus its button extension.
 */
export function trouserDimensions(product: Product) {
  // The inseam is measured to the bottom edge: with ankle cuffs, the leg panels stop the cuff's height short of it.
  const measured = legMeasurements(product), m = { ...measured, inseam: measured.inseam - (measured.cuffHeight ?? 0) }, waistbandHeight = m.waistbandHeight ?? WAISTBAND_CM;
  const frontHip = m.hip / 4 + 1, backHip = m.hip / 4 + 2, frontCrotch = m.hip * 0.05, backCrotch = m.hip * 0.1;
  const hipDepth = m.rise * 0.7, backRaise = 3, fly = product.base === 'trousers' && !!optionsOf(product).fly;
  const narrowing = { front: fly ? Math.max(0, frontHip - 1 - m.waist / 4) : 0, back: fly ? Math.max(0, backHip - 1 - (m.waist / 4 + 0.5)) : 0 };
  const sideIn = { front: narrowing.front * 0.75, back: narrowing.back * 0.5 }, centreIn = { front: narrowing.front * 0.25, back: narrowing.back * 0.5 };
  const unit = (value: number) => Math.min(1, Math.max(0, value));
  return {
    ...m, waistbandHeight, frontHip, backHip, frontCrotch, backCrotch, hipDepth, backRaise, length: m.rise + m.inseam, fly,
    /** The zip opening below the waistband: about six tenths of the rise, ending above the hip line. */
    flyLength: fly ? Math.min(19, Math.max(9, Math.round(m.rise * 0.6)), Math.floor(hipDepth - 1.5)) : 0,
    /** The side seam's place across a front or back panel's pattern `y` cm below the top of its centre seam, from
     * 0.5 cm in at the waist (and the fitted waist's narrowing) to the panel's side at the hip line. */
    sideAt: (front: boolean, y: number) => { const t = unit((y - (front ? 0 : backRaise)) / hipDepth); return 0.5 * (1 - t) + (front ? sideIn.front : sideIn.back) * (1 - t) ** 2; },
    /** The centre seam's place across a panel's pattern `y` cm below its top, above the hip line. */
    centreAt: (front: boolean, y: number) => { const t = unit(y / ((front ? 0 : backRaise) + hipDepth)); return (front ? frontHip : backHip) - 0.5 * (1 - t) - (front ? centreIn.front : centreIn.back) * (1 - t) ** 2; },
    outseam: m.rise + measured.inseam + waistbandHeight, frontHem: m.legOpening / 2 - 1, backHem: m.legOpening / 2 + 1,
    // A leg is one front and one back panel; measured 2.5 cm below the crotch, after the crotch curve.
    thighHalf: (frontHip + frontCrotch + backHip + backCrotch) / 2 - 1,
    elastic: m.waist - 4, waistbandLength: fly ? m.waist + FLY_EXTENSION_CM : m.hip + 6,
    // How much hip the trousers pass over: a pull-on waistband's length (with a fly, the same though it opens).
    hipRoom: m.hip + 6,
    // Ankle cuffs (joggers): rib cut a third shorter than the leg opening, which it gathers.
    cuffHeight: m.cuffHeight ?? 0, cuffLength: m.legOpening * 0.66, finishedInseam: measured.inseam,
    // The 3D view: gathered waist, hip and the leg's centre and half-width at the hem.
    waistHalf: m.waist / 4 + 1.5, hipHalf: m.hip / 4 + 1.5,
  };
}

function makePiece(part: PartId, outline: { x: number; y: number }[], cutCount: number): PatternPiece {
  return { part, outline, cutCount, width: Math.max(...outline.map(p => p.x)), height: Math.max(...outline.map(p => p.y)), areaCm2: area(outline) };
}

/** Front and back leg panels (each cut as a mirrored pair, side seam on the left) and the folded waistband. */
function trouserPieces(product: Product): PatternPiece[] {
  const d = trouserDimensions(product), steps = d.fly ? 6 : 1;
  // A panel's outline: across the top from the side seam to the centre seam, down the centre seam and its crotch curve,
  // across the hem and up the side seam, whose points above `below` cm (a front pocket's depth) are left out.
  const panel = (front: boolean, below = 0) => {
    const hip = front ? d.frontHip : d.backHip, crotch = front ? d.frontCrotch : d.backCrotch, raise = front ? 0 : d.backRaise;
    const hem = front ? d.frontHem : d.backHem, centre = (hip + crotch) / 2, hipY = raise + d.hipDepth, crotchY = raise + d.rise, hemY = crotchY + d.inseam;
    // The back rises 3 cm higher at the centre back seam than at the side.
    const pts = [{ x: d.sideAt(front, raise), y: raise }, { x: d.centreAt(front, 0), y: 0 }];
    // A fly's facing is cut on to each front leg (the right one folds under as the shield), FLY_EXTENSION_CM past the
    // centre front from the waist to a little below the zip, where it curves back in.
    const flyEnd = front && d.fly ? d.flyLength + 1 : 0;
    if (flyEnd) {
      for (let i = 0; i <= 4; i++) { const y = (d.flyLength - 2) * i / 4; pts.push({ x: d.centreAt(true, y) + FLY_EXTENSION_CM, y }); }
      for (let i = 1; i <= 3; i++) { const t = Math.PI / 2 * i / 3, y = d.flyLength - 2 + 3 * Math.sin(t); pts.push({ x: d.centreAt(true, y) + FLY_EXTENSION_CM * Math.cos(t), y }); }
    }
    // Centre seam: down to the hip line (curving out from a fitted waist), then the crotch curve out to the inseam.
    for (let i = 1; i < steps; i++) { const y = hipY * i / steps; if (y > flyEnd) pts.push({ x: d.centreAt(front, y), y }); }
    for (let i = 0; i <= 6; i++) { const t = Math.PI / 2 * i / 6; pts.push({ x: hip + crotch * (1 - Math.cos(t)), y: hipY + (crotchY - hipY) * Math.sin(t) }); }
    pts.push({ x: centre + hem / 2, y: hemY }, { x: centre - hem / 2, y: hemY }, { x: 0, y: hipY });
    for (let i = steps - 1; i > 0; i--) { const y = raise + d.hipDepth * i / steps; if (y > below) pts.push({ x: d.sideAt(front, y), y }); }
    return pts;
  };
  const band = [{ x: 0, y: 0 }, { x: d.waistbandLength, y: 0 }, { x: d.waistbandLength, y: d.waistbandHeight * 2 }, { x: 0, y: d.waistbandHeight * 2 }];
  const cuff = [{ x: 0, y: 0 }, { x: d.cuffLength, y: 0 }, { x: d.cuffLength, y: d.cuffHeight * 2 }, { x: 0, y: d.cuffHeight * 2 }];
  const cuffs = d.cuffHeight ? [makePiece('cuffLeft', cuff, 1), makePiece('cuffRight', cuff.map(p => ({ ...p })), 1)] : [];
  // A yoke is cut off the top of each back panel along its seam (see trouserYoke), from the side seam to the centre
  // back seam; the back panel below it starts at its top.
  const yoke = optionsOf(product).yoke ? trouserYoke(product) : null, back = panel(false);
  let backs = [makePiece('back', back, 2)];
  if (yoke) {
    const side = { x: d.sideAt(false, d.backRaise + yoke.side), y: d.backRaise + yoke.side }, centre = { x: d.centreAt(false, yoke.back), y: yoke.back };
    const below = clipByLine(back, side, centre, false), top = Math.min(...below.map(q => q.y));
    backs = [makePiece('yoke', clipByLine(back, side, centre, true), 2), makePiece('back', below.map(q => ({ x: q.x, y: q.y - top })), 2)];
  }
  // Each back pocket: its finished shape plus the hem folded down at its top.
  const pocket = optionsOf(product).backPockets ? backPocketOf(product) : null;
  const pockets = pocket ? [makePiece('backPocket', backPocketOutline(pocket.width, pocket.height + POCKET_FOLD_CM, pocket.point + POCKET_FOLD_CM, 0, 0), 2)] : [];
  // Front scoop pockets: the front panel is cut away along the pocket's edge, from the waist to the side seam, and the
  // facing behind the opening is cut from the corner it leaves, 3 cm deeper so the panel's edge lies over it.
  let front = panel(true), facings: PatternPiece[] = [];
  if (optionsOf(product).frontPockets) {
    const edge = frontPocketEdge(product), facing = frontPocketEdge(product, FRONT_POCKET_FACING_CM), depth = frontPocketOf(product).depth;
    // From the pocket's corner at the waist round the panel to its side seam below the pocket, then back up its edge.
    front = [edge[0]!, ...panel(true, depth).slice(1), ...edge.slice(1).reverse()];
    // The facing: from the side seam at the waist along the top to past the opening, then round its edge to the side.
    const corner = { x: d.sideAt(true, 0), y: 0 }, sides = facing.at(-1)!.y;
    const seam = Array.from({ length: steps - 1 }, (_, i) => { const y = sides * (steps - 1 - i) / steps; return { x: d.sideAt(true, y), y }; }).filter(q => q.y > 0 && q.y < sides);
    facings = [makePiece('frontPocket', [corner, ...facing, ...seam], 2)];
  }
  // Belt loops are cut as one strip, three times as wide as a loop (folded in three), then cut into five.
  const loop = BELT_LOOP_CM.width * 3, loopLength = d.waistbandHeight + BELT_LOOP_CM.above + BELT_LOOP_CM.below + 2;
  const loops = optionsOf(product).fly && optionsOf(product).beltLoops ? [makePiece('beltLoop', [{ x: 0, y: 0 }, { x: loop, y: 0 }, { x: loop, y: loopLength * 5 }, { x: 0, y: loopLength * 5 }], 1)] : [];
  return [makePiece('front', front, 2), ...facings, ...backs, makePiece('waistband', band, 1), ...loops, ...cuffs, ...pockets];
}

/** A leg panel's rise: its centre seam from the waist round the crotch curve to the inseam, cm. */
export function trouserRise(product: Product, front: boolean): number {
  const d = trouserDimensions(product), hip = front ? d.frontHip : d.backHip, crotch = front ? d.frontCrotch : d.backCrotch, raise = front ? 0 : d.backRaise;
  const hipY = raise + d.hipDepth, crotchY = raise + d.rise, points: Pt[] = [];
  for (let i = 0; i <= 20; i++) { const y = hipY * i / 20; points.push({ x: d.centreAt(front, y), y }); }
  for (let i = 1; i <= 6; i++) { const t = Math.PI / 2 * i / 6; points.push({ x: hip + crotch * (1 - Math.cos(t)), y: hipY + (crotchY - hipY) * Math.sin(t) }); }
  return points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i]!.x, point.y - points[i]!.y), 0);
}

/** The part of a pattern outline above (`above`) or below the line through `a` and `b` (a left of b), cut along it. */
function clipByLine(outline: Pt[], a: Pt, b: Pt, above: boolean): Pt[] {
  // Above the line (smaller y) the cross product is negative.
  const side = (q: Pt) => (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x), keep = (q: Pt) => (above ? side(q) <= 1e-9 : side(q) >= -1e-9);
  const kept: Pt[] = [];
  outline.forEach((point, i) => {
    const next = outline[(i + 1) % outline.length]!, inside = keep(point), nextInside = keep(next);
    if (inside) kept.push(point);
    if (inside !== nextInside) { const t = side(point) / (side(point) - side(next)); kept.push({ x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t }); }
  });
  return kept;
}

/** Columns across each trouser leg panel, and its rows from the waist to the hip line, the crotch and the hem. */
export function trouserGrid(product: Product) {
  const d = trouserDimensions(product), columns = 12, spacing = (d.frontHip + d.backHip) / 2 / columns;
  const upper = Math.min(20, Math.max(6, Math.round(d.rise / spacing))), lower = Math.min(40, Math.max(4, Math.round(d.inseam / (spacing * 1.3))));
  // The hip line splits the upper rows in proportion to the centre seam's straight part and its crotch curve.
  const curve = Math.PI / 2 * Math.sqrt((d.backCrotch ** 2 + (d.rise - d.hipDepth) ** 2) / 2);
  return { columns, upper, lower, hip: Math.min(upper - 2, Math.max(1, Math.round(upper * d.hipDepth / (d.hipDepth + curve)))) };
}

/** Jeans' back yoke: how far below the side waist it meets the side seam, and how far it drops toward the centre back. */
export const YOKE_SIDE_CM = 4, YOKE_DROP_CM = 3.5;
/**
 * Trousers' back yoke seam, in cm below the waist along each back leg panel: `side` at the side seam, where the
 * panel's grid row `row` meets it (the nearest to YOKE_SIDE_CM), and `back`, YOKE_DROP_CM deeper, at the centre back
 * seam, straight between, so the yoke is deepest at the centre back as jeans' are.
 */
export function trouserYoke(product: Product): { row: number; side: number; back: number } {
  const d = trouserDimensions(product), { hip } = trouserGrid(product);
  const row = Math.max(1, Math.min(hip - 1, Math.round(hip * YOKE_SIDE_CM / d.hipDepth))), side = d.hipDepth * row / hip;
  return { row, side, back: Math.min(side + YOKE_DROP_CM, (d.hipDepth + d.backRaise) * (hip - 1) / hip) };
}
/** The yoke seam's depth below the waist `u` of the way across a back panel from the side seam. */
const yokeDepthAt = (yoke: { side: number; back: number }, u: number) => yoke.side + (yoke.back - yoke.side) * u;
/**
 * A back patch pocket: its width, its height at the sides and at the point in its middle, cm, and its top-left corner
 * on the back leg panel's pattern (x from the side seam, y down from the panel's top): centred a little toward the
 * centre back, 1.5 cm below the yoke seam (or 6 cm below the waist without a yoke).
 */
export function backPocketOf(product: Product): { width: number; height: number; point: number; x: number; y: number } {
  const d = trouserDimensions(product), width = Math.min(16, Math.max(11, Math.round(d.hip * 0.28) / 2)), x = d.backHip / 2 + 1 - width / 2;
  const u = (x + width / 2) / d.backHip, yoke = optionsOf(product).yoke ? trouserYoke(product) : null;
  return { width, height: width, point: Math.round(width * 1.12 * 10) / 10, x, y: (1 - u) * d.backRaise + (yoke ? yokeDepthAt(yoke, u) + 1.5 : 6) };
}
/** A front scoop pocket: its opening across the waist from the side seam, and how far it reaches down the side seam,
 * in cm. Its edge curves between the two as a quarter ellipse about the corner of the waist and the side seam. */
export function frontPocketOf(product: Product): { opening: number; depth: number } {
  const d = trouserDimensions(product);
  return { opening: Math.min(11, Math.max(8, Math.round(d.hip * 0.1))), depth: Math.min(8.5, Math.max(6, Math.round(d.rise / 2) / 2)) };
}
/** Points along a front pocket's curved edge on the front pattern (x from the side seam, y down from the waist), from
 * the waist to the side seam; `grow` widens the curve, as the facing behind the opening is. */
export function frontPocketEdge(product: Product, grow = 0, steps = 10): Pt[] {
  const d = trouserDimensions(product), { opening, depth } = frontPocketOf(product);
  // Out from the front's side seam (see trouserDimensions).
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = Math.PI / 2 * i / steps, y = (depth + grow) * Math.sin(t);
    return { x: d.sideAt(true, y) + (opening + grow) * Math.cos(t), y };
  });
}
/** A back pocket's outline: square-topped, its sides `height` long, coming to a point `point` below its top. */
function backPocketOutline(width: number, height: number, point: number, x: number, y: number): Pt[] {
  return [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x: x + width / 2, y: y + point }, { x, y: y + height }];
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
/**
 * The 3D point at pattern place `flat` on a panel mesh (both legs' copies share their pattern places; `leg` picks the
 * one on that side), lifted `lift` cm off it, away from the body's centre line.
 */
function onPanel(panel: PartMesh, flat: Pt, leg: number, lift: number): { x: number; y: number; z: number } {
  const P = panel.positions, U = panel.uvs;
  let best: { t: number; w: [number, number, number]; score: number } | null = null;
  for (let t = 0; t < panel.indices.length; t += 3) {
    const [i, j, k] = [panel.indices[t]!, panel.indices[t + 1]!, panel.indices[t + 2]!];
    if (Math.sign(P[i * 3]! + P[j * 3]! + P[k * 3]!) !== leg) continue;
    const det = (U[j * 2 + 1]! - U[k * 2 + 1]!) * (U[i * 2]! - U[k * 2]!) + (U[k * 2]! - U[j * 2]!) * (U[i * 2 + 1]! - U[k * 2 + 1]!);
    if (Math.abs(det) < 1e-12) continue;
    const w0 = ((U[j * 2 + 1]! - U[k * 2 + 1]!) * (flat.x - U[k * 2]!) + (U[k * 2]! - U[j * 2]!) * (flat.y - U[k * 2 + 1]!)) / det;
    const w1 = ((U[k * 2 + 1]! - U[i * 2 + 1]!) * (flat.x - U[k * 2]!) + (U[i * 2]! - U[k * 2]!) * (flat.y - U[k * 2 + 1]!)) / det, w2 = 1 - w0 - w1;
    const score = Math.max(0, -w0) + Math.max(0, -w1) + Math.max(0, -w2);
    if (!best || score < best.score) best = { t, w: [w0, w1, w2], score };
    if (score === 0) break;
  }
  const [i, j, k] = [panel.indices[best!.t]!, panel.indices[best!.t + 1]!, panel.indices[best!.t + 2]!], [w0, w1, w2] = best!.w;
  const at = (axis: number) => P[i * 3 + axis]! * w0 + P[j * 3 + axis]! * w1 + P[k * 3 + axis]! * w2;
  const u = [0, 1, 2].map(a => P[j * 3 + a]! - P[i * 3 + a]!), v = [0, 1, 2].map(a => P[k * 3 + a]! - P[i * 3 + a]!);
  let n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const length = Math.hypot(n[0]!, n[1]!, n[2]!) || 1, x = at(0), y = at(1), z = at(2);
  n = n.map(c => c / length * (n[0]! * x + n[2]! * z >= 0 ? 1 : -1));
  return { x: x + n[0]! * lift, y: y + n[1]! * lift, z: z + n[2]! * lift };
}

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
      if (r <= hip) { const t = r / hip; return [{ x: d.sideAt(front, raise + d.hipDepth * t), y: raise + d.hipDepth * t }, { x: d.centreAt(front, hipY * t), y: hipY * t }]; }
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
  // A back yoke (see trouserYoke): on the back panels, row `yoke.row` follows its seam, and the rows above the hip line
  // are spaced to meet it, column by column. At the side seam they stay where the front panel's are.
  const yoke = optionsOf(product).yoke ? trouserYoke(product) : null;
  const spaced = (r: number, u: number) => {
    if (!yoke || r > hip || hip <= yoke.row) return r;
    const t = yokeDepthAt(yoke, u) / (d.hipDepth + u * d.backRaise);
    return hip * (r <= yoke.row ? t * r / yoke.row : t + (1 - t) * (r - yoke.row) / (hip - yoke.row));
  };
  for (const [part, e, side] of [['front', front, 1], ['back', back, -1]] as const) {
    // A vertex at row r and u across, and its place on the pattern; with a yoke, a back row above the hip line lies
    // between two rows of the shell (a quarter round the hips there), and its pattern place along its edges.
    const at = (r: number, u: number, leg: number): { p: { x: number; y: number; z: number }; uv: Pt } => {
      const rho = part === 'back' ? spaced(r, u) : r;
      if (rho === r) { const [left, right] = e[r]!; return { p: point(r, u, side, leg), uv: { x: left.x + (right.x - left.x) * u, y: left.y + (right.y - left.y) * u } }; }
      const low = Math.min(hip - 1, Math.floor(rho)), f = rho - low, a = point(low, u, side, leg), b = point(low + 1, u, side, leg), t = rho / hip;
      const left = { x: d.sideAt(false, d.backRaise + d.hipDepth * t), y: d.backRaise + d.hipDepth * t }, right = { x: d.centreAt(false, (d.backRaise + d.hipDepth) * t), y: (d.backRaise + d.hipDepth) * t };
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }, uv: { x: left.x + (right.x - left.x) * u, y: left.y + (right.y - left.y) * u } };
    };
    // The yoke takes the back's rows above its seam; the two share the seam's points, which the drape joins.
    const ranges: [PartId, number, number][] = part === 'back' && yoke ? [['yoke', 0, yoke.row], ['back', yoke.row, rows]] : [[part, 0, rows]];
    for (const [id, from, to] of ranges) {
      const mesh: PartMesh = { part: id, positions: [], uvs: [], indices: [] };
      for (const leg of [1, -1]) {
        const base = mesh.positions.length / 3;
        for (let r = from; r <= to; r++) for (let c = 0; c <= columns; c++) {
          const { p, uv } = at(r, c / columns, leg);
          mesh.positions.push(p.x, p.y, p.z); mesh.uvs.push(uv.x, uv.y);
          if (r < to && c < columns) {
            const a = base + (r - from) * (columns + 1) + c, b = a + 1, g = a + columns + 1, h = g + 1;
            // Mirrored and back panels keep their faces turned outward.
            mesh.indices.push(...(side * leg > 0 ? [a, b, g, b, h, g] : [a, g, b, b, g, h]));
          }
        }
      }
      meshes.set(id, mesh);
    }
  }
  if (optionsOf(product).backPockets) {
    // Each back pocket lies on its back panel, slightly proud of it: each point at its place on the panel's pattern.
    const pocket = backPocketOf(product), panel = meshes.get('back')!, mesh: PartMesh = { part: 'backPocket', positions: [], uvs: [], indices: [] };
    const across = Math.max(2, 2 * Math.ceil(pocket.width / MESH_STEP / 2)), down = Math.max(2, Math.ceil(pocket.point / MESH_STEP));
    for (const leg of [1, -1]) {
      const base = mesh.positions.length / 3;
      for (let j = 0; j <= down; j++) for (let i = 0; i <= across; i++) {
        const s = i / across, depth = (pocket.height + (pocket.point - pocket.height) * (1 - Math.abs(2 * s - 1))) * j / down;
        const flat = { x: pocket.x + pocket.width * s, y: pocket.y + depth }, p = onPanel(panel, flat, leg, 0.35);
        mesh.positions.push(p.x, p.y, p.z); mesh.uvs.push(flat.x - pocket.x, flat.y - pocket.y);
        if (j < down && i < across) {
          const a = base + j * (across + 1) + i, b = a + 1, g = a + across + 1, h = g + 1;
          mesh.indices.push(...(-leg > 0 ? [a, b, g, b, h, g] : [a, g, b, b, g, h]));
        }
      }
    }
    meshes.set('backPocket', mesh);
  }
  if (optionsOf(product).frontPockets) {
    // Each front pocket's facing shows inside its curved opening, just proud of the front panel: each point at its
    // place on the panel's pattern, out from the corner of the waist and the side seam to the pocket's edge.
    const { opening, depth } = frontPocketOf(product), panel = meshes.get('front')!, mesh: PartMesh = { part: 'frontPocket', positions: [], uvs: [], indices: [] };
    const around = Math.max(4, Math.ceil((opening + depth) * 0.8 / MESH_STEP)), out = Math.max(2, Math.ceil(Math.max(opening, depth) / MESH_STEP));
    const side = (y: number) => d.sideAt(true, y);
    for (const leg of [1, -1]) {
      const base = mesh.positions.length / 3;
      for (let j = 0; j <= out; j++) for (let i = 0; i <= around; i++) {
        // Starting just off the corner keeps every triangle open.
        const t = Math.PI / 2 * i / around, r = 0.04 + 0.96 * j / out, y = depth * r * Math.sin(t), flat = { x: side(y) + opening * r * Math.cos(t), y };
        const p = onPanel(panel, flat, leg, 0.3);
        mesh.positions.push(p.x, p.y, p.z); mesh.uvs.push(flat.x, flat.y);
        if (j < out && i < around) {
          const a = base + j * (around + 1) + i, b = a + 1, g = a + around + 1, h = g + 1;
          mesh.indices.push(...(leg > 0 ? [a, b, g, b, h, g] : [a, g, b, b, g, h]));
        }
      }
    }
    meshes.set('frontPocket', mesh);
  }
  // The waistband rises from the open waist: left front side to centre to right side, then the back right to left.
  const top = (side: number, leg: number, from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => point(0, (from + Math.sign(to - from) * i) / columns, side, leg));
  const ring = [...top(1, -1, 0, columns), ...top(1, 1, columns - 1, 0), ...top(-1, 1, 1, columns), ...top(-1, -1, columns - 1, 1)];
  const band: PartMesh = { part: 'waistband', positions: [], uvs: [], indices: [] };
  neckRib(band, ring, d.waistbandHeight);
  meshes.set('waistband', band);
  if (d.fly && optionsOf(product).beltLoops) {
    // Five belt loops just off the waistband, from a little below it to a little above: one on each front leg between
    // the pocket and the fly, one on each back leg near the side seam and one at the centre back.
    const loops: PartMesh = { part: 'beltLoop', positions: [], uvs: [], indices: [] }, height = d.waistbandHeight + BELT_LOOP_CM.above + BELT_LOOP_CM.below;
    for (const [side, leg, u] of [[1, 1, 0.6], [1, -1, 0.6], [-1, 1, 0.3], [-1, -1, 0.3], [-1, 1, 1]] as const) {
      const centre = point(0, u, side, leg), out = Math.hypot(centre.x, centre.z) || 1, normal = { x: centre.x / out, z: centre.z / out };
      // Across the loop, along the waist; at the centre back, half on each leg's side of the seam.
      const across = { x: -normal.z, z: normal.x }, base = loops.positions.length / 3, middle = u === 1 ? { x: 0, z: centre.z } : centre;
      for (let j = 0; j <= 3; j++) for (let i = 0; i <= 2; i++) {
        // The band flares a little toward its top (see neckRib); the loop follows it.
        const a = (i / 2 - 0.5) * BELT_LOOP_CM.width, y = d.length - BELT_LOOP_CM.below + height * j / 3, flare = 1 + 0.03 * Math.min(1, Math.max(0, (y - d.length) / d.waistbandHeight));
        loops.positions.push((middle.x + across.x * a) * flare + normal.x * 0.35, y, (middle.z + across.z * a) * flare + normal.z * 0.35);
        loops.uvs.push(a + BELT_LOOP_CM.width / 2, height * (1 - j / 3));
        // Faces turned outward, away from the waist.
        if (i < 2 && j < 3) { const q = base + j * 3 + i; loops.indices.push(q, q + 3, q + 1, q + 1, q + 3, q + 4); }
      }
    }
    meshes.set('beltLoop', loops);
  }
  if (d.cuffHeight) {
    // Joggers: a rib cuff below each leg opening, round from the side seam over the front to the inseam and back over
    // the back; cut a third shorter than the opening, it is drawn gathered round the leg's centre.
    for (const [part, leg] of [['cuffLeft', 1], ['cuffRight', -1]] as const) {
      const hem = [...Array.from({ length: columns + 1 }, (_, c) => point(rows, c / columns, 1, leg)), ...Array.from({ length: columns }, (_, c) => point(rows, (columns - 1 - c) / columns, -1, leg))];
      const centre = leg * shape[rows].centre, gather = d.cuffLength / d.legOpening, cuff: PartMesh = { part, positions: [], uvs: [], indices: [] };
      tube(cuff, Math.max(2, Math.ceil(d.cuffHeight / MESH_STEP)), hem.length - 1,
        k => [hem[k]!, { x: centre + (hem[k]!.x - centre) * gather, y: -d.cuffHeight, z: hem[k]!.z * gather }], (k, v) => ({ x: d.cuffLength * k / (hem.length - 1), y: d.cuffHeight * v }));
      meshes.set(part, cuff);
    }
  }
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
  const armY = shoulderDrop + armDepth, inset = dims.shaped ? half - seamHalfAt(dims, length) : (half - dims.hemHalf) * (length - armY) / (panel.length - armY);
  // A shaped side seam curves through the waist: points about every 2 cm from the underarm to the hem's side.
  const sideEnd = length - dims.hemCurve, steps = dims.shaped ? Math.max(2, Math.ceil((sideEnd - armY) / 2)) : 0;
  const side = Array.from({ length: Math.max(0, steps - 1) }, (_, i) => { const y = armY + (sideEnd - armY) * (i + 1) / steps; return { x: half - seamHalfAt(dims, y), y }; });
  const neckDepth = front ? dims.neckDepthFront : dims.neckDepthBack, armhole = armholeCurve(half, dims.shoulderX, shoulderDrop, armDepth, front);
  // A flared (A-line) hem is wider than the chest: shift the piece so it starts at x = 0 like the others.
  const shift = (p: Pt) => ({ x: p.x + flare(product), y: p.y });
  return {
    neckLeft: shift({ x: half - neckWidth, y: 0 }),
    armholeLeft: armhole.map(shift),
    // The side seams between the underarm and the hem (only a shaped waist has points there): down the left, up the right.
    sideLeft: side.map(shift),
    hem: hemLine(w - 2 * inset, length, dims.hemCurve).map(p => shift({ x: p.x + inset, y: p.y })),
    sideRight: side.map(p => shift({ x: w - p.x, y: p.y })).reverse(),
    armholeRight: armhole.map(p => shift({ x: w - p.x, y: p.y })).reverse(),
    neckRight: shift({ x: half + neckWidth, y: 0 }),
    // Neckline: a curve for crew/back, a straight V for v-neck fronts.
    neckline: neckPath(neckWidth, neckDepth, front && product.neckline === 'v').slice(1, -1).map(p => shift({ x: half + p.x, y: p.y })),
  };
}

function topBodyOutline(product: Product, front: boolean, length = panelSize(topMeasurements(product)).length): Pt[] {
  const o = bodyOutline(product, front, length);
  return [o.neckLeft, ...o.armholeLeft, ...o.sideLeft, ...o.hem, ...o.sideRight, ...o.armholeRight, o.neckRight, ...o.neckline];
}

/**
 * A top's sleeve piece in pattern cm: the cap from one underarm point over the top to the other, then the opening from
 * the end of the first underarm seam to the end of the second. A banded sleeve ends above its cuff and is cut 4 cm wider
 * there, for the rib to gather.
 */
function sleeveOutline(product: Product) {
  const m = topMeasurements(product), dims = teeDimensions(product), cap = dims.capWidth, end = sleeveSize(m).length - dims.cuffHeight;
  // The sleeve length runs from the shoulder point, where the top of the cap is sewn, so it includes the cap.
  const opening = dims.cuffHalf * 2 + (dims.cuffHeight ? 4 : 0), drafted = capCurve(cap, dims.capHeight);
  const spread = capSpread(drafted, cap, dims.capHeight, end, m.sleeveGather);
  return {
    cap: drafted.map(spread),
    // The cap as drafted, which the 3D sleeve is sewn along, and how a point of the sleeve is spread for cutting.
    drafted, spread,
    opening: [{ x: (cap - opening) / 2, y: end }, { x: (cap + opening) / 2, y: end }] as [Pt, Pt],
  };
}

/**
 * A puff sleeve's cap is cut fuller than its armhole and gathered into it: slashed and spread about its centre line,
 * most at the top and less toward the underarm, the spreading fading out twice the cap height below the top (or at the
 * opening), so the cap edge is `gather` times the armhole. Without gathering, points stay as drafted.
 */
function capSpread(drafted: Pt[], width: number, height: number, end: number, gather?: number): (p: Pt) => Pt {
  if (!gather) return p => p;
  const depth = Math.min(end, 2 * height);
  const by = (s: number) => (p: Pt): Pt => ({ x: width / 2 + (p.x - width / 2) * (1 + (s - 1) * Math.max(0, 1 - p.y / depth)), y: p.y });
  const target = polylineLength(drafted) / (1 + CAP_EASE) * gather;
  let low = 1, high = 8;
  for (let i = 0; i < 50; i++) { const s = (low + high) / 2; if (polylineLength(drafted.map(by(s))) < target) low = s; else high = s; }
  return by(low);
}

/** A top's sleeve cap as cut and the armhole it is set into, cm: a plain cap is CAP_EASE longer, a puff sleeve's its
 * gathering times. */
export function sleeveCap(product: Product): { cut: number; armhole: number } {
  const sleeve = sleeveOutline(product);
  return { cut: polylineLength(sleeve.cap), armhole: polylineLength(sleeve.drafted) / (1 + CAP_EASE) };
}

/** Where the hood leaves the neckline open at the centre front, as a share of half the neck width. */
const HOOD_OPENING = 0.55;

/**
 * A hood side panel (cut 2, mirrored) in pattern cm: the neck edge along the bottom, from the face to the centre back
 * (`neck`), and the centre seam from the top of the face over the crown to the back corner and down to the neck
 * (`crown`, ending at the back corner); the face edge runs up the left side. The neck edge is as long as the half
 * neckline it is sewn to, the front neckline beside the face opening and half the back neckline.
 */
function hoodOutline(product: Product) {
  const dims = teeDimensions(product), H = dims.hoodHeight, W = dims.hoodWidth, centre = flare(product) + dims.half;
  const length = (points: Pt[]) => polylineLength(points);
  // The front neckline to one side of the face opening: the part of each segment beyond the opening.
  const frontNeck = (() => {
    const o = bodyOutline(product, true, dims.length), points = [o.neckRight, ...o.neckline, o.neckLeft].map(p => ({ x: p.x - centre, y: p.y }));
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], open = dims.neckHalf * HOOD_OPENING;
      const t0 = Math.abs(b.x - a.x) < 1e-12 ? (a.x >= open ? 0 : 1) : Math.max(0, Math.min(1, (open - a.x) / (b.x - a.x)));
      const beyond = a.x >= open && b.x >= open ? 1 : a.x < open && b.x < open ? 0 : a.x >= open ? t0 : 1 - t0;
      total += Math.hypot(b.x - a.x, b.y - a.y) * beyond;
    }
    return total;
  })();
  const back = bodyOutline(product, false, dims.length), backNeck = length([back.neckRight, ...back.neckline, back.neckLeft]) / 2;
  const crown = [{ x: 0, y: 6 }];
  for (let i = 0; i <= 8; i++) { const t = Math.PI / 2 * i / 8; crown.push({ x: W * 0.55 * (1 - Math.cos(t)), y: 6 * (1 - Math.sin(t)) }); }
  crown.push({ x: W, y: H * 0.45 });
  // The neck edge runs level from the face, then curves up toward the back corner at the panel's full width, far
  // enough to be as long as the neckline it is sewn to; a shorter neckline ends the edge sooner, level.
  const reach = W, needed = frontNeck + backNeck;
  const edge = (rise: number, end: number) => Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return { x: end * t, y: H - rise * t * t };
  });
  let neck = edge(0, Math.min(reach, needed));
  if (needed > reach) {
    let low = 0, high = H * 0.5;
    for (let i = 0; i < 50; i++) { const rise = (low + high) / 2; if (polylineLength(edge(rise, reach)) < needed) low = rise; else high = rise; }
    neck = edge(low, reach);
  }
  return { neck, crown };
}

/** Simplified flat pattern pieces (finished size, no seam allowance) in cm, origin at the top-left. */
export function patternPieces(product: Product): PatternPiece[] {
  if (product.base === 'skirt') return skirtPieces(product);
  if (isBottoms(product)) return trouserPieces(product);
  const m = topMeasurements(product), panel = panelSize(m), dims = teeDimensions(product);
  const body = (front: boolean, length = panel.length) => topBodyOutline(product, front, length);
  const sleevePiece = () => { const s = sleeveOutline(product); return [...s.cap, s.opening[1], s.opening[0]]; };
  const rect = (wd: number, ht: number) => [{ x: 0, y: 0 }, { x: wd, y: 0 }, { x: wd, y: ht }, { x: 0, y: ht }];
  // Chest pocket: finished size plus the folded-down facing at the top.
  const chestPocket = () => chestPocketOutline(dims.chestPocketWidth, dims.chestPocketHeight + POCKET_FOLD_CM, 0, 0);
  const make = (part: PartId, outline: { x: number; y: number }[], cutCount: number): PatternPiece => ({
    part, outline, cutCount, width: Math.max(...outline.map(p => p.x)), height: Math.max(...outline.map(p => p.y)), areaCm2: area(outline),
  });
  const modules = optionsOf(product).chestPocket ? [make('chestPocket', chestPocket(), 1)] : [];
  if (product.base === 'tee') {
    const sleeves = sleeveless(product) ? [] : [make('sleeveLeft', sleevePiece(), 1), make('sleeveRight', sleevePiece(), 1)];
    // A polo's or shirt's collar is as long as the neckline between the placket's edges; the placket is cut as a folded
    // pair. A button front's front is cut as a mirrored pair of halves, which the placket joins.
    const { collar, buttons } = optionsOf(product), placket = placketOf(product);
    const neck = [...(collar ? [collarPattern(product)] : [make('neckband', rect(dims.ribLength, dims.ribHeight * 2), 1)]),
      ...(collar || buttons ? [make('placket', rect(placket.width * 2, placket.length), 2)] : [])];
    const front = buttons ? leftOf(body(true), panel.width / 2) : body(true), cut = buttons ? 2 : 1;
    // A shirt's cuffs are cut on the fold, twice their height, and 2 cm longer than the opening for the button's overlap.
    const cuffs = optionsOf(product).cuffs ? [make('cuffLeft', rect(dims.cuffHalf * 2 + 2, dims.cuffHeight * 2), 1), make('cuffRight', rect(dims.cuffHalf * 2 + 2, dims.cuffHeight * 2), 1)] : [];
    // A back yoke is cut double (the outer yoke and its facing) above its seam, and the back body below it, laid out
    // from the seam (its own top) down.
    const backs = (outline: Pt[]) => (optionsOf(product).yoke
      ? [make('yoke', clipAt(outline, YOKE_CM, true), 2), make('back', clipAt(outline, YOKE_CM, false).map(q => ({ x: q.x, y: q.y - YOKE_CM })), 1)]
      : [make('back', outline, 1)]);
    // A dress cut at the waist: the bodies end at the waist line, and the skirt pieces below it are laid out from the
    // waist seam (their own top) down. Each piece starts at x = 0 (the bodice moved left by bodiceShift).
    if (optionsOf(product).waistSeam) {
      const waist = dims.waistY, shift = bodiceShift(product);
      const bodice = (outline: Pt[]) => clipAt(outline, waist, true).map(q => ({ x: q.x - shift, y: q.y }));
      // A gathered skirt is cut wider at the waist than the seam it is gathered into, about the piece's centre line.
      const gather = m.gather ?? 1, centre = flare(product) + panel.width / 2;
      const skirt = (outline: Pt[]) => {
        const below = clipAt(outline, waist, false).map(q => ({ x: centre + (q.x - centre) * skirtGatherAt(dims, gather, q.y), y: q.y })), left = Math.min(...below.map(q => q.x));
        return below.map(q => ({ x: q.x - left, y: q.y - waist }));
      };
      return [make('front', bodice(front), cut), ...backs(bodice(body(false))), make('skirtFront', skirt(front), cut), make('skirtBack', skirt(body(false)), 1),
        ...sleeves, ...cuffs, ...neck, ...modules];
    }
    return [make('front', front, cut), ...backs(body(false)), ...sleeves, ...cuffs, ...neck, ...modules];
  }
  // Sweatshirts and hoodies: body and sleeves end above rib bands cut on the fold (band height × 2).
  const band = dims.band, zip = zipAllowed(product.base) && !!optionsOf(product).zip;
  // A zip front is cut as a mirrored pair of halves, which the zip joins at the centre front.
  const pieces = [zip ? make('front', leftOf(body(true, panel.length - band), panel.width / 2), 2) : make('front', body(true, panel.length - band), 1), make('back', body(false, panel.length - band), 1)];
  pieces.push(make('sleeveLeft', sleevePiece(), 1), make('sleeveRight', sleevePiece(), 1));
  // A rib stand collar is cut like the neck rib, on the fold, as tall again as it stands.
  if (product.base === 'sweatshirt') pieces.push(optionsOf(product).collar ? make('collar', rect(dims.ribLength, STAND_COLLAR_CM * 2), 1) : make('neckband', rect(dims.ribLength, dims.ribHeight * 2), 1));
  // Rib trims are cut about 15% shorter than the edge they finish so they hug it.
  pieces.push(make('cuffLeft', rect(dims.cuffHalf * 2 * 0.85, dims.cuffHeight * 2), 1), make('cuffRight', rect(dims.cuffHalf * 2 * 0.85, dims.cuffHeight * 2), 1),
    zip ? make('hemBand', rect(dims.hemHalf * 2 * 0.85, band * 2), 2) : make('hemBand', rect(dims.hemHalf * 2 * 2 * 0.85, band * 2), 1));
  if (product.base === 'hoodie') {
    const hood = hoodOutline(product);
    pieces.push(make('hood', [hood.neck[0]!, ...hood.crown, ...[...hood.neck].reverse().slice(0, -1)], 2));
    const top = dims.pocketHalfTop, bottom = dims.pocketHalfBottom, h = 22;
    const pouch = [{ x: bottom - top + 5, y: 0 }, { x: bottom + top - 5, y: 0 }, { x: bottom * 2, y: h }, { x: 0, y: h }];
    // Split by the zip, the kangaroo pocket becomes a pair of halves.
    pieces.push(zip ? make('pocket', leftOf(pouch, bottom), 2) : make('pocket', pouch, 1));
  }
  return [...pieces, ...modules];
}

/** How far a dress's bodice pieces are moved left so they start at x = 0 (their flared skirt is wider); 0 without a seam. */
export function bodiceShift(product: Product): number {
  if (product.base !== 'tee' || !optionsOf(product).waistSeam) return 0;
  return Math.min(...clipAt(topBodyOutline(product, true), teeDimensions(product).waistY, true).map(q => q.x));
}

/** A T-shirt's whole front body as cut without a waist seam (a button front's left half), for drawings of the garment. */
export function wholeFrontOutline(product: Product): Pt[] {
  const outline = topBodyOutline(product, true);
  return optionsOf(product).buttons ? leftOf(outline, panelSize(topMeasurements(product)).width / 2) : outline;
}

/** Outline points closer than this to a corner made by a cut are merged into it: a sliver of an edge would stretch
 * many times its own length in the drape. */
const CUT_MERGE_CM = 0.5;
/** The part of a pattern outline above the horizontal line y = `cut` (`above`), or below it, clipped along that line. */
function clipAt(outline: Pt[], cut: number, above: boolean): Pt[] {
  const kept: Pt[] = [], keep = (point: Pt) => (above ? point.y <= cut + 1e-9 : point.y >= cut - 1e-9);
  outline.forEach((point, i) => {
    const next = outline[(i + 1) % outline.length]!, inside = keep(point), nextInside = keep(next);
    if (inside) kept.push(point);
    if (inside !== nextInside) { const t = (cut - point.y) / (next.y - point.y); kept.push({ x: point.x + (next.x - point.x) * t, y: cut }); }
  });
  // The cut's corners stay exactly where they are (the other piece shares them); points crowding them go.
  const onCut = (point: Pt) => Math.abs(point.y - cut) < 1e-9;
  return kept.filter((point, i) => onCut(point) || ![kept[(i + kept.length - 1) % kept.length]!, kept[(i + 1) % kept.length]!]
    .some(other => onCut(other) && Math.hypot(other.x - point.x, other.y - point.y) < CUT_MERGE_CM));
}

/** The part of a pattern outline left of x = `cut` (one half of a symmetrical piece), clipped along that line. */
function leftOf(outline: { x: number; y: number }[], cut: number): { x: number; y: number }[] {
  const kept: { x: number; y: number }[] = [];
  outline.forEach((point, i) => {
    const next = outline[(i + 1) % outline.length]!, inside = point.x <= cut + 1e-9, nextInside = next.x <= cut + 1e-9;
    if (inside) kept.push(point);
    if (inside !== nextInside) { const t = (cut - point.x) / (next.x - point.x); kept.push({ x: cut, y: point.y + (next.y - point.y) * t }); }
  });
  return kept;
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

export interface PartMesh { part: PartId; positions: number[]; uvs: number[]; indices: number[];
  /** Shaped in 3D rather than cut flat: the drape keeps the shape it is given (a neck rib or stand collar). */ modelled?: boolean;
  /** Pressed folds (pleats): pairs of vertices along a fold line, whose crease the drape keeps. */ creases?: number[];
  /** How many layers in from the outside each vertex lies (a pleat's underlays), so layers stay in order on the body. */ layers?: number[];
  /** Pairs of vertices (inner, outer): the inner one, on an underlay, stays inside the outer one over it. */ inside?: number[] }
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
function topFrame(product: Product) {
  const m = topMeasurements(product), depth = m.chest / (2 * Math.PI) * 0.85, top = m.length, dims = teeDimensions(product);
  // Body pieces centred: x across from the centre line, y down from the neck points.
  const centre = flare(product) + panelSize(m).width / 2, centred = (p: Pt) => ({ x: p.x - centre, y: p.y });
  const outline = (front: boolean) => {
    const o = bodyOutline(product, front, m.length - dims.band);
    return { neckLeft: centred(o.neckLeft), armholeLeft: densify(o.armholeLeft.map(centred)), sideLeft: o.sideLeft.map(centred), hem: densify(o.hem.map(centred)),
      sideRight: o.sideRight.map(centred), armholeRight: densify(o.armholeRight.map(centred)), neck: densify([o.neckRight, ...o.neckline, o.neckLeft].map(centred)) };
  };
  const front = outline(true), back = outline(false);
  // The shoulder and side seams, which the front and back share (a shaped side seam is a chain of short segments).
  const chain = (points: Pt[]) => points.slice(1).map((point, i): [Pt, Pt] => [points[i]!, point]);
  const seams: [Pt, Pt][] = [[front.neckLeft, front.armholeLeft[0]], [front.armholeRight.at(-1)!, front.neck[0]],
    ...chain([front.armholeLeft.at(-1)!, ...front.sideLeft, front.hem[0]]), ...chain([front.hem.at(-1)!, ...front.sideRight, front.armholeRight[0]])];
  // Rounding-level distances are on a seam: snap them so the front and back coincide exactly there.
  const rise = (p: Pt) => { const d = Math.min(depth, ...seams.map(([a, b]) => segmentDistance(p, a, b))); return d < 1e-6 ? 0 : depth * Math.sqrt(1 - (1 - d / depth) ** 2); };
  const shell = (p: Pt, sign: number): P3 => ({ x: p.x, y: top - p.y, z: sign * rise(p) });
  return { m, top, dims, front, back, rise, shell };
}

function topMesh(product: Product, Delaunator: DelaunatorLike): PartMesh[] {
  const frame = topFrame(product), { m, top, dims, front, back, rise, shell } = frame;
  const groups = new Map<PartId, PartMesh>();
  for (const id of PART_IDS) groups.set(id, { part: id, positions: [], uvs: [], indices: [] });
  // A zip front worn open: its front halves (and hem band, and a sweatshirt's neck rib or collar) part at the centre front.
  const zipped = zipAllowed(product.base) && !!optionsOf(product).zip, buttoned = product.base === 'tee' && !!optionsOf(product).buttons;
  const open = (zipped || buttoned) && !!optionsOf(product).zipOpen;
  for (const [side, o] of [['front', front], ['back', back]] as const) {
    const sign = side === 'front' ? 1 : -1, region = [o.neckLeft, ...o.armholeLeft, ...o.sideLeft, ...o.hem, ...o.sideRight, ...o.armholeRight, ...o.neck.slice(0, -1)];
    // A dress cut at the waist is sewn there: the bodice and skirt share the waist line's points, which the drape joins.
    const seamed: [PartId, Pt[]][] = product.base === 'tee' && optionsOf(product).waistSeam
      ? [[side, clipAt(region, dims.waistY, true)], [side === 'front' ? 'skirtFront' : 'skirtBack', clipAt(region, dims.waistY, false)]] : [[side, region]];
    // A shirt's back yoke is sewn to the back body along its seam the same way.
    const pieces: [PartId, Pt[]][] = side === 'back' && product.base === 'tee' && optionsOf(product).yoke
      ? seamed.flatMap(([part, outline]): [PartId, Pt[]][] => (part === 'back' ? [['yoke', clipAt(outline, YOKE_CM, true)], ['back', clipAt(outline, YOKE_CM, false)]] : [[part, outline]])) : seamed;
    // A gathered skirt starts on the waist seam but is cut wider there: the drape gathers the extra fabric.
    const gather = m.gather ?? 1, flat = (p: Pt) => ({ x: p.x * skirtGatherAt(dims, gather, p.y), y: p.y });
    for (const [part, piece] of pieces) {
      const cut = part === 'skirtFront' || part === 'skirtBack' ? flat : undefined;
      if (side === 'front' && open) {
        const mirror = (points: Pt[]) => points.map(p => ({ x: -p.x, y: p.y }));
        for (const half of [leftOf(piece, -OPEN_ZIP_GAP), mirror(leftOf(mirror(piece), -OPEN_ZIP_GAP))]) fillRegion(groups.get(part)!, half, Delaunator, p => sign * rise(p), top, side, cut);
      } else fillRegion(groups.get(part)!, piece, Delaunator, p => sign * rise(p), top, side, cut);
    }
  }
  if (product.base === 'hoodie') {
    // The kangaroo pocket sits just above the hem band, slightly proud of the front body.
    const y0 = dims.pocketTop, y1 = m.length - dims.band - 0.01;
    if (optionsOf(product).zip) {
      // Each half of a zip hoodie's pocket stops short of the zip.
      for (const side of [1, -1]) fillRegion(groups.get('pocket')!, [{ x: side * ZIP_CLEAR, y: y0 }, { x: side * dims.pocketHalfTop, y: y0 }, { x: side * dims.pocketHalfBottom, y: y1 }, { x: side * ZIP_CLEAR, y: y1 }],
        Delaunator, p => rise(p) + 0.5, top, 'front');
    } else fillRegion(groups.get('pocket')!, [{ x: dims.pocketHalfTop, y: y0 }, { x: dims.pocketHalfBottom, y: y1 }, { x: -dims.pocketHalfBottom, y: y1 }, { x: -dims.pocketHalfTop, y: y0 }],
      Delaunator, p => rise(p) + 0.5, top, 'front');
  }
  if (optionsOf(product).chestPocket) {
    fillRegion(groups.get('chestPocket')!, chestPocketOutline(dims.chestPocketWidth, dims.chestPocketHeight, dims.chestPocketX - dims.chestPocketWidth / 2, dims.chestPocketY),
      Delaunator, p => rise(p) + 0.35, top, 'front');
  }
  if (product.base === 'tee' && (optionsOf(product).collar || buttoned)) {
    // A polo's or shirt's placket: a strip down the centre front from the neckline, slightly proud of the front body. A
    // button front stops just short of the hem; worn open, each half carries its own side of it.
    const placket = placketOf(product), y0 = dims.neckDepthFront, y1 = Math.min(dims.neckDepthFront + placket.length, m.length - 0.5), x = placket.width / 2;
    for (const [left, right] of open ? [[-x, -OPEN_ZIP_GAP], [OPEN_ZIP_GAP, x]] : [[-x, x]]) {
      fillRegion(groups.get('placket')!, [{ x: left, y: y0 }, { x: right, y: y0 }, { x: right, y: y1 }, { x: left, y: y1 }], Delaunator, p => rise(p) + 0.25, top, 'front');
    }
  }
  // Sleeves, posed along the sleeve angle like the body's arms; flat directions have y down. A sleeveless top's
  // armholes stay open.
  const sleeve = sleeveOutline(product), angle = dims.sleeveAngle * Math.PI / 180, along = { x: Math.cos(angle), y: Math.sin(angle) }, across = { x: -Math.sin(angle), y: Math.cos(angle) };
  const length = sleeve.opening[0].y, opening = sleeve.opening[1].x - sleeve.opening[0].x, radius = opening / (2 * Math.PI);
  for (const [part, cuff, x, frontArmhole, backArmhole] of sleeveless(product) ? [] : [
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
    // The sleeve is sewn along the cap as drafted; its flat positions are as cut, so a puff sleeve's spread cap is
    // gathered into the armhole and the drape puffs it.
    const capAt = (k: number) => alongPolyline(sleeve.drafted, k / columns);
    tube(groups.get(part)!, rows, columns, k => [loop[k], end[k]], (k, v) => {
      const a = capAt(k), b = { x: sleeve.opening[0].x + opening * k / columns, y: sleeve.opening[0].y };
      return sleeve.spread({ x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v });
    });
    if (dims.cuffHeight) {
      // Rib cuffs are cut about 15% shorter than the sleeve opening they finish; a shirt's woven cuffs are as long as it,
      // and the sleeve, cut 4 cm wider there, is pleated into them.
      const width = dims.cuffHalf * 2 * (product.base === 'tee' ? 1 : 0.85), rib = ring(length + dims.cuffHeight, width / (2 * Math.PI));
      tube(groups.get(cuff)!, Math.max(2, Math.ceil(dims.cuffHeight / MESH_STEP)), columns, k => [end[k], rib[k]], (k, v) => ({ x: width * k / columns, y: dims.cuffHeight * v }));
    }
  }
  if (dims.band) {
    // The hem band: round the open hem, front left to right, then back right to left, hanging straight down.
    let flat = [...front.hem, ...[...back.hem].reverse().slice(1)], hem = flat.map((p, k) => shell(p, k < front.hem.length ? 1 : -1));
    if (open) {
      // Worn open, the band starts at one side of the parting and runs round the back to the other.
      const crossing = front.hem.findIndex((p, k) => k > 0 && Math.sign(p.x) !== Math.sign(front.hem[k - 1]!.x)), a = front.hem[crossing - 1]!, b = front.hem[crossing]!;
      const at = (x: number): Pt => ({ x, y: a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) }), clear = (p: Pt) => Math.abs(p.x) > OPEN_ZIP_GAP;
      const starts = [at(Math.sign(b.x) * OPEN_ZIP_GAP), ...front.hem.slice(crossing).filter(clear)], back3d = [...back.hem].reverse().slice(1);
      const ends = [...front.hem.slice(1, crossing).filter(clear), at(Math.sign(a.x) * OPEN_ZIP_GAP)];
      flat = [...starts, ...back3d, ...ends];
      hem = [...starts.map(p => shell(p, 1)), ...back3d.map(p => shell(p, -1)), ...ends.map(p => shell(p, 1))];
    }
    const cut = [0];
    // The band is cut 15% shorter than the hem it finishes.
    for (let k = 1; k < flat.length; k++) cut.push(cut[k - 1] + Math.hypot(flat[k].x - flat[k - 1].x, flat[k].y - flat[k - 1].y) * 0.85);
    tube(groups.get('hemBand')!, Math.max(2, Math.ceil(dims.band / MESH_STEP)), flat.length - 1, k => [hem[k], { ...hem[k], y: hem[k].y - dims.band }], (k, v) => ({ x: cut[k], y: dims.band * v }));
  }
  // The open neck edge, front curve (left to right) then back curve (right to left).
  const neck = [...[...front.neck].reverse().map(p => shell(p, 1)), ...back.neck.map(p => shell(p, -1))];
  if (product.base === 'hoodie') hoodMesh(groups.get('hood')!, neck, new Set(front.neck.map((_, i) => i)), dims, hoodOutline(product));
  else if (product.base === 'tee' && optionsOf(product).collar) {
    groups.set('collar', collarDraft(product, frame));
  }
  else {
    // A neck rib or stand collar stands up from the neckline. Above a zip it runs from one side of the zip round the back
    // to the other: from the centre front when zipped up, from each half's edge when worn open.
    const band = groups.get(optionsOf(product).collar ? 'collar' : 'neckband')!, height = optionsOf(product).collar ? STAND_COLLAR_CM : dims.ribHeight;
    if (!zipped && !buttoned) neckRib(band, neck, height);
    else {
      const curve = [...front.neck].reverse(), gap = open ? OPEN_ZIP_GAP : 0, side = Math.sign(curve.at(-1)!.x);
      // Where the neckline crosses x, on the segment that spans it (where each front half's edge has its vertex).
      const at = (x: number): Pt => {
        const k = curve.findIndex((p, i) => i > 0 && (curve[i - 1]!.x - x) * (p.x - x) <= 0), a = curve[k - 1]!, b = curve[k]!;
        return b.x === a.x ? { ...b } : { x, y: a.y + (b.y - a.y) * (x - a.x) / (b.x - a.x) };
      };
      const after = (p: Pt) => side * p.x > gap + 1e-9, before = (p: Pt) => -side * p.x > gap + 1e-9;
      const starts = [at(side * gap), ...curve.filter(after)], ends = [...curve.filter(before), at(-side * gap)];
      neckRib(band, [...starts.map(p => shell(p, 1)), ...back.neck.map(p => shell(p, -1)), ...ends.map(p => shell(p, 1))], height, false);
    }
    band.modelled = true;
  }
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
function fillRegion(group: PartMesh, polygon: Pt[], Delaunator: DelaunatorLike, z: (p: Pt) => number, top: number, side: 'front' | 'back', flat?: (p: Pt) => Pt) {
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
      // UVs are the flat pattern position: the shell's own, or as the piece is cut (a gathered skirt is wider).
      const cut = flat ? flat(p) : p;
      group.uvs.push(side === 'front' ? cut.x : -cut.x, cut.y);
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
function neckRib(rib: PartMesh, ring: { x: number; y: number; z: number }[], width: number, closed = true) {
  let along = 0;
  ring.forEach((p, i) => {
    if (i) along += Math.hypot(p.x - ring[i - 1].x, p.y - ring[i - 1].y, p.z - ring[i - 1].z);
    rib.positions.push(p.x, p.y, p.z, p.x * 1.03, p.y + width, p.z * 1.03); rib.uvs.push(along, 0, along, width);
    if (i) { const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1; rib.indices.push(a, c, b, b, c, d); }
  });
  if (closed) { const last = (ring.length - 1) * 2; rib.indices.push(last, 0, last + 1, last + 1, 0, 1); }
}

/**
 * A polo's flat-knit collar, already folded down as worn. It runs from one edge of the placket round the back of the neck
 * to the other, so its two ends make the collar points either side of the placket. From the neck edge it stands up
 * COLLAR_STAND cm, then falls outward and down for the rest of its height: steeply over the chest and back, flatter over
 * the shoulders. Flat, it is a rectangle, so its knit stretches round the fall's longer outer edge. `ring` is the neck
 * edge, its first `frontCount` points the front curve.
 */
const COLLAR_STAND = 1.8;
/** Knitted fabrics, which stretch round a collar's fall; the others are woven. */
const CURVE_SHARE = 0.5;
const KNIT_TEXTURES: ReadonlySet<string> = new Set(['jersey', 'rib', 'pique', 'slub', 'terry']);
/** A tee collar's actual fabric, independently of whether the front has buttons. */
export function isWovenCollar(product: Product): boolean {
  return product.base === 'tee' && !!optionsOf(product).collar && !KNIT_TEXTURES.has(material(product.parts.collar?.material ?? product.parts.front.material).texture);
}

function collarDraft(product: Product, frame = topFrame(product)): PartMesh {
  const { front, back, shell } = frame, flat = [...[...front.neck].reverse(), ...back.neck];
  const neck = [...[...front.neck].reverse().map(p => shell(p, 1)), ...back.neck.map(p => shell(p, -1))];
  const mesh: PartMesh = { part: 'collar', positions: [], uvs: [], indices: [] };
  collarMesh(mesh, neck, flat, front.neck.length, COLLAR_CM, placketOf(product).width, isWovenCollar(product));
  return mesh;
}

/** The same flat cloth used for collar rest lengths, translated to a positive pattern origin. */
function collarPattern(product: Product): PatternPiece {
  const mesh = collarDraft(product), columns = mesh.uvs.length / 6;
  const left = Math.min(...mesh.uvs.filter((_, i) => i % 2 === 0));
  const point = (row: number, column: number): Pt => ({ x: mesh.uvs[(row * columns + column) * 2]! - left, y: mesh.uvs[(row * columns + column) * 2 + 1]! });
  // Rows are straight in the flat draft; the woven fall is wider, with a bend at its stand/fall fold.
  const outline = [point(0, 0), point(0, columns - 1), point(1, columns - 1), point(2, columns - 1), point(2, 0), point(1, 0)];
  return { ...makePiece('collar', outline, isWovenCollar(product) ? 2 : 1), foldLine: [point(1, 0), point(1, columns - 1)] };
}

function collarMesh(collar: PartMesh, ring: P3[], flatRing: Pt[], frontCount: number, height: number, opening: number, curved = false) {
  const indices = ring.map((_, i) => i), front = indices.slice(0, frontCount);
  const crossing = front.findIndex((i, k) => k > 0 && Math.sign(ring[i]!.x) !== Math.sign(ring[front[k - 1]!]!.x));
  // The ends are the neck-edge points nearest the placket's edges; a point the front and back curves share is kept once.
  const clear = (i: number) => Math.abs(ring[i]!.x) >= (opening - MESH_STEP) / 2;
  const kept = [...front.slice(crossing).filter(clear), ...indices.slice(frontCount), ...front.slice(0, crossing).filter(clear)]
    .filter((i, k, all) => k === 0 || Math.hypot(ring[i]!.x - ring[all[k - 1]!]!.x, ring[i]!.y - ring[all[k - 1]!]!.y, ring[i]!.z - ring[all[k - 1]!]!.z) > 1e-6);
  const neck = kept.map(i => ring[i]!), flatNeck = kept.map(i => flatRing[i]!);
  const centreZ = ring.reduce((sum, p) => sum + p.z, 0) / ring.length, fall = height - COLLAR_STAND;
  const out = (p: P3) => { const dx = p.x, dz = p.z - centreZ, length = Math.hypot(dx, dz) || 1; return { x: dx / length, z: dz / length }; };
  const stand = neck.map(p => ({ x: p.x * 1.04, y: p.y + COLLAR_STAND, z: centreZ + (p.z - centreZ) * 1.04 }));
  const folded = stand.map(p => {
    const o = out(p), angle = (37 + 43 * Math.abs(o.z) ** 2) * Math.PI / 180, across = fall * Math.cos(angle);
    return { x: p.x + o.x * across, y: p.y - fall * Math.sin(angle), z: p.z + o.z * across };
  });
  // The neck edge is sewn to the neckline, so it takes the flat neckline's lengths, not its modelled 3D ones. A knitted
  // collar's flat piece is a rectangle that long: its fall's outer edge stretches over the shoulders. A woven one cannot
  // stretch, so it is cut curved, each row longer than the neck edge by CURVE_SHARE of what it is in 3D: cut to the full
  // 3D length, its points stood 5-8 cm off the chest once the neckline settled; at a third, it stretched over 50%.
  const rows = [neck, stand, folded], heights = [0, COLLAR_STAND, height], columns = neck.length;
  const along = (row: { x: number; y: number; z?: number }[]) => {
    const lengths = [0];
    for (let i = 1; i < columns; i++) { const a = row[i - 1]!, b = row[i]!; lengths.push(lengths[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0))); }
    return lengths;
  };
  const flat = along(flatNeck), scale = flat[columns - 1]! / (along(neck)[columns - 1]! || 1);
  rows.forEach((row, r) => {
    const lengths = r === 0 || !curved ? flat : along(row).map(length => length * scale).map((length, i) => flat[i]! + CURVE_SHARE * (length - flat[i]!)), middle = lengths[columns - 1]! / 2;
    row.forEach((p, i) => { collar.positions.push(p.x, p.y, p.z); collar.uvs.push(lengths[i]! - middle, heights[r]!); });
  });
  for (let r = 0; r < 2; r++) for (let i = 0; i < columns - 1; i++) {
    const a = r * columns + i, b = a + 1, c = a + columns, d = b + columns;
    collar.indices.push(a, c, b, b, c, d);
  }
}

/**
 * Hood: two side panels lofted from the sides and back of the neck edge up to the crown, where they meet on the centre
 * seam; their centre back columns meet too. The middle of the front neck stays open as the face opening. Rows ease
 * from the neck curve toward a head-sized ellipse set slightly back. Each panel's UVs are its pattern piece
 * (hoodOutline), mapped across the panel between its four edges: neck, face, crown and back seam.
 */
function hoodMesh(hood: PartMesh, ring: { x: number; y: number; z: number }[], front: ReadonlySet<number>,
  dims: { neckHalf: number; hoodHeight: number; hoodWidth: number; hoodHalf: number }, outline: ReturnType<typeof hoodOutline>) {
  const open = dims.neckHalf * HOOD_OPENING;
  const frontRight = ring.filter((p, i) => front.has(i) && p.x >= open), back = ring.filter((_, i) => !front.has(i)), frontLeft = ring.filter((p, i) => front.has(i) && p.x <= -open);
  const base = [...frontRight, ...back, ...frontLeft], rows = 16;
  const along: number[] = [0];
  for (let i = 1; i < base.length; i++) along.push(along[i - 1] + Math.hypot(base[i].x - base[i - 1].x, base[i].z - base[i - 1].z));
  // Columns go round the head from one side of the face opening, over the back, to the other side.
  const opening = 0.32 * Math.PI, total = along.at(-1) || 1;
  const grid: P3[][] = [];
  for (let j = 0; j <= rows; j++) {
    const t = j / rows, ease = 1 - (1 - t) ** 2.4;
    // Toward the crown the two sides close onto the centre seam: x narrows, front-to-back depth stays.
    const crown = t < 0.6 ? 1 : Math.cos(((t - 0.6) / 0.4) * Math.PI / 2), rise = dims.hoodHeight * t + (t > 0.6 ? 3 * Math.sin(((t - 0.6) / 0.4) * Math.PI / 2) : 0);
    grid.push(base.map((b, i) => {
      const theta = opening + (2 * Math.PI - 2 * opening) * along[i] / total;
      const dome = { x: dims.hoodHalf * Math.sin(theta), z: -5 + 14 * (dims.hoodWidth / 26) * Math.cos(theta) };
      return { x: (b.x + (dome.x - b.x) * ease) * crown, y: b.y + rise, z: b.z + (dome.z - b.z) * ease };
    }));
  }
  // The centre back column, which both panels share; columns sit on the pattern's neck edge by their distance along
  // the 3D neck edge, which dips at the front.
  const middle = frontRight.length + back.findIndex(p => Math.abs(p.x) < 1e-6), seam: number[] = [0];

  for (let i = 1; i < base.length; i++) seam.push(seam[i - 1] + Math.hypot(base[i].x - base[i - 1].x, base[i].y - base[i - 1].y, base[i].z - base[i - 1].z));
  // The pattern panel between its edges (a Coons patch): u from the face to the centre back, v from the neck up.
  const A = outline.neck[0]!, B = outline.neck.at(-1)!, D = outline.crown[0]!, C = outline.crown.at(-1)!, top = outline.crown;
  const flat = (u: number, v: number): Pt => {
    const bottom = alongPolyline(outline.neck, u), upper = alongPolyline(top, u);
    const left = { x: A.x + (D.x - A.x) * v, y: A.y + (D.y - A.y) * v }, right = { x: B.x + (C.x - B.x) * v, y: B.y + (C.y - B.y) * v };
    const corner = (axis: 'x' | 'y') => (1 - u) * (1 - v) * A[axis] + u * (1 - v) * B[axis] + (1 - u) * v * D[axis] + u * v * C[axis];
    return { x: (1 - v) * bottom.x + v * upper.x + (1 - u) * left.x + u * right.x - corner('x'), y: (1 - v) * bottom.y + v * upper.y + (1 - u) * left.y + u * right.y - corner('y') };
  };
  for (const columns of [Array.from({ length: middle + 1 }, (_, k) => k), Array.from({ length: base.length - middle }, (_, k) => base.length - 1 - k)]) {
    const start = hood.positions.length / 3, first = columns[0]!, span = Math.abs(seam[columns.at(-1)!]! - seam[first]!) || 1, mirror = first > middle;
    for (let j = 0; j <= rows; j++) for (const i of columns) {
      const p = grid[j]![i]!, f = flat(Math.abs(seam[i]! - seam[first]!) / span, j / rows);
      hood.positions.push(p.x, p.y, p.z);
      // The left panel is mirrored, so prints read the same way from outside.
      hood.uvs.push(mirror ? -f.x : f.x, f.y);
    }
    const width = columns.length;
    for (let j = 0; j < rows; j++) for (let k = 0; k + 1 < width; k++) {
      const a = start + j * width + k, b = a + 1, c = a + width, d = c + 1;
      hood.indices.push(...(mirror ? [a, c, b, b, c, d] : [a, b, c, b, d, c]));
    }
  }
}
