import { DRESS_LENGTH, RIB_PARTS, isBottoms, layerOrder, material, sleeveAngleOf, teeDimensions, topMeasurements, trouserDimensions, type Material, type PartId, type PartMesh, type Product } from './product.ts';
import { skirtDraft, skirtHeight } from './product-skirt.ts';

/**
 * Drapes a top on a body: the product's own 3D parts become one cloth, sewn at the seams where they already meet,
 * and an extended position-based (XPBD) solver lets it settle on a body proxy under gravity.
 *
 * - Rest lengths are flat fabric distances: every piece is meshed from its pattern piece and carries its flat position
 *   in its UVs. Across a seam (front to back, sleeve to armhole) bending rest lengths are measured unfolded, so seams
 *   do not hold a crease. The neck rib keeps its modelled 3D lengths.
 * - The body is a proxy from chest and optional waist/hip girths, with optional chest depth and assumed heights/limbs: a torso of stadium-shaped sections,
 *   sloped shoulders, neck, head and arms along the sleeve angle. It grows from inside the garment to full size before
 *   gravity starts, so the cloth starts outside it.
 * - Fabric weight comes from each part's library material (g/m²). Bending and stretch come from approximate physical
 *   properties of its construction (FABRIC): bending resists folding through an isometric bending energy, and each
 *   edge's stretch stiffness is its share of the fabric's membrane stiffness along that edge's direction to the grain
 *   (vertical on every pattern piece), so wovens are soft on the bias and knits stretch more across than along. The ratio of bending rigidity to weight
 *   (the fabric's bending length, about 1.8 cm for jersey and 2.7 cm for denim) is what makes fabrics hang differently.
 * Units are centimetres, grams and seconds; y is up with the hem at 0, as in the product's 3D view.
 */

/**
 * Approximate properties by fabric construction, at a reference weight: flexural rigidity per width (µN·m, as in
 * Kawabata bending tests, where 1 gf·cm²/cm ≈ 98 µN·m), membrane tensile stiffness along the grain (N/m), the
 * cross-grain stiffness as a share of it (`weft`: a knit's courses stretch more than its wales), and in-plane shear
 * rigidity (N/m per radian; Kawabata shear stiffness G of 1 gf/cm·degree ≈ 56). They are typical values for cotton
 * knits and wovens from published ranges, not measurements of these library fabrics. Wovens resist stretch along warp
 * and weft but shear easily, so they are several times softer on the bias.
 *
 * `drape` scales bending for draping: real fabrics hold folds open by friction between yarns (bending hysteresis),
 * which this elastic model lacks. Each factor makes the construction's drape test (drape-test.ts) land in the middle of
 * the drape coefficients reported for it; knits need about three times their elastic rigidity, wovens about one.
 */
export const FABRIC: Record<Material['texture'], { bending: number; tensile: number; weft: number; shear: number; gsm: number; drape: number }> = {
  jersey: { bending: 3, tensile: 150, weft: 0.5, shear: 40, gsm: 180, drape: 3.25 }, slub: { bending: 2.5, tensile: 150, weft: 0.5, shear: 40, gsm: 160, drape: 3.25 },
  rib: { bending: 3, tensile: 60, weft: 0.3, shear: 30, gsm: 220, drape: 3.6 }, pique: { bending: 6, tensile: 300, weft: 0.6, shear: 80, gsm: 200, drape: 3.45 },
  terry: { bending: 12, tensile: 400, weft: 0.6, shear: 100, gsm: 300, drape: 3.27 }, linen: { bending: 12, tensile: 3000, weft: 0.8, shear: 60, gsm: 170, drape: 1.15 },
  twill: { bending: 50, tensile: 6000, weft: 0.7, shear: 120, gsm: 340, drape: 1.29 }, canvas: { bending: 150, tensile: 10000, weft: 0.9, shear: 300, gsm: 400, drape: 0.81 },
  chiffon: { bending: 0.4, tensile: 1500, weft: 0.9, shear: 15, gsm: 50, drape: 2.97 }, poplin: { bending: 5, tensile: 4000, weft: 0.6, shear: 70, gsm: 120, drape: 2.83 },
};
/** In-plane Poisson ratio along the grain, for the off-axis stiffness. */
const POISSON = 0.25;
/** Bending rigidity in dyn·cm, and membrane stiffness along the grain, across it and in shear in dyn/cm, for a library
 * material; heavier cloth of the same construction is thicker, and rigidity grows with thickness, so it scales with the
 * square of the weight ratio. */
export function fabricProperties(fabric: Material): { bending: number; tensile: number; weft: number; shear: number } {
  const base = FABRIC[fabric.texture], ratio = fabric.gsm / base.gsm;
  return { bending: base.bending * base.drape * 10 * ratio * ratio, tensile: base.tensile * 1000 * ratio, weft: base.tensile * base.weft * 1000 * ratio, shear: base.shear * 1000 * ratio };
}
/**
 * Membrane stiffness of a fabric stretched along a flat direction (dx, dy), the grain running along y: the
 * orthotropic off-axis modulus 1/E(θ) = cos⁴θ/E₁ + sin⁴θ/E₂ + (1/G − 2ν/E₁)·sin²θ·cos²θ, θ from the grain.
 */
export function directionalStiffness(properties: ReturnType<typeof fabricProperties>, dx: number, dy: number): number {
  const length = Math.hypot(dx, dy);
  if (length < 1e-12) return properties.tensile;
  const c = dy / length, s = dx / length;
  return 1 / (c ** 4 / properties.tensile + s ** 4 / properties.weft + (1 / properties.shear - 2 * POISSON / properties.tensile) * s * s * c * c);
}
/** Bending length (cm): the cube root of bending rigidity over weight per area, the classic measure of drape stiffness. */
export function bendingLength(fabric: Material): number {
  return Math.cbrt(fabricProperties(fabric).bending / (fabric.gsm / 10000 * GRAVITY));
}
/** Parts whose shape is modelled in 3D rather than taken from their flat pattern piece. */
const MODELLED: ReadonlySet<PartId> = new Set(['neckband']);
/** Overlays carried on the front body rather than simulated: [part, height above the front]. */
const CARRIED: ReadonlyMap<PartId, number> = new Map([['pocket', 0.5], ['chestPocket', 0.35]]);

export const BODY_CHEST = [70, 140] as const;
export const BODY_WAIST = [50, 180] as const;
export const BODY_HIP = [50, 220] as const;
export const BODY_CHEST_DEPTH = [10, 44] as const;
export const BODY_HEIGHT = [140, 210] as const;
export const BODY_HIP_DEPTH = [5, 40] as const;
export const BODY_UPPER_ARM_GIRTH = [15, 65] as const;
export const BODY_UNDERBUST = [50, 138] as const;
/** The difference between the chest (full bust) and the underbust a body with a bust can have, cm. */
export const BUST_DIFFERENCE = [2, 40] as const;
/** Optional body measurements beyond the chest; omitted ones follow automatic proportions. With `underbust`, the chest
 * is the full bust, measured over the bust. */
export interface TopBodyShape { waist?: number; hip?: number; chestDepth?: number; height?: number; hipDepth?: number; upperArmGirth?: number; underbust?: number }
/** Body height, if given, sets the body's lengths (arm, torso landmarks, legs) as typical fractions of it. */
export function validateBodyHeight(height: unknown): number | undefined {
  if (height === undefined) return undefined;
  if (typeof height !== 'number' || !Number.isFinite(height) || height < BODY_HEIGHT[0] || height > BODY_HEIGHT[1]) throw new Error(`Body height must be from ${BODY_HEIGHT[0]} to ${BODY_HEIGHT[1]} cm, or blank for automatic proportions.`);
  return height;
}
/** Vertical distance from the body waist to its fullest hip; absent preserves existing proportions. */
export function validateBodyHipDepth(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < BODY_HIP_DEPTH[0] || value > BODY_HIP_DEPTH[1]) {
    throw new Error('Body waist-to-hip depth must be from 5 to 40 cm, or blank for automatic proportions.');
  }
  return value;
}
/** Entered circumference at the fullest upper arm; absent keeps garment-limited automatic proportions. */
export function validateBodyUpperArmGirth(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < BODY_UPPER_ARM_GIRTH[0] || value > BODY_UPPER_ARM_GIRTH[1]) {
    throw new Error('Body upper-arm girth must be from 15 to 65 cm, or blank for automatic proportions.');
  }
  return value;
}
/** Girth just under the bust, for a body with a bust; absent, the body has none. */
export function validateBodyUnderbust(value: unknown, chest: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < BODY_UNDERBUST[0] || value > BODY_UNDERBUST[1]) {
    throw new Error(`Underbust must be from ${BODY_UNDERBUST[0]} to ${BODY_UNDERBUST[1]} cm, or blank for a body without a bust.`);
  }
  if (chest - value < BUST_DIFFERENCE[0]) throw new Error(`Underbust must be at least ${BUST_DIFFERENCE[0]} cm smaller than the chest, which is measured over the bust.`);
  if (chest - value > BUST_DIFFERENCE[1]) throw new Error(`The chest can be at most ${BUST_DIFFERENCE[1]} cm larger than the underbust.`);
  return value;
}
export function validateTopBodyShape(chest:number, shape:TopBodyShape = {}):TopBodyShape & {waist:number;hip:number}{
  validateBodyChest(chest);
  if(!shape||typeof shape!=='object'||Array.isArray(shape))throw new Error('Enter optional body waist, hip and chest depth measurements.');
  const underbust = validateBodyUnderbust(shape.underbust, chest);
  if (underbust !== undefined && shape.chestDepth !== undefined) throw new Error('Leave chest depth blank for a body with a bust: the bust sets its depth.');
  // With a bust, the automatic waist follows the ribcage under it rather than the full bust.
  const waist=shape.waist===undefined?(underbust===undefined?chest*.86:Math.min(chest*.86,underbust*.95)):shape.waist,hip=shape.hip===undefined?chest*1.02:shape.hip;
  if(typeof waist!=='number'||!Number.isFinite(waist)||waist<BODY_WAIST[0]||waist>BODY_WAIST[1])throw new Error('Body waist must be from 50 to 180 cm, or blank for automatic proportions.');
  if(typeof hip!=='number'||!Number.isFinite(hip)||hip<BODY_HIP[0]||hip>BODY_HIP[1])throw new Error('Body hip must be from 50 to 220 cm, or blank for automatic proportions.');
  const height = validateBodyHeight(shape.height), hipDepth = validateBodyHipDepth(shape.hipDepth), upperArmGirth = validateBodyUpperArmGirth(shape.upperArmGirth);
  const tall = { ...(height === undefined ? {} : { height }), ...(hipDepth === undefined ? {} : { hipDepth }), ...(upperArmGirth === undefined ? {} : { upperArmGirth }), ...(underbust === undefined ? {} : { underbust }) };
  if (shape.chestDepth !== undefined) {
    const depth = shape.chestDepth;
    if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < BODY_CHEST_DEPTH[0] || depth > BODY_CHEST_DEPTH[1]) {
      throw new Error('Chest depth must be from 10 to 44 cm, or blank for automatic proportions.');
    }
    // A stadium's straight sides cannot have negative length: circumference ≥ π × full depth.
    if (depth > chest / Math.PI) throw new Error(`Chest depth cannot exceed ${(Math.floor(chest / Math.PI * 100) / 100).toFixed(2)} cm at this chest girth.`);
    return {waist, hip, chestDepth: depth, ...tall};
  }
  return{waist,hip,...tall};
}
export const GRAVITY = 981;
const OFFSET = 0.35;      // fabric thickness kept from the body, cm
// The hood falls back onto the garment; there is no cloth-to-cloth contact, so it keeps a layer's distance from the
// body instead, lying over the back rather than through it.
const HOOD_OFFSET = 1.1;
const LAYER_GAP = 0.3;   // kept between a garment and the one under it, cm
// A tucked top: below the bottoms' waistline, and this far above it, its fabric is pressed to within TUCK_GAP of the
// body (as a waistband holds it), easing in from TUCK_EASE farther out once the body has grown. The bottoms are worn
// over its fabric from a centimetre lower, where only held fabric lies.
const TUCK_ABOVE = 1, TUCK_GAP = 0.1, TUCK_EASE = 10;
// Tucked jersey is thin, and the bottoms' fitted waist and hip have little room for it: they are kept this close to it.
const TUCK_LAYER_GAP = 0.1;
// Below the tucked fabric's lowest band, its push on the bottoms fades out over this many cm, back to inside where the
// bottoms lie on their own (the layer's thickness and both gaps, and a little more).
const TUCK_FADE = 3, TUCK_FADE_DROP = OFFSET + TUCK_GAP + TUCK_LAYER_GAP + 0.2;
// The parts of a top that go into the bottoms: its body, not its sleeves (whose cuffs can hang as low as the waist).
const TUCKED_PARTS: readonly PartId[] = ['front', 'back', 'hemBand', 'pocket'];
const FRICTION = 0.35;    // share of sliding removed while touching the body
export const FRAME = 1 / 60;
// Fabric loses energy as it bends: a damping force proportional to the bending rate, in seconds. Without it stiff
// cloth keeps vibrating at its bending frequency instead of settling.
const BEND_DAMPING = 0.03;
const GROW_FRAMES = 45;
const GATHER_FRAMES = 30;
/** Default solve: 3 s of 1/60 s frames, 24 substeps each, enough for woven fabrics to stay close to their length. */
export const GARMENT_FRAMES = 180;
/** Frames over which a drape's remaining motion is measured. */
const SETTLE_FRAMES = 10;
export const GARMENT_SUBSTEPS = 24;
export const GARMENT_SOLVER = 'xpbd-pattern-pieces-v4';

/** A body a little smaller than the garment: 10 cm less than a top's chest. For a skirt, the chest whose automatic
 * waist (0.86 × chest) sits about 2 cm inside the skirt's waist; for trousers, the one whose automatic waist is theirs.
 * Within the supported range. */
export function defaultBodyChest(product: Product): number {
  const chest = product.base === 'skirt' ? (skirtDraft(product).waist - 2) / 0.86 : product.base === 'trousers' ? trouserDimensions(product).waist / 0.86 : topMeasurements(product).chest - 10;
  return Math.min(BODY_CHEST[1], Math.max(BODY_CHEST[0], Math.round(chest)));
}

/** Depth of the hip below the waistline on the skirt body proxy, cm. */
export const SKIRT_HIP_DEPTH = 20;
/**
 * The lower body under a skirt: a stadium-sectioned torso from the waistline (the skirt's top) to the hip, then
 * straight down with the legs together. The skirt's waist row is held at its waistline, as a waistband would, so the
 * body waist must be smaller than the skirt waist.
 */
export function skirtBodyProxy(product: Product, shape: { waist?: number; hip?: number; hipDepth?: number } = {}): BodyProxy {
  const draft = skirtDraft(product), top = skirtHeight(product), hipDepth = validateBodyHipDepth(shape.hipDepth);
  const waist = shape.waist ?? Math.max(BODY_WAIST[0], draft.waist - 2), hip = shape.hip ?? Math.min(BODY_HIP[1], waist * 1.19);
  if (typeof waist !== 'number' || !Number.isFinite(waist) || waist < BODY_WAIST[0] || waist > BODY_WAIST[1]) throw new Error('Body waist must be from 50 to 180 cm.');
  if (typeof hip !== 'number' || !Number.isFinite(hip) || hip < BODY_HIP[0] || hip > BODY_HIP[1]) throw new Error('Body hip must be from 50 to 220 cm.');
  if (waist > draft.waist - 1) throw new Error(`The body waist must be at least 1 cm smaller than the skirt's ${draft.waist} cm waist.`);
  const waistHalf = stadiumHalfWidth(waist, 0.8), hipHalf = stadiumHalfWidth(hip, 0.75);
  const torso: TorsoSection[] = [
    { y: top, halfWidth: waistHalf, halfDepth: waistHalf * 0.8 },
    { y: top - (hipDepth ?? SKIRT_HIP_DEPTH), halfWidth: hipHalf, halfDepth: hipHalf * 0.75 },
    { y: -60, halfWidth: hipHalf, halfDepth: hipHalf * 0.75 },
  ];
  return { chest: 0, waist, hip, chestDepth: 2 * waistHalf * 0.8, torso, capsules: [], ...(hipDepth === undefined ? {} : { landmarks: { waist: top, hip: top - hipDepth } }) };
}

/**
 * The lower body in shorts or trousers: a stadium-sectioned torso from the waist (the waistband) to the hip and down
 * to the crotch, where it ends, and two straight legs from there to the ankles, apart enough that the inseams pass
 * between them. By default the waist and hip are the ones the trousers were drafted for. The legs keep within the
 * trouser legs' circumference where they are inside them. The waistband is held round the body waist.
 */
export function trouserBodyProxy(product: Product, shape: { waist?: number; hip?: number; height?: number; hipDepth?: number } = {}): BodyProxy {
  const d = trouserDimensions(product), waist = shape.waist ?? d.waist, hip = shape.hip ?? d.hip, height = validateBodyHeight(shape.height);
  if (typeof waist !== 'number' || !Number.isFinite(waist) || waist < BODY_WAIST[0] || waist > BODY_WAIST[1]) throw new Error('Body waist must be from 50 to 180 cm.');
  if (typeof hip !== 'number' || !Number.isFinite(hip) || hip < BODY_HIP[0] || hip > BODY_HIP[1]) throw new Error('Body hip must be from 50 to 220 cm.');
  if (hip > d.waistbandLength - 2) throw new Error(`The body hip must be at least 2 cm smaller than the trousers' ${d.waistbandLength} cm hip.`);
  if (waist > hip) throw new Error('The body waist must not be larger than its hip.');
  const hipDepth = validateBodyHipDepth(shape.hipDepth);
  const waistHalf = stadiumHalfWidth(waist, 0.8), hipHalf = stadiumHalfWidth(hip, 0.75), top = d.length + d.waistbandHeight;
  // The legs' length (crotch to floor) is 45% of the body's height when it is given, else 80 cm.
  const crotchY = d.inseam + 3.5, legLength = height ? 0.45 * height : 80, kneeY = crotchY - 0.475 * legLength, ankleY = crotchY - 0.925 * legLength;
  const hipY = hipDepth === undefined ? d.length - d.hipDepth : top - hipDepth;
  if (hipDepth !== undefined && hipY <= crotchY) throw new Error(`Body waist-to-hip depth must place the hip above the trouser crotch (less than ${Number((top - crotchY).toFixed(2))} cm for this proxy).`);
  // A leg's room at height y: the trouser leg's circumference there (front plus back, linear from crotch to hem).
  const thighRoom = (d.thighHalf + 1) * 2, room = (y: number, own: number) => y <= 0 ? own
    : Math.min(own, 0.9 * (thighRoom + (d.legOpening - thighRoom) * (d.inseam - Math.min(d.inseam, y)) / d.inseam) / (2 * Math.PI) - OFFSET);
  const thigh = room(crotchY - 2, hip * 0.55 / (2 * Math.PI)), knee = Math.min(thigh, room(kneeY, hip * 0.37 / (2 * Math.PI))), ankle = Math.min(knee, room(ankleY, hip * 0.22 / (2 * Math.PI)));
  const legX = thigh + 2;
  // The torso carries on above the waistband, so fabric gathered under the band cannot ride over it.
  const torso: TorsoSection[] = [
    { y: top + 16, halfWidth: waistHalf * 1.06, halfDepth: waistHalf * 0.84 },
    { y: top, halfWidth: waistHalf, halfDepth: waistHalf * 0.8 },
    { y: hipY, halfWidth: hipHalf, halfDepth: hipHalf * 0.75 },
    { y: crotchY, halfWidth: Math.max(legX + thigh * 0.8, hipHalf * 0.9), halfDepth: Math.min(hipHalf * 0.75, thigh * 0.9) },
  ];
  const capsules: Capsule[] = [];
  for (const side of [1, -1]) {
    capsules.push({ a: [side * legX, crotchY + thigh * 0.6, 0], b: [side * legX * 0.92, kneeY, 0], radius: thigh, end: knee, limb: true });
    capsules.push({ a: [side * legX * 0.92, kneeY, 0], b: [side * legX * 0.85, ankleY, 0], radius: knee, end: ankle, limb: true });
  }
  return { chest: 0, waist, hip, chestDepth: 2 * waistHalf * 0.8, torso, capsules, bottom: crotchY,
    landmarks: { waist: top, hip: hipY, floor: crotchY - legLength, ...(height ? { height } : {}) } };
}

/** The body a product drapes on: a top's from its chest and shape, a skirt's or trousers' lower body from waist and hip. */
export function garmentBody(product: Product, chest: number, shape: TopBodyShape = {}): BodyProxy {
  return product.base === 'skirt' ? skirtBodyProxy(product, shape) : product.base === 'trousers' ? trouserBodyProxy(product, shape) : bodyProxy(product, validateBodyChest(chest), shape);
}

export function validateBodyChest(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < BODY_CHEST[0] || value > BODY_CHEST[1]) throw new Error(`Body chest must be from ${BODY_CHEST[0]} to ${BODY_CHEST[1]} cm.`);
  return value;
}

type Vec = [number, number, number];
/**
 * A capsule from a to b whose radius tapers from `radius` at a to `end` at b. While the body grows, a limb (arm, neck or
 * head) stays where it is and only thickens, since it already lies inside its sleeve, neck opening or hood; the rest of
 * the body scales about the chest.
 */
export interface Capsule { a: Vec; b: Vec; radius: number; end: number; limb?: boolean }
/** A torso section at height y: a stadium (rounded rectangle) with this half-width and half-depth. */
export interface TorsoSection { y: number; halfWidth: number; halfDepth: number }
/** `bottom`, when set, is the height below which the torso ends (the crotch, between the legs). */
/** Heights of body landmarks (y, cm) and, for a top on a body of given height, how far its sleeves reach past the wrists. */
export interface BodyLandmarks { waist?: number; hip?: number; floor?: number; height?: number; sleeveBeyondWrist?: number; bust?: number }
export interface BodyProxy { chest: number; waist: number; hip: number; chestDepth: number; upperArmGirth?: number; underbust?: number; torso: TorsoSection[]; capsules: Capsule[]; bottom?: number; landmarks?: BodyLandmarks }

/** Half-width of a stadium section of circumference c whose depth is `ratio` of its width. */
const stadiumHalfWidth = (c: number, ratio: number) => c / (4 + ratio * (2 * Math.PI - 4));

/** Perimeter of the convex hull of points [x, z] (what a tape measure round them follows). */
function hullPerimeter(points: [number, number][]): number {
  points.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: [number, number], p: [number, number], q: [number, number]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const chain = (list: [number, number][]) => {
    const kept: [number, number][] = [];
    for (const point of list) { while (kept.length >= 2 && cross(kept.at(-2)!, kept.at(-1)!, point) <= 0) kept.pop(); kept.push(point); }
    return kept.slice(0, -1);
  };
  const hull = [...chain(points), ...chain([...points].reverse())];
  return hull.reduce((sum, point, i) => { const next = hull[(i + 1) % hull.length]!; return sum + Math.hypot(next[0] - point[0], next[1] - point[1]); }, 0);
}

/**
 * The bust of a body whose ribcage at bust height is a stadium of this half-width and half-depth: two spheres in front
 * of it, the bust points `x` either side of the centre front, sized and set into the chest so that a tape round the
 * bust (the convex hull of the section and both spheres) measures `chest`. Each sphere's outer edge reaches the side
 * of the ribcage; only a large difference makes it wider.
 */
export function bustSpheres(halfWidth: number, halfDepth: number, chest: number): { x: number; z: number; radius: number } {
  const x = Math.min(0.09 * chest, halfWidth * 0.62), flat = halfWidth - halfDepth;
  const wall = Math.sqrt(Math.max(0, halfDepth ** 2 - Math.max(x - flat, 0) ** 2));
  const section: [number, number][] = [];
  for (let i = 0; i < 360; i++) { const t = i / 360 * 2 * Math.PI, c = Math.cos(t); section.push([Math.sign(c) * flat + halfDepth * c, halfDepth * Math.sin(t)]); }
  const girth = (radius: number, z: number) => {
    const points = section.slice();
    for (const side of [1, -1]) for (let i = 0; i < 180; i++) { const t = i / 180 * 2 * Math.PI; points.push([side * x + radius * Math.cos(t), z + radius * Math.sin(t)]); }
    return hullPerimeter(points);
  };
  let radius = Math.max(2, halfWidth + 0.5 - x);
  while (girth(radius, wall) < chest && radius < 3 * halfDepth) radius += 0.25;
  // How far the sphere's centre sits behind the chest wall.
  let low = 0, high = radius;
  for (let k = 0; k < 30; k++) { const mid = (low + high) / 2; if (girth(radius, wall - mid) > chest) low = mid; else high = mid; }
  return { x, z: wall - low, radius };
}

/** The body proxy for a top, standing so that its shoulders carry the garment's shoulder line. */
export function bodyProxy(product: Product, chest: number, shape:TopBodyShape = {}): BodyProxy {
  const {waist,hip,chestDepth,height,hipDepth,upperArmGirth,underbust}=validateTopBodyShape(chest,shape);
  const d = teeDimensions(product), top = d.length, shoulderLine = top - d.shoulderDrop;
  // With a bust, the chest is measured over it: the body's frame (the chest under the arms, shoulders, neck, arms and,
  // without a height, its lengths) follows a girth between the underbust and the bust instead.
  const frame = underbust === undefined ? chest : underbust + 0.4 * (chest - underbust);
  // Keep the original arithmetic exactly when omitted. Entered depth solves
  // c = 4(w-d) + 2πd for half-width w, where d is the half-depth.
  const chestHalf = chestDepth === undefined ? stadiumHalfWidth(frame, .7) : Math.max(chestDepth / 2, (chest - (Math.PI - 2) * chestDepth) / 4);
  const depth = chestDepth === undefined ? .7 : chestDepth / (2 * chestHalf);
  const waistHalf = stadiumHalfWidth(waist, depth), hipHalf = stadiumHalfWidth(hip, 0.74);
  const shoulderHalf = frame * 0.235, shoulderRadius = chestHalf * depth * 0.8;
  // The shoulder tops sit just under the garment's shoulder points; the torso section there is the shoulder capsule's.
  // Torso depths below the shoulder: typical fractions of the body's height when it is given, else of its chest.
  const torsoTop = top - d.shoulderDrop - OFFSET - shoulderRadius;
  const armpit = height ? shoulderLine - 0.11 * height : top - d.shoulderDrop - frame * 0.21;
  const waistY = height ? shoulderLine - 0.235 * height : top - frame * 0.44, hipY = hipDepth === undefined ? (height ? shoulderLine - 0.335 * height : top - frame * 0.64) : waistY - hipDepth;
  const torso: TorsoSection[] = [
    { y: torsoTop, halfWidth: shoulderHalf, halfDepth: shoulderRadius },
    { y: armpit, halfWidth: chestHalf, halfDepth: chestHalf * depth },
    { y: waistY, halfWidth: waistHalf, halfDepth: waistHalf * depth },
    { y: hipY, halfWidth: hipHalf, halfDepth: hipHalf * 0.74 },
    { y: -60, halfWidth: hipHalf, halfDepth: hipHalf * 0.74 },
  ];
  const neckBase: Vec = [0, torsoTop + 3.5, -1], angle = d.sleeveAngle * Math.PI / 180;
  const capsules: Capsule[] = [
    { a: neckBase, b: [shoulderHalf - shoulderRadius, torsoTop, 0], radius: shoulderRadius, end: shoulderRadius },
    { a: neckBase, b: [-(shoulderHalf - shoulderRadius), torsoTop, 0], radius: shoulderRadius, end: shoulderRadius },
    { a: [0, torsoTop, -1.5], b: [0, top + 9, -1.5], radius: frame * 0.4 / (2 * Math.PI), end: frame * 0.4 / (2 * Math.PI), limb: true },
    { a: [0, top + 17.5, -0.5], b: [0, top + 17.5, -0.5], radius: 9.5, end: 9.5, limb: true },
  ];
  // The bust: the ribcage under it is the underbust's girth, at the bust points' height (about 6 cm below the armpit),
  // and two spheres in front of it make up the bust.
  let bust: number | undefined, bustDepth: number | undefined;
  if (underbust !== undefined) {
    bust = armpit - Math.min(height ? 0.035 * height : frame * 0.07, (armpit - waistY) / 2);
    const halfWidth = stadiumHalfWidth(underbust, 0.7), halfDepth = halfWidth * 0.7, sphere = bustSpheres(halfWidth, halfDepth, chest);
    torso.splice(2, 0, { y: bust, halfWidth, halfDepth });
    for (const side of [1, -1]) capsules.push({ a: [side * sphere.x, bust, sphere.z], b: [side * sphere.x, bust, sphere.z], radius: sphere.radius, end: sphere.radius });
    bustDepth = halfDepth + sphere.z + sphere.radius;
  }
  // Arms are posed along the sleeves (as a fitting mannequin is posed), slightly above their centre lines, from inside
  // the shoulder to the wrist: a third of the body's height when it is given, else past the sleeve opening. They taper to fit inside the sleeves' flat width (front plus back) at the
  // armhole and at the opening in automatic mode. An entered upper-arm girth overrides the shoulder-end radius
  // without fitting it to the sleeve; forearm/wrist taper and sleeve-aligned pose remain approximate.
  const shoulderPoint = { x: d.shoulderX, y: top - d.shoulderDrop }, underarm = { x: d.half, y: top - d.shoulderDrop - d.armDepth };
  const middle = { x: (shoulderPoint.x + underarm.x) / 2, y: (shoulderPoint.y + underarm.y) / 2 + 1 };
  const direction = { x: Math.cos(angle), y: -Math.sin(angle) };
  const armholeWidth = Math.abs((underarm.x - shoulderPoint.x) * direction.y - (underarm.y - shoulderPoint.y) * direction.x);
  const upper = upperArmGirth === undefined ? Math.min(frame * 0.058, 0.85 * armholeWidth / Math.PI) : upperArmGirth / (2 * Math.PI), opening = Math.min(frame * 0.05, upper, 0.85 * d.cuffHalf / Math.PI);
  const wrist = Math.min(frame * 0.03, opening), inside = 3, reach = inside + d.sleeveLength;
  const armEnd = height ? inside + 0.33 * height : Math.max(reach, 62) + 4;
  for (const side of [1, -1]) {
    const at = (distance: number): Vec => [side * (middle.x + direction.x * (distance - inside)), middle.y + direction.y * (distance - inside), 0];
    // A sleeve longer than the arm hangs past the hand.
    capsules.push({ a: at(0), b: at(Math.min(reach, armEnd)), radius: upper, end: armEnd < reach ? wrist : opening, limb: true });
    if (armEnd > reach) capsules.push({ a: at(reach), b: at(armEnd), radius: opening, end: wrist, limb: true });
  }
  return { chest, waist, hip, chestDepth: chestDepth ?? bustDepth ?? 2 * chestHalf * depth, ...(upperArmGirth === undefined ? {} : { upperArmGirth }), ...(underbust === undefined ? {} : { underbust }), torso, capsules,
    landmarks: { waist: waistY, hip: hipY, ...(height ? { height, sleeveBeyondWrist: reach - armEnd } : {}), ...(bust === undefined ? {} : { bust }) } };
}

/**
 * Signed distances from the body (negative inside) for a body scaled by `s` about the chest height `core`. `scale`
 * precomputes the scaled shapes once per frame; `distance` writes the direction out of the body into `out`. Shapes
 * farther than `reach` from a point are skipped, so far points report Infinity rather than an exact distance.
 */
function bodyField(body: BodyProxy, core: number, reach: number) {
  const sections = body.torso.length, torso = new Float64Array(sections * 3), count = body.capsules.length;
  // Per capsule: start (3), axis (3), 1 / axis², start radius, radius change, bounding centre (3), bounding radius².
  const capsules = new Float64Array(count * 13);
  let scaled = NaN, bottom = -Infinity;
  const scale = (s: number) => {
    if (s === scaled) return;
    scaled = s;
    if (body.bottom !== undefined) bottom = core + (body.bottom - core) * s;
    body.torso.forEach((section, i) => { torso[i * 3] = core + (section.y - core) * s; torso[i * 3 + 1] = section.halfWidth * s; torso[i * 3 + 2] = section.halfDepth * s; });
    body.capsules.forEach((capsule, i) => {
      const place = capsule.limb ? 1 : s, k = i * 13;
      const ax = capsule.a[0] * place, ay = core + (capsule.a[1] - core) * place, az = capsule.a[2] * place;
      const dx = capsule.b[0] * place - ax, dy = core + (capsule.b[1] - core) * place - ay, dz = capsule.b[2] * place - az, span = dx * dx + dy * dy + dz * dz;
      const bound = Math.sqrt(span) / 2 + Math.max(capsule.radius, capsule.end) * s + reach;
      capsules.set([ax, ay, az, dx, dy, dz, span ? 1 / span : 0, capsule.radius * s, (capsule.end - capsule.radius) * s, ax + dx / 2, ay + dy / 2, az + dz / 2, bound * bound], k);
    });
  };
  const distance = (x: number, y: number, z: number, out: Vec): number => {
    let best = Infinity;
    if (y <= torso[0]!) {
      let i = 1;
      while (i < sections - 1 && torso[i * 3]! > y) i++;
      const yu = torso[(i - 1) * 3]!, yl = torso[i * 3]!, t = yu === yl ? 0 : Math.min(1, Math.max(0, (yu - y) / (yu - yl)));
      const halfWidth = torso[(i - 1) * 3 + 1]! + (torso[i * 3 + 1]! - torso[(i - 1) * 3 + 1]!) * t;
      const halfDepth = torso[(i - 1) * 3 + 2]! + (torso[i * 3 + 2]! - torso[(i - 1) * 3 + 2]!) * t;
      const q = Math.max(Math.abs(x) - (halfWidth - halfDepth), 0), length = Math.sqrt(q * q + z * z);
      best = length - halfDepth;
      if (length > 1e-9) { out[0] = Math.sign(x) * q / length; out[1] = 0; out[2] = z / length; } else { out[0] = 0; out[1] = 0; out[2] = 1; }
      // A torso that ends at the crotch is cut flat there: under it, or nearer its underside than its side, the way
      // out is down.
      if (bottom - y > best) { best = bottom - y; out[0] = 0; out[1] = -1; out[2] = 0; }
    }
    for (let k = 0; k < count * 13; k += 13) {
      const cx = x - capsules[k + 9]!, cy = y - capsules[k + 10]!, cz = z - capsules[k + 11]!;
      if (cx * cx + cy * cy + cz * cz > capsules[k + 12]!) continue;
      const px = x - capsules[k]!, py = y - capsules[k + 1]!, pz = z - capsules[k + 2]!, bx = capsules[k + 3]!, by = capsules[k + 4]!, bz = capsules[k + 5]!;
      const t = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) * capsules[k + 6]!));
      const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t, length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const gap = length - capsules[k + 7]! - capsules[k + 8]! * t;
      if (gap < best) {
        best = gap;
        if (length > 1e-9) { out[0] = dx / length; out[1] = dy / length; out[2] = dz / length; } else { out[0] = 0; out[1] = 0; out[2] = 1; }
      }
    }
    return best;
  };
  return { scale, distance };
}

interface Carried { part: PartId; vertex: number; triangle: [number, number, number]; weights: Vec; lift: number }
export interface Cloth {
  /** Initial particle positions (the product's 3D shell). */
  positions: Float32Array;
  inverseMass: Float32Array;
  /** Distance constraints: particle pairs, rest lengths, compliances; `structural` marks stretch (not bending) ones. */
  a: Int32Array; b: Int32Array; rest: Float32Array; compliance: Float32Array; structural: Uint8Array;
  /** For each simulated part, the particle of each of its vertices. */
  vertices: Map<PartId, Int32Array>;
  /** Distance each particle keeps from the body. */
  offset: Float32Array;
  carried: Carried[];
  /** Isometric bending stencils: per stencil four particles (an edge, then its two opposite corners), four weights
   * (whose weighted position sum is zero on the flat rest shape) and a stiffness; see bendingStencil. */
  bendParticles: Int32Array; bendWeights: Float32Array; bendStiffness: Float32Array;
}

/**
 * Isometric bending (Bergou et al., "A quadratic bending model for inextensible surfaces"): for an interior edge with
 * flat rest corners p0..p3 (edge p0-p1, opposite p2 and p3), weights K from the rest cotangents make Σ Kᵢxᵢ vanish
 * when the two triangles are flat. Summed over a mesh's edges, ½·q·|Σ Kᵢxᵢ|² with q = rigidity/(A0 + A1) matches the
 * continuum bending energy ½·rigidity·κ² per area (checked on a cylinder in the tests), and the restoring force is
 * linear in the positions.
 */
export function bendingStencil(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], rigidity: number) {
  const cot = (o: [number, number], u: [number, number], v: [number, number]) => {
    const ax = u[0] - o[0], ay = u[1] - o[1], bx = v[0] - o[0], by = v[1] - o[1], cross = Math.abs(ax * by - ay * bx);
    return cross < 1e-12 ? 0 : (ax * bx + ay * by) / cross;
  };
  // Cotangents of the angles at the edge ends, in each triangle.
  const c01 = cot(p0, p1, p2), c02 = cot(p0, p1, p3), c03 = cot(p1, p0, p2), c04 = cot(p1, p0, p3);
  const area = (a: [number, number], b: [number, number], c: [number, number]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  const total = area(p0, p1, p2) + area(p0, p1, p3);
  return { weights: [c03 + c04, c01 + c02, -c01 - c03, -c02 - c04] as const, stiffness: total > 1e-12 ? rigidity / total : 0 };
}

/** Sews the product's parts into one cloth: coincident vertices become one particle. */
export function buildCloth(product: Product, meshes: PartMesh[]): Cloth {
  return clothFromMeshes(meshes, part => material(product.parts[part].material));
}

/**
 * One cloth from part meshes, each part of the material `materialOf` names: coincident vertices become one particle.
 * Rest shapes are flat fabric coordinates: each vertex's UVs, its position on its flat pattern piece.
 */
export function clothFromMeshes(meshes: PartMesh[], materialOf: (part: PartId) => Material): Cloth {
  const particles = new Map<string, number>(), position: number[] = [], vertices = new Map<PartId, Int32Array>();
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  const simulated = meshes.filter(mesh => !CARRIED.has(mesh.part));
  for (const mesh of simulated) {
    const ids = new Int32Array(mesh.positions.length / 3);
    for (let v = 0; v < ids.length; v++) {
      const x = mesh.positions[v * 3]!, y = mesh.positions[v * 3 + 1]!, z = mesh.positions[v * 3 + 2]!, k = key(x, y, z);
      let id = particles.get(k);
      if (id === undefined) { id = position.length / 3; particles.set(k, id); position.push(x, y, z); }
      ids[v] = id;
    }
    vertices.set(mesh.part, ids);
  }
  const p = (i: number, axis: number) => position[i * 3 + axis]!;
  const flat = (i: number, j: number) => Math.hypot(p(i, 0) - p(j, 0), p(i, 1) - p(j, 1));
  const spatial = (i: number, j: number) => Math.hypot(p(i, 0) - p(j, 0), p(i, 1) - p(j, 1), p(i, 2) - p(j, 2));
  // The neck rib runs along the neckline: its lengths along the neck are the flat neckline's, so it does not pull the
  // neckline to its modelled 3D length. Its vertices alternate neck edge, rib edge (see neckRib).
  const ribAlong = new Map<number, number>(), ribIds = vertices.get('neckband');
  if (ribIds) {
    let along = 0;
    for (let v = 0; v < ribIds.length; v += 2) {
      if (v) along += flat(ribIds[v - 2]!, ribIds[v]!);
      ribAlong.set(ribIds[v]!, along); ribAlong.set(ribIds[v + 1]!, along);
    }
  }
  const ribWidth = ribIds && ribIds.length > 1 ? spatial(ribIds[0]!, ribIds[1]!) : 0, ribEdge = new Set(ribIds ? [...ribIds].filter((_, v) => v % 2) : []);
  const modelledRest = (part: PartId, i: number, j: number) => {
    if (part !== 'neckband' || !ribAlong.has(i) || !ribAlong.has(j)) return spatial(i, j);
    let along = Math.abs(ribAlong.get(i)! - ribAlong.get(j)!);
    // The ring closes: the last neck point joins the first.
    const total = Math.max(...ribAlong.values()) + flat(ribIds![ribIds!.length - 2]!, ribIds![0]!);
    along = Math.min(along, total - along);
    return Math.hypot(along, ribEdge.has(i) === ribEdge.has(j) ? 0 : ribWidth);
  };
  const mass = new Float64Array(position.length / 3);
  // Flat fabric coordinates of a mesh vertex on its own pattern piece.
  const flatCorner = (mesh: PartMesh, v: number): [number, number] => [mesh.uvs[v * 2]!, mesh.uvs[v * 2 + 1]!];
  type Opposite = { vertex: number; modelled: boolean; edgeI: [number, number]; edgeJ: [number, number]; corner: [number, number] };
  // Each edge: rest length, summed compliance and count (averaged where parts meet), and its opposite vertices with
  // the flat positions of that triangle's corners.
  const edges = new Map<string, { i: number; j: number; rest: number; tensile: number; bend: number; area: number; count: number; opposite: Opposite[] }>();
  for (const mesh of simulated) {
    const ids = vertices.get(mesh.part)!, fabric = materialOf(mesh.part), properties = fabricProperties(fabric), modelled = MODELLED.has(mesh.part);
    // The hood is lined, so it bends four times as stiffly.
    const bend = properties.bending * (mesh.part === 'hood' ? 4 : 1);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const corners = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!], tri = corners.map(v => ids[v]!);
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
      const flats = corners.map(v => flatCorner(mesh, v));
      const ux = p(tri[1]!, 0) - p(tri[0]!, 0), uy = p(tri[1]!, 1) - p(tri[0]!, 1), uz = p(tri[1]!, 2) - p(tri[0]!, 2);
      const vx = p(tri[2]!, 0) - p(tri[0]!, 0), vy = p(tri[2]!, 1) - p(tri[0]!, 1), vz = p(tri[2]!, 2) - p(tri[0]!, 2);
      const area = modelled ? Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
        : Math.abs((flats[1]![0] - flats[0]![0]) * (flats[2]![1] - flats[0]![1]) - (flats[1]![1] - flats[0]![1]) * (flats[2]![0] - flats[0]![0])) / 2;
      for (const vertex of tri) mass[vertex] += area * fabric.gsm / 10000 / 3;
      for (let e = 0; e < 3; e++) {
        const i = tri[e]!, j = tri[(e + 1) % 3]!, opposite = tri[(e + 2) % 3]!, k = i < j ? `${i},${j}` : `${j},${i}`;
        const fi = flats[e]!, fj = flats[(e + 1) % 3]!;
        let edge = edges.get(k);
        if (!edge) { edge = { i: Math.min(i, j), j: Math.max(i, j), rest: modelled ? modelledRest(mesh.part, i, j) : Math.hypot(fi[0] - fj[0], fi[1] - fj[1]), tensile: 0, bend: 0, area: 0, count: 0, opposite: [] }; edges.set(k, edge); }
        // Each edge stretches with the fabric's stiffness along its flat direction; modelled parts have no flat grain.
        edge.tensile += modelled ? properties.tensile : directionalStiffness(properties, fj[0] - fi[0], fj[1] - fi[1]); edge.bend += bend; edge.area += area; edge.count++;
        // Flat corners in the edge's own (low id, high id) order.
        edge.opposite.push({ vertex: opposite, modelled, edgeI: i < j ? fi : fj, edgeJ: i < j ? fj : fi, corner: flats[(e + 2) % 3]! });
      }
    }
  }
  const a: number[] = [], b: number[] = [], rest: number[] = [], compliance: number[] = [], structural: number[] = [];
  const bendParticles: number[] = [], bendWeights: number[] = [], bendStiffness: number[] = [];
  const add = (i: number, j: number, length: number, value: number, isStructural: boolean) => { a.push(i); b.push(j); rest.push(length); compliance.push(value); structural.push(isStructural ? 1 : 0); };
  for (const edge of edges.values()) {
    const tensile = edge.tensile / edge.count, bend = edge.bend / edge.count;
    // A triangle-lattice edge carrying its share of the membrane: k = E·(A0 + A1)/L² (k = E·A/L² on a boundary).
    add(edge.i, edge.j, edge.rest, edge.rest > 1e-9 && edge.area > 0 ? edge.rest * edge.rest / (tensile * edge.area) : 1e-9, true);
    if (edge.opposite.length !== 2) continue;
    const [o1, o2] = edge.opposite as [typeof edge.opposite[0], typeof edge.opposite[0]];
    if (o1.modelled || o2.modelled) {
      // Modelled 3D parts keep their shape with a distance between the opposite corners.
      add(o1.vertex, o2.vertex, spatial(o1.vertex, o2.vertex), 1 / (bend * 0.16), false);
      continue;
    }
    // The edge laid flat along x, with each opposite corner placed from its own triangle's flat pattern piece, the two
    // triangles unfolded on either side of the edge: across a seam they lie flat too, so a seam holds no crease.
    const place = (o: Opposite) => {
      const ex = o.edgeJ[0] - o.edgeI[0], ey = o.edgeJ[1] - o.edgeI[1], span = Math.hypot(ex, ey) || 1;
      const dx = o.corner[0] - o.edgeI[0], dy = o.corner[1] - o.edgeI[1];
      return { span, along: (dx * ex + dy * ey) / span, across: Math.abs(dy * ex - dx * ey) / span };
    };
    const first = place(o1), second = place(o2);
    if (first.across < 1e-9 || second.across < 1e-9) continue;
    const stencil = bendingStencil([0, 0], [first.span, 0], [first.along, first.across], [second.along, -second.across], bend);
    bendParticles.push(edge.i, edge.j, o1.vertex, o2.vertex);
    bendWeights.push(...stencil.weights);
    bendStiffness.push(stencil.stiffness);
  }
  // Pockets ride on the front body: each vertex keeps its place on the front triangle under it (flat coordinates).
  const carried: Carried[] = [], front = meshes.find(mesh => mesh.part === 'front'), frontIds = vertices.get('front');
  for (const mesh of meshes) {
    const lift = CARRIED.get(mesh.part);
    if (lift === undefined || !front || !frontIds) continue;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const x = mesh.positions[v * 3]!, y = mesh.positions[v * 3 + 1]!;
      let best: Carried | null = null, bestScore = Infinity;
      for (let t = 0; t < front.indices.length; t += 3) {
        const tri: [number, number, number] = [frontIds[front.indices[t]!]!, frontIds[front.indices[t + 1]!]!, frontIds[front.indices[t + 2]!]!];
        if (p(tri[0], 2) + p(tri[1], 2) + p(tri[2], 2) <= 0) continue;
        const [x0, y0, x1, y1, x2, y2] = [p(tri[0], 0), p(tri[0], 1), p(tri[1], 0), p(tri[1], 1), p(tri[2], 0), p(tri[2], 1)];
        const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(det) < 1e-12) continue;
        const w0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det, w1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det, w2 = 1 - w0 - w1;
        const score = Math.max(0, -w0) + Math.max(0, -w1) + Math.max(0, -w2);
        if (score < bestScore) { bestScore = score; best = { part: mesh.part, vertex: v, triangle: tri, weights: [w0, w1, w2], lift }; }
        if (score === 0) break;
      }
      if (best) carried.push(best);
    }
  }
  const inverseMass = Float32Array.from(mass, m => (m > 0 ? 1 / m : 0)), offset = new Float32Array(inverseMass.length).fill(OFFSET);
  const sewn = new Set<number>();
  for (const [part, ids] of vertices) if (part !== 'hood') for (const id of ids) sewn.add(id);
  for (const id of vertices.get('hood') ?? []) if (!sewn.has(id)) offset[id] = HOOD_OFFSET;
  return { offset, positions: Float32Array.from(position), inverseMass, a: Int32Array.from(a), b: Int32Array.from(b), rest: Float32Array.from(rest), compliance: Float32Array.from(compliance), structural: Uint8Array.from(structural), vertices, carried,
    bendParticles: Int32Array.from(bendParticles), bendWeights: Float32Array.from(bendWeights), bendStiffness: Float32Array.from(bendStiffness) };
}

export interface GarmentDrapeMetrics {
  /** Garment chest minus body chest (for a skirt, garment waist minus body waist; for trousers, garment hip minus body hip), cm. */
  ease: number;
  /** Smallest distance from the cloth to the body, cm. */
  minClearance: number;
  /** Share of the cloth resting on the body (within 0.3 cm of the fabric offset). */
  contact: number;
  /** Largest stretch of any seam-to-seam fabric edge relative to its flat length. */
  maxStrain: number;
  /** Fastest point speed at the end, cm/s. */
  residualSpeed: number;
  /** Where the garment ends on the body, cm: a top's hem below the hip (negative above it), trousers' hems above
   * the floor, and (for a body of given height) how far the sleeves reach past the wrists (negative: short of them). */
  fit?: { hemBelowHip?: number; hemAboveFloor?: number; sleeveBeyondWrist?: number };
}
export interface GarmentDrapeResult { parts: { part: PartId; positions: Float32Array }[]; metrics: GarmentDrapeMetrics; body: BodyProxy;
  /** In an outfit, the garment worn with this one, draped on the same body in this garment's place. */
  companion?: { parts: { part: PartId; positions: Float32Array }[]; metrics: GarmentDrapeMetrics } }

/**
 * The extended position-based solver for one cloth with time step `dt`: `inverseMass` (0 holds a particle still) may
 * differ from the cloth's own, and `rest` lengths may be changed between steps. Each `step` integrates bending
 * explicitly, then gravity and damping, then solves the stretch constraints once (XPBD), applies `tethers`, calls
 * `contact` to correct positions, and returns the fastest particle speed.
 *
 * One pass of stretch constraints per step carries tension only slowly down long hanging cloth, which then sags as
 * if it stretched. Tethers (long-range attachments, Kim et al. 2012) fix that for cloth hanging from held particles:
 * each tethered particle stays within `length` of its held `anchor`.
 */
export function clothSolver(cloth: Cloth, inverseMass: Float32Array, dt: number,
  tethers?: { particle: Int32Array; anchor: Int32Array; length: Float32Array }) {
  const positions = Float32Array.from(cloth.positions), previous = Float32Array.from(positions), velocity = new Float32Array(positions.length);
  const { a, b, bendParticles, bendWeights } = cloth, count = inverseMass.length, rest = Float32Array.from(cloth.rest), lambdas = new Float32Array(rest.length);
  const alpha = Float32Array.from(cloth.compliance, c => c / (dt * dt));
  const stencils = cloth.bendStiffness.length;
  // Bending is integrated explicitly, so each stencil's stiffness and damping stay within what this step can carry
  // with a margin: for its natural frequency ω (ω² = q·Σ Kᵢ²/mᵢ), dt²·ω² ≤ ¼ and dt·β·ω² ≤ ½. Only tiny or very stiff
  // triangles are affected; ordinary cloth keeps its full stiffness and damping.
  const bendStiffness = new Float32Array(stencils), bendDamping = new Float32Array(stencils);
  for (let s = 0; s < stencils; s++) {
    let spread = 0;
    for (let c = 0; c < 4; c++) spread += bendWeights[s * 4 + c]! ** 2 * inverseMass[bendParticles[s * 4 + c]!]!;
    const q = Math.min(cloth.bendStiffness[s]!, spread > 0 ? 0.25 / (dt * dt * spread) : 0), omega2 = q * spread;
    bendStiffness[s] = q;
    bendDamping[s] = omega2 > 0 ? Math.min(BEND_DAMPING, 0.5 / (dt * omega2)) : 0;
  }
  function step(damping: number, gravity: number, contact: () => void = () => {}): number {
    // Bending: each stencil pushes its corners back towards flat, with a force linear in the positions, damped in
    // proportion to how fast the stencil is bending.
    for (let s = 0; s < stencils; s++) {
      const q = bendStiffness[s]! * dt, beta = bendDamping[s]!;
      let sx = 0, sy = 0, sz = 0;
      for (let c = 0; c < 4; c++) {
        const k = bendParticles[s * 4 + c]! * 3, w = bendWeights[s * 4 + c]!;
        sx += w * (positions[k]! + beta * velocity[k]!); sy += w * (positions[k + 1]! + beta * velocity[k + 1]!); sz += w * (positions[k + 2]! + beta * velocity[k + 2]!);
      }
      for (let c = 0; c < 4; c++) {
        const i = bendParticles[s * 4 + c]!, k = i * 3, f = -q * bendWeights[s * 4 + c]! * inverseMass[i]!;
        velocity[k] += f * sx; velocity[k + 1] += f * sy; velocity[k + 2] += f * sz;
      }
    }
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      previous[k] = positions[k]!; previous[k + 1] = positions[k + 1]!; previous[k + 2] = positions[k + 2]!;
      if (inverseMass[i] === 0) { velocity[k] = velocity[k + 1] = velocity[k + 2] = 0; continue; }
      velocity[k] *= damping; velocity[k + 1] = velocity[k + 1]! * damping - gravity * dt; velocity[k + 2] *= damping;
      positions[k] += velocity[k]! * dt; positions[k + 1] += velocity[k + 1]! * dt; positions[k + 2] += velocity[k + 2]! * dt;
    }
    lambdas.fill(0);
    for (let n = 0; n < rest.length; n++) {
      const i = a[n]!, j = b[n]!, wa = inverseMass[i]!, wb = inverseMass[j]!, w = wa + wb;
      if (w === 0) continue;
      const ka = i * 3, kb = j * 3;
      const dx = positions[ka]! - positions[kb]!, dy = positions[ka + 1]! - positions[kb + 1]!, dz = positions[ka + 2]! - positions[kb + 2]!;
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length < 1e-9) continue;
      const delta = (-(length - rest[n]!) - alpha[n]! * lambdas[n]!) / (w + alpha[n]!);
      lambdas[n] += delta;
      const sx = dx / length * delta, sy = dy / length * delta, sz = dz / length * delta;
      positions[ka] += sx * wa; positions[ka + 1] += sy * wa; positions[ka + 2] += sz * wa;
      positions[kb] -= sx * wb; positions[kb + 1] -= sy * wb; positions[kb + 2] -= sz * wb;
    }
    if (tethers) for (let t = 0; t < tethers.particle.length; t++) {
      const k = tethers.particle[t]! * 3, h = tethers.anchor[t]! * 3, limit = tethers.length[t]!;
      const dx = positions[k]! - positions[h]!, dy = positions[k + 1]! - positions[h + 1]!, dz = positions[k + 2]! - positions[h + 2]!;
      const length = Math.hypot(dx, dy, dz);
      if (length > limit) { const scale = limit / length; positions[k] = positions[h]! + dx * scale; positions[k + 1] = positions[h + 1]! + dy * scale; positions[k + 2] = positions[h + 2]! + dz * scale; }
    }
    contact();
    let speed = 0;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      velocity[k] = (positions[k]! - previous[k]!) / dt; velocity[k + 1] = (positions[k + 1]! - previous[k + 1]!) / dt; velocity[k + 2] = (positions[k + 2]! - previous[k + 2]!) / dt;
      speed = Math.max(speed, Math.hypot(velocity[k]!, velocity[k + 1]!, velocity[k + 2]!));
    }
    return speed;
  }
  return { positions, previous, velocity, rest, a, b, step };
}

/** How far a hood starts folded back from upright before draping, in radians. */
const HOOD_FOLD = Math.PI * 0.8;

/**
 * A hood drapes worn down: before the simulation it is folded back over the shoulders about the back of the neck,
 * each point further the higher it is on the hood pattern (its flat y runs from the crown down to the neck edge).
 * Points sewn to the neckline stay where they are.
 */
function foldHood(cloth: Cloth, meshes: PartMesh[]) {
  const mesh = meshes.find(item => item.part === 'hood'), ids = cloth.vertices.get('hood');
  if (!mesh || !ids) return;
  const sewn = new Set<number>();
  for (const [part, others] of cloth.vertices) if (part !== 'hood') for (const id of others) sewn.add(id);
  const p = cloth.positions, neck = ids.filter(id => sewn.has(id) && p[id * 3 + 2]! < 0);
  if (!neck.length) return;
  // The centre back of the neck: the sewn hood point nearest the middle, behind.
  const pivot = neck.reduce((best, id) => Math.abs(p[id * 3]!) < Math.abs(p[best * 3]!) ? id : best, neck[0]!);
  const py = p[pivot * 3 + 1]!, pz = p[pivot * 3 + 2]!, height = Math.max(...mesh.uvs.filter((_, i) => i % 2 === 1)) || 1;
  const done = new Set<number>();
  ids.forEach((id, v) => {
    if (sewn.has(id) || done.has(id)) return;
    done.add(id);
    const t = Math.min(1, Math.max(0, (height - mesh.uvs[v * 2 + 1]!) / height)), angle = HOOD_FOLD * t * t * (3 - 2 * t);
    const dy = p[id * 3 + 1]! - py, dz = p[id * 3 + 2]! - pz, cos = Math.cos(angle), sin = Math.sin(angle);
    p[id * 3 + 1] = py + dy * cos + dz * sin;
    p[id * 3 + 2] = pz - dy * sin + dz * cos;
  });
}

/**
 * A top worn under another, as how far it stands off the body: for each place on the body's surface (a 1.5 cm grid),
 * the farthest any of its draped cloth lies from the body there. The outer top keeps that far from the body (up to
 * INNER_PRESSED), and a layer's gap more, where the top underneath is, so it rests on it as on a thicker body (whose
 * surface is smooth, so nothing is pushed back and forth across a seam's fold). Read at a point's nearest place on the
 * body; 0 where the top underneath does not reach (below its hem, past its sleeves).
 */
export interface InnerLayer {
  /** How far the top underneath stands off the body at this place on the body's surface; 0 where it does not reach. */
  offset(x: number, y: number, z: number): number;
  /** How far a point is outside the top underneath (negative inside it), or null where that top does not reach. */
  clearance(x: number, y: number, z: number): number | null;
}
const INNER_CELL = 1.5, INNER_REACH = 8;
// A top underneath gives way under another: pressed flat, it stands at most this far off the body, so the outer top
// drapes much as it does alone and is never stretched round loose folds (a long sleeve gathered inside a rib cuff).
const INNER_PRESSED = 2.5;
// Under a rib cuff or band, which grips what it covers, the top underneath is pressed flat against the body.
const INNER_PRESSED_RIB = 0.5;
/**
 * The top underneath pressed in under the one `over` it: wherever the outer top lies closer to the body than the cloth
 * underneath, that cloth is moved in towards the body to a layer's gap inside it. Elsewhere (through an open zip, below
 * a hem) it keeps its drape.
 */
function pressUnder(parts: GarmentDrapeResult['parts'], over: GarmentDrapeResult['parts'], body: BodyProxy, core: number): GarmentDrapeResult['parts'] {
  const { offset, field } = standOff(over, body, core, 'nearest'), out: Vec = [0, 0, 0];
  return parts.map(({ part, positions }) => {
    const pressed = Float32Array.from(positions);
    for (let v = 0; v < pressed.length; v += 3) {
      const d = field.distance(pressed[v]!, pressed[v + 1]!, pressed[v + 2]!, out);
      const cover = offset(pressed[v]! - out[0] * d, pressed[v + 1]! - out[1] * d, pressed[v + 2]! - out[2] * d);
      if (!(cover > 0) || d <= cover - LAYER_GAP) continue;
      const to = Math.max(OFFSET, cover - LAYER_GAP);
      for (let axis = 0; axis < 3; axis++) pressed[v + axis] -= out[axis]! * (d - to);
    }
    return { part, positions: pressed };
  });
}

/** Frames, once the body has grown, over which the top underneath thickens the body to its full depth. */
const INNER_FRAMES = 20;
export function innerLayer(surfaces: { positions: Float32Array }[], body: BodyProxy, core: number): InnerLayer {
  const { offset, field } = standOff(surfaces, body, core, 'farthest'), out: Vec = [0, 0, 0];
  return {
    offset,
    clearance(x, y, z) {
      const d = field.distance(x, y, z, out), stand = offset(x - out[0] * d, y - out[1] * d, z - out[2] * d);
      return stand > 0 ? d - stand : null;
    },
  };
}

/**
 * How far a draped garment stands off the body at each place on the body's surface (1.5 cm cells on one grid for every
 * garment, so two garments' cells match): its `farthest` cloth there, for resting another garment on it, or its
 * `nearest`, for pressing a garment under it. Cells between its vertices' places are filled: round a farthest
 * stand-off with the average of the cloth beside them, so one loose fold does not spread; for a nearest one only where
 * there is cloth on both sides, so it never reaches past the garment's edges (an open zip, a hem).
 */
const AROUND: readonly [number, number, number][] = [-1, 0, 1].flatMap(i => [-1, 0, 1].flatMap(j => [-1, 0, 1].map(k => [i, j, k] as [number, number, number]))).filter(([i, j, k]) => i || j || k);
function standOff(surfaces: { positions: Float32Array }[], body: BodyProxy, core: number, which: 'farthest' | 'nearest') {
  const field = bodyField(body, core, INNER_REACH + 4), out: Vec = [0, 0, 0], stand = new Map<string, number>();
  field.scale(1);
  const cellOf = (x: number, y: number, z: number) => `${Math.floor(x / INNER_CELL)},${Math.floor(y / INNER_CELL)},${Math.floor(z / INNER_CELL)}`;
  for (const { positions } of surfaces) for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v]!, y = positions[v + 1]!, z = positions[v + 2]!, d = field.distance(x, y, z, out);
    if (!(d > 0) || d > INNER_REACH) continue;
    const cell = cellOf(x - out[0] * d, y - out[1] * d, z - out[2] * d), now = stand.get(cell);
    stand.set(cell, now === undefined ? d : which === 'farthest' ? Math.max(now, d) : Math.min(now, d));
  }
  const filled = new Map(stand), beside = new Map<string, number[]>();
  for (const [cell, value] of stand) {
    const [ci, cj, ck] = cell.split(',').map(Number) as [number, number, number];
    for (const [di, dj, dk] of AROUND) {
      const key = `${ci + di},${cj + dj},${ck + dk}`;
      if (stand.has(key)) continue;
      if (which === 'farthest') { const values = beside.get(key); if (values) values.push(value); else beside.set(key, [value]); continue; }
      const opposite = stand.get(`${ci + 2 * di},${cj + 2 * dj},${ck + 2 * dk}`);
      if (opposite !== undefined) filled.set(key, Math.min(filled.get(key) ?? Infinity, value, opposite));
    }
  }
  for (const [key, values] of beside) filled.set(key, values.reduce((sum, value) => sum + value, 0) / values.length);
  return { field, offset: (x: number, y: number, z: number) => filled.get(cellOf(x, y, z)) ?? 0 };
}

/**
 * Drapes `meshes` (the product's 3D parts, as teeMesh builds them) on a body of `bodyChest`. Deterministic for the
 * same inputs; `progress` receives completed frames and can return false to stop early.
 */
export function simulateGarment(product: Product, meshes: PartMesh[], bodyChest: number,
  options: { bodyShape?:TopBodyShape; body?: BodyProxy; under?: LayerField; underGap?: number; inner?: InnerLayer; tuck?: number; frames?: number; substeps?: number; progress?: (frame: number, frames: number) => boolean | void } = {}): GarmentDrapeResult {
  const skirt = product.base === 'skirt', trousers = product.base === 'trousers';
  const body = options.body ?? garmentBody(product, bodyChest, options.bodyShape), under = options.under, inner = options.inner, tuck = options.tuck, layerGap = options.underGap ?? LAYER_GAP;
  const cloth = buildCloth(product, meshes);
  const frames = options.frames ?? GARMENT_FRAMES, substeps = options.substeps ?? GARMENT_SUBSTEPS, dt = FRAME / substeps;
  if (!Number.isInteger(frames) || frames <= GROW_FRAMES || frames > 2000 || !Number.isInteger(substeps) || substeps < 1 || substeps > 60) throw new Error('Simulation steps are out of range.');
  const inverseMass = Float32Array.from(cloth.inverseMass), count = inverseMass.length;
  // A skirt's upper edge (its band, or the panels' waist) is held. It starts circular but the body's waist is oval:
  // clear the body before pinning, since held particles cannot be pushed out by contact. Query just below its open
  // top to avoid rounding deciding whether a float32 anchor is inside the torso's vertical range.
  if (skirt) {
    let top = -Infinity;
    for (let i = 0; i < count; i++) top = Math.max(top, cloth.positions[i * 3 + 1]!);
    const field=bodyField(body,body.torso[1]!.y,0),normal:Vec=[0,0,0],held:number[]=[];
    field.scale(1);
    for (let i = 0; i < count; i++) if (cloth.positions[i * 3 + 1]! > top - 1e-6) {
      const k=i*3,distance=field.distance(cloth.positions[k]!,Math.min(top,body.torso[0]!.y-0.0001),cloth.positions[k+2]!,normal),keep=cloth.offset[i]!+0.01;
      if(distance<keep)for(const axis of [0,2])cloth.positions[k+axis]+=normal[axis]!*(keep-distance);
      inverseMass[i] = 0; held.push(i);
    }
    // Over a garment underneath (a tucked top), the held waist grows evenly until all of it clears that garment, so
    // the extra girth is shared round the waist rather than stretching it where the garment underneath is fullest.
    let grow = 1;
    for (const i of held) {
      const k = i * 3, need = under?.radius(cloth.positions[k]!, cloth.positions[k + 1]!, cloth.positions[k + 2]!) ?? 0, radius = Math.hypot(cloth.positions[k]!, cloth.positions[k + 2]!);
      if (need > 0 && radius > 1e-6) grow = Math.max(grow, (need + cloth.offset[i]! - OFFSET + layerGap) / radius);
    }
    if (grow > 1) for (const i of held) { cloth.positions[i * 3] *= grow; cloth.positions[i * 3 + 2] *= grow; }
  }
  // A trouser waistband is held. Once the body has grown, its elastic gathers it from the hip-wide shell onto the
  // body's waist (gathering earlier would fold fabric into the space the body grows into): each band point moves along
  // its direction from the centre line to just outside the waist.
  const gathered = new Map<number, Vec>();
  // A held point is not pushed by contact, so one held over a garment underneath (a tucked top) is placed outside it.
  function clearUnder(at: ArrayLike<number> & { [n: number]: number }, k: number, offset: number) {
    const need = under?.radius(at[k]!, at[k + 1]!, at[k + 2]!) ?? 0, radius = Math.hypot(at[k]!, at[k + 2]!), reach = need + offset - OFFSET + layerGap;
    if (need > 0 && radius > 1e-6 && radius < reach) { at[k] *= reach / radius; at[k + 2] *= reach / radius; }
  }
  if (trousers) {
    const keep = OFFSET + 0.15;
    for (const id of cloth.vertices.get('waistband') ?? []) {
      if (gathered.has(id)) continue;
      // The body's section at this point's height, between the torso sections above and below it.
      const y = cloth.positions[id * 3 + 1]!, below = Math.max(1, body.torso.findIndex(section => section.y <= y)), upper = body.torso[below - 1]!, lower = body.torso[below]!;
      const t = Math.min(1, Math.max(0, (upper.y - y) / (upper.y - lower.y))), halfWidth = upper.halfWidth + (lower.halfWidth - upper.halfWidth) * t, halfDepth = upper.halfDepth + (lower.halfDepth - upper.halfDepth) * t;
      const x = cloth.positions[id * 3]!, z = cloth.positions[id * 3 + 2]!, outside = (t: number) => Math.hypot(Math.max(Math.abs(x * t) - (halfWidth - halfDepth), 0), z * t) - halfDepth >= keep;
      let low = 0, high = 4;
      for (let k = 0; k < 40; k++) { const t = (low + high) / 2; if (outside(t)) high = t; else low = t; }
      const to: Vec = [x * high, cloth.positions[id * 3 + 1]!, z * high];
      clearUnder(to, 0, cloth.offset[id]!);
      gathered.set(id, to);
      inverseMass[id] = 0;
    }
  }
  foldHood(cloth, meshes);
  // How far a top underneath may stand off the body under each particle (see INNER_PRESSED).
  const pressedTo = new Float32Array(count).fill(INNER_PRESSED);
  for (const part of RIB_PARTS) for (const id of cloth.vertices.get(part) ?? []) pressedTo[id] = INNER_PRESSED_RIB;
  // A tucked top's body particles (not those it shares with a sleeve or cuff).
  const tucking = new Uint8Array(count);
  if (tuck !== undefined) {
    for (const part of TUCKED_PARTS) for (const id of cloth.vertices.get(part) ?? []) tucking[id] = 1;
    for (const part of ['sleeveLeft', 'sleeveRight', 'cuffLeft', 'cuffRight'] as const) for (const id of cloth.vertices.get(part) ?? []) tucking[id] = 0;
  }
  const solver = clothSolver(cloth, inverseMass, dt), { positions, previous } = solver;
  // The shell is the cloth stretched over a pillow: while the body grows inside it, every rest length eases from its
  // length on the shell to its flat length, so the fabric shrinks onto the body instead of snapping.
  const { a, b, rest } = solver;
  const shell = Float32Array.from(cloth.rest, (_, n) => {
    const ka = a[n]! * 3, kb = b[n]! * 3;
    return Math.hypot(positions[ka]! - positions[kb]!, positions[ka + 1]! - positions[kb + 1]!, positions[ka + 2]! - positions[kb + 2]!);
  });
  rest.set(shell);
  const core = body.torso[1]!.y, normal: Vec = [0, 0, 0], field = bodyField(body, core, HOOD_OFFSET + 4 + (inner ? INNER_REACH : 0));
  // Where each particle was SETTLE_FRAMES before the end: how far the cloth has moved since says whether it settled.
  const earlier = new Float32Array(positions.length);
  let since = 0;
  for (let frame = 1; frame <= frames; frame++) {
    if (frame === Math.max(1, frames - SETTLE_FRAMES + 1)) { earlier.set(positions); since = frame; }
    // The body grows to full size from inside the garment, then gravity starts.
    const growing = frame <= GROW_FRAMES, scale = growing ? 0.5 + 0.5 * frame / GROW_FRAMES : 1;
    const damping = Math.exp((growing ? -12 : -1.2) * dt), gravity = growing ? 0 : GRAVITY;
    // Once the body has grown, a top underneath thickens it, gradually.
    const layering = inner && !growing ? Math.min(1, (frame - GROW_FRAMES) / INNER_FRAMES) : 0;
    if (frame <= GROW_FRAMES) {
      const t = frame / GROW_FRAMES;
      for (let n = 0; n < rest.length; n++) rest[n] = shell[n]! + (cloth.rest[n]! - shell[n]!) * t;
    }
    if (gathered.size && frame > GROW_FRAMES && frame <= GROW_FRAMES + GATHER_FRAMES) {
      const t = (frame - GROW_FRAMES) / GATHER_FRAMES;
      for (const [id, to] of gathered) for (let axis = 0; axis < 3; axis++) positions[id * 3 + axis] = cloth.positions[id * 3 + axis]! + (to[axis]! - cloth.positions[id * 3 + axis]!) * t;
    }
    field.scale(scale); under?.scale(scale);
    for (let step = 0; step < substeps; step++) {
      // Body contact with friction: sliding along the body is partly removed, then the point is pushed out.
      solver.step(damping, gravity, () => {
        for (let i = 0; i < count; i++) {
          if (inverseMass[i] === 0) continue;
          const k = i * 3, distance = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal);
          let keep = cloth.offset[i]!;
          if (layering) {
            const stand = inner!.offset(positions[k]! - normal[0]! * distance, positions[k + 1]! - normal[1]! * distance, positions[k + 2]! - normal[2]! * distance);
            if (stand > 0) keep += layering * Math.max(0, Math.min(stand, pressedTo[i]!) + LAYER_GAP - OFFSET);
          }
          if (distance >= keep) continue;
          if (!growing) for (let axis = 0; axis < 3; axis++) positions[k + axis] = previous[k + axis]! + (positions[k + axis]! - previous[k + axis]!) * (1 - FRICTION);
          const again = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal);
          if (again < keep) for (let axis = 0; axis < 3; axis++) positions[k + axis] += normal[axis]! * (keep - again);
        }
        // A tucked top: below the waistline, fabric farther from the body than a waistband allows is pressed in, until
        // the band holds it.
        if (tuck !== undefined && !growing && frame <= GROW_FRAMES + GATHER_FRAMES) {
          const ease = Math.max(0, 1 - (frame - GROW_FRAMES) / GATHER_FRAMES) * TUCK_EASE;
          for (let i = 0; i < count; i++) {
            const k = i * 3;
            if (!tucking[i] || inverseMass[i] === 0 || positions[k + 1]! > tuck) continue;
            const distance = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal), most = cloth.offset[i]! + TUCK_GAP + ease;
            if (distance > most) for (let axis = 0; axis < 3; axis++) positions[k + axis] -= normal[axis]! * (distance - most);
          }
        }
        // A garment underneath: the same friction, then the point is pushed out from the body's axis to outside it.
        if (under) for (let i = 0; i < count; i++) {
          if (inverseMass[i] === 0) continue;
          const k = i * 3, need = under.radius(positions[k]!, positions[k + 1]!, positions[k + 2]!);
          if (need <= 0) continue;
          const reach = need + cloth.offset[i]! - OFFSET + layerGap;
          if (Math.hypot(positions[k]!, positions[k + 2]!) >= reach) continue;
          if (!growing) for (const axis of [0, 2]) positions[k + axis] = previous[k + axis]! + (positions[k + axis]! - previous[k + axis]!) * (1 - FRICTION);
          const radius = Math.hypot(positions[k]!, positions[k + 2]!);
          if (radius > 1e-6 && radius < reach) { positions[k] *= reach / radius; positions[k + 2] *= reach / radius; }
        }
      });
    }
    // Once pressed in, the tucked fabric is held by the waistband: squeezed into a thin layer, it has no room to fold
    // and would otherwise never settle. The free part above it settles against it.
    if (tuck !== undefined && frame === GROW_FRAMES + GATHER_FRAMES) {
      for (let i = 0; i < count; i++) if (tucking[i] && positions[i * 3 + 1]! <= tuck) inverseMass[i] = 0;
      // The fabric gathered into the band is at rest there, so it does not push the free fabric above it.
      for (let n = 0; n < rest.length; n++) if (inverseMass[a[n]!] === 0 || inverseMass[b[n]!] === 0) {
        const ka = a[n]! * 3, kb = b[n]! * 3;
        rest[n] = Math.hypot(positions[ka]! - positions[kb]!, positions[ka + 1]! - positions[kb + 1]!, positions[ka + 2]! - positions[kb + 2]!);
      }
    }
    if (options.progress && options.progress(frame, frames) === false) break;
  }
  // Metrics. Settling is the fastest any particle moved on over the last SETTLE_FRAMES: contact can keep single
  // particles trembling in place (as under an open zip hoodie's arm) where nothing is still on its way anywhere.
  let speed = 0;
  for (let k = 0; k < positions.length; k += 3) speed = Math.max(speed, Math.hypot(positions[k]! - earlier[k]!, positions[k + 1]! - earlier[k + 1]!, positions[k + 2]! - earlier[k + 2]!));
  speed /= Math.max(1, frames - since + 1) * FRAME;
  let minClearance = Infinity, touching = 0, maxStrain = 0;
  field.scale(1);
  for (let i = 0; i < count; i++) {
    const distance = field.distance(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!, normal);
    minClearance = Math.min(minClearance, distance);
    if (distance < cloth.offset[i]! + 0.3) touching++;
  }
  for (let n = 0; n < rest.length; n++) {
    if (!cloth.structural[n] || rest[n]! < 1e-6) continue;
    const ka = a[n]! * 3, kb = b[n]! * 3;
    maxStrain = Math.max(maxStrain, Math.hypot(positions[ka]! - positions[kb]!, positions[ka + 1]! - positions[kb + 1]!, positions[ka + 2]! - positions[kb + 2]!) / rest[n]! - 1);
  }
  const parts: GarmentDrapeResult['parts'] = [];
  for (const mesh of meshes) {
    const ids = cloth.vertices.get(mesh.part);
    if (!ids) continue;
    const out = new Float32Array(ids.length * 3);
    ids.forEach((id, v) => { out[v * 3] = positions[id * 3]!; out[v * 3 + 1] = positions[id * 3 + 1]!; out[v * 3 + 2] = positions[id * 3 + 2]!; });
    parts.push({ part: mesh.part, positions: out });
  }
  // Carried overlays: their place on the draped front triangle, lifted along its outward normal.
  for (const mesh of meshes) {
    if (!CARRIED.has(mesh.part)) continue;
    const out = Float32Array.from(mesh.positions);
    for (const item of cloth.carried) {
      if (item.part !== mesh.part) continue;
      const [i, j, k] = item.triangle.map(id => id * 3) as [number, number, number], [w0, w1, w2] = item.weights;
      const ux = positions[j]! - positions[i]!, uy = positions[j + 1]! - positions[i + 1]!, uz = positions[j + 2]! - positions[i + 2]!;
      const vx = positions[k]! - positions[i]!, vy = positions[k + 1]! - positions[i + 1]!, vz = positions[k + 2]! - positions[i + 2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz) || 1;
      // Outward: the side facing away from the body's centre line.
      const cx = positions[i]! * w0 + positions[j]! * w1 + positions[k]! * w2, cz = positions[i + 2]! * w0 + positions[j + 2]! * w1 + positions[k + 2]! * w2;
      const sign = nx * cx + nz * cz >= 0 ? 1 : -1;
      nx *= sign / length; ny *= sign / length; nz *= sign / length;
      out[item.vertex * 3] = cx + nx * item.lift;
      out[item.vertex * 3 + 1] = positions[i + 1]! * w0 + positions[j + 1]! * w1 + positions[k + 1]! * w2 + ny * item.lift;
      out[item.vertex * 3 + 2] = cz + nz * item.lift;
    }
    parts.push({ part: mesh.part, positions: out });
  }
  // Fit: where the hem (the cloth that started lowest) settled, against the body's landmarks.
  const fit: NonNullable<GarmentDrapeMetrics['fit']> = {}, marks = body.landmarks;
  if (marks && !skirt) {
    let lowest = Infinity, sum = 0, hem = 0;
    for (let i = 0; i < count; i++) lowest = Math.min(lowest, cloth.positions[i * 3 + 1]!);
    for (let i = 0; i < count; i++) if (cloth.positions[i * 3 + 1]! < lowest + 0.5) { sum += positions[i * 3 + 1]!; hem++; }
    const hemY = sum / hem;
    if (trousers && marks.floor !== undefined) fit.hemAboveFloor = hemY - marks.floor;
    if (!trousers && marks.hip !== undefined) fit.hemBelowHip = marks.hip - hemY;
    if (marks.sleeveBeyondWrist !== undefined) fit.sleeveBeyondWrist = marks.sleeveBeyondWrist;
  }
  const ease = skirt ? skirtDraft(product).waist - body.waist : trousers ? trouserDimensions(product).waistbandLength - body.hip : topMeasurements(product).chest - body.chest;
  return { parts, body, metrics: { ease, minClearance, contact: touching / count, maxStrain, residualSpeed: speed, ...(Object.keys(fit).length ? { fit } : {}) } };
}

/**
 * A draped garment as seen from the body's vertical axis: for each 1 cm height band and each of 72 directions round
 * the axis, the farthest its surface reaches. `radius` (0 where it has no cloth) is read between bands and directions,
 * on the garment scaled by `scale` about the chest height `core`, as the body grows.
 */
export interface LayerField { scale(s: number): void; radius(x: number, y: number, z: number): number }
const SECTORS = 72;
export function layerField(surfaces: { positions: Float32Array; indices: ArrayLike<number> }[], core: number, fade?: { depth: number; drop: number }): LayerField {
  let low = Infinity, high = -Infinity;
  for (const { positions, indices } of surfaces) for (let t = 0; t < indices.length; t++) { const y = positions[indices[t]! * 3 + 1]!; low = Math.min(low, y); high = Math.max(high, y); }
  if (fade) low -= fade.depth;
  const rows = Math.max(1, Math.round(high - low) + 1), reach = new Float32Array(rows * SECTORS);
  const sectorOf = (x: number, z: number) => Math.atan2(z, x) / (2 * Math.PI) * SECTORS;
  const mark = (x: number, y: number, z: number) => {
    const at = Math.round(y - low) * SECTORS + (Math.round(sectorOf(x, z)) % SECTORS + SECTORS) % SECTORS;
    reach[at] = Math.max(reach[at]!, Math.hypot(x, z));
  };
  // Each triangle is sampled at under 0.5 cm spacing.
  for (const { positions: p, indices } of surfaces) for (let t = 0; t + 2 < indices.length; t += 3) {
    const i = indices[t]! * 3, j = indices[t + 1]! * 3, k = indices[t + 2]! * 3;
    const edge = Math.max(Math.hypot(p[j]! - p[i]!, p[j + 1]! - p[i + 1]!, p[j + 2]! - p[i + 2]!), Math.hypot(p[k]! - p[i]!, p[k + 1]! - p[i + 1]!, p[k + 2]! - p[i + 2]!), Math.hypot(p[k]! - p[j]!, p[k + 1]! - p[j + 1]!, p[k + 2]! - p[j + 2]!));
    const n = Math.max(1, Math.ceil(edge / 0.5));
    for (let u = 0; u <= n; u++) for (let v = 0; u + v <= n; v++) {
      const a = u / n, b = v / n, c = 1 - a - b;
      mark(p[i]! * c + p[j]! * a + p[k]! * b, p[i + 1]! * c + p[j + 1]! * a + p[k + 1]! * b, p[i + 2]! * c + p[j + 2]! * a + p[k + 2]! * b);
    }
  }
  // A direction the sampling missed takes the farther of its neighbours round the axis.
  for (let pass = 0; pass < 2; pass++) {
    const before = Float32Array.from(reach);
    for (let row = 0; row < rows; row++) for (let sector = 0; sector < SECTORS; sector++) {
      const at = row * SECTORS + sector;
      if (!before[at]) reach[at] = Math.max(before[row * SECTORS + (sector + 1) % SECTORS]!, before[row * SECTORS + (sector + SECTORS - 1) % SECTORS]!);
    }
  }
  // With a fade, below its lowest band the reach eases in by `drop` over `depth` cm, so cloth resting on that edge is
  // not pushed out and released by turns as it moves across it.
  if (fade) for (let sector = 0; sector < SECTORS; sector++) {
    let lowest = 0;
    while (lowest < rows && !reach[lowest * SECTORS + sector]) lowest++;
    if (lowest === rows) continue;
    const edge = reach[lowest * SECTORS + sector]!;
    for (let d = 1; d <= lowest; d++) reach[(lowest - d) * SECTORS + sector] = Math.max(0, edge - fade.drop * Math.min(1, d / fade.depth));
  }
  let s = 1;
  return {
    scale(value) { s = value; },
    radius(x, y, z) {
      const row = core + (y - core) / s - low;
      if (row < 0 || row > rows - 1) return 0;
      const r0 = Math.min(rows - 2, Math.floor(row)), fr = rows === 1 ? 0 : row - r0, sector = sectorOf(x, z), s0 = Math.floor(sector), fs = sector - s0;
      const at = (r: number, c: number) => reach[Math.min(rows - 1, Math.max(0, r)) * SECTORS + (c % SECTORS + SECTORS) % SECTORS]!;
      const near = at(r0, s0) * (1 - fs) + at(r0, s0 + 1) * fs, far = at(r0 + 1, s0) * (1 - fs) + at(r0 + 1, s0 + 1) * fs;
      return s * (near * (1 - fr) + far * fr);
    },
  };
}

/** An outfit body's girths: automatic ones the bottoms cannot be worn on take the bottoms' own (a skirt's waist must be
 * smaller than it). */
export function outfitShape(bottoms: Product, chest: number, shape: TopBodyShape = {}) {
  validateBodyChest(chest);
  const own = garmentBody(bottoms, chest, {}), automatic = validateTopBodyShape(chest, { underbust: shape.underbust });
  return validateTopBodyShape(chest, { ...shape, waist: shape.waist ?? Math.min(automatic.waist, own.waist), hip: shape.hip ?? Math.min(automatic.hip, own.hip) });
}

/** The body in an outfit with these girths and height: the top's body down to its waist, the bottoms' below it. */
export function outfitBodies(top: Product, bottoms: Product, chest: number, shape: TopBodyShape = {}) {
  const proportions = outfitShape(bottoms, chest, shape);
  const upper = bodyProxy(top, chest, proportions);
  const lower = bottoms.base === 'skirt' ? skirtBodyProxy(bottoms, proportions) : trouserBodyProxy(bottoms, proportions);
  // The bottoms' waistline sits at the body's waist.
  const waist = upper.landmarks!.waist!, shift = waist - (lower.landmarks?.waist ?? lower.torso[0]!.y);
  const move = (point: Vec): Vec => [point[0], point[1] + shift, point[2]];
  const lowerHip = lower.landmarks?.hip ?? lower.torso[1]!.y, floor = lower.landmarks?.floor;
  const body: BodyProxy = {
    ...upper,
    torso: [...upper.torso.filter(section => section.y > waist + 1e-6), ...lower.torso.map(section => ({ ...section, y: section.y + shift })).filter(section => section.y <= waist + 1e-6)],
    capsules: [...upper.capsules, ...lower.capsules.map(capsule => ({ ...capsule, a: move(capsule.a), b: move(capsule.b) }))],
    ...(lower.bottom === undefined ? {} : { bottom: lower.bottom + shift }),
    landmarks: { ...upper.landmarks, hip: lowerHip + shift, ...(floor === undefined ? {} : { floor: floor + shift }) },
  };
  return { body, lower, shift };
}

/** Whether a top can be tucked into bottoms: a dress cannot. */
export function canTuck(top: Product): boolean { return !isBottoms(top) && topMeasurements(top).length < DRESS_LENGTH; }

/**
 * Drapes `design` worn with `companion`, a top with bottoms or a T-shirt under a sweatshirt or hoodie (see the layers
 * below). Untucked, the bottoms drape first on the outfit's lower body, then the top drapes on the outfit's body over them. `tucked`, the top drapes first, its fabric below the
 * bottoms' waistline pressed close to the body as a waistband holds it, then the bottoms drape outside that part of it.
 * The garment underneath does not feel the other's weight. Positions are in the design's own place, and the
 * companion's are returned beside its own.
 */
export function simulateOutfit(design: Product, designMeshes: PartMesh[], companion: Product, companionMeshes: PartMesh[], bodyChest: number,
  options: { bodyShape?: TopBodyShape; tucked?: boolean; frames?: number; substeps?: number; progress?: (frame: number, frames: number) => boolean | void } = {}): GarmentDrapeResult {
  const frames = options.frames ?? GARMENT_FRAMES, steps = { ...(options.frames ? { frames } : {}), ...(options.substeps ? { substeps: options.substeps } : {}) };
  const report = (offset: number) => (frame: number) => options.progress?.(offset + frame, 2 * frames);
  // A top over another: both on the outer top's body, the one underneath first; the outer one then rests on it as on a
  // thicker body, and the one underneath is pressed in where the outer one covers it closer. The top underneath must
  // be made for the same arm pose (see withSleeveAngle).
  const layers = layerOrder(design, companion);
  if (layers) {
    if (options.tucked) throw new Error('A top worn over another cannot be tucked in.');
    const { inner, outer } = layers, innerMeshes = inner === design ? designMeshes : companionMeshes, outerMeshes = inner === design ? companionMeshes : designMeshes;
    if (sleeveAngleOf(inner) !== sleeveAngleOf(outer)) throw new Error('The top underneath must be made for the outer top’s arm pose.');
    const body = garmentBody(outer, bodyChest, options.bodyShape);
    const under = simulateGarment(inner, innerMeshes, bodyChest, { ...steps, body, progress: report(0) });
    const core = body.torso[1]!.y, over = simulateGarment(outer, outerMeshes, bodyChest, { ...steps, body, inner: innerLayer(under.parts, body, core), progress: report(frames) });
    const pressed = { ...under, parts: pressUnder(under.parts, over.parts, body, core) };
    const [own, other] = inner === design ? [pressed, over] : [over, pressed];
    return { ...own, companion: { parts: other.parts, metrics: other.metrics } };
  }
  if (isBottoms(design) === isBottoms(companion)) throw new Error('An outfit pairs a top with shorts, trousers or a skirt, or a T-shirt under a sweatshirt or hoodie.');
  const designIsTop = !isBottoms(design), top = designIsTop ? design : companion, bottoms = designIsTop ? companion : design;
  if (options.tucked && !canTuck(top)) throw new Error('A dress cannot be tucked in. Shorten it to a top, or wear it untucked.');
  const topMeshes = designIsTop ? designMeshes : companionMeshes, bottomMeshes = designIsTop ? companionMeshes : designMeshes;
  const { body, lower, shift } = outfitBodies(top, bottoms, bodyChest, options.bodyShape);
  let under: GarmentDrapeResult, over: GarmentDrapeResult, placed: GarmentDrapeResult['parts'];
  if (options.tucked) {
    const tuck = body.landmarks!.waist! + TUCK_ABOVE;
    over = simulateGarment(top, topMeshes, bodyChest, { ...steps, body, tuck, progress: report(0) });
    // The tucked part of the top, in the bottoms' place: triangles wholly below the top of the waistband and, in
    // trousers, above the hip. Below it the seat curves in under the body, where pushing the trousers out from the
    // body's axis would fight the legs; the tucked fabric there is pressed to the body, inside the seat's ease.
    const floor = body.bottom === undefined ? -Infinity : body.landmarks!.hip!;
    const surfaces = over.parts.filter(({ part }) => TUCKED_PARTS.includes(part)).map(({ part, positions }) => {
      const indices = topMeshes.find(mesh => mesh.part === part)!.indices, kept: number[] = [];
      for (let t = 0; t + 2 < indices.length; t += 3) if ([0, 1, 2].every(c => { const y = positions[indices[t + c]! * 3 + 1]!; return y <= tuck - TUCK_ABOVE && y >= floor; })) kept.push(indices[t]!, indices[t + 1]!, indices[t + 2]!);
      return { positions: Float32Array.from(positions, (value, i) => i % 3 === 1 ? value - shift : value), indices: kept };
    }).filter(surface => surface.indices.length);
    under = simulateGarment(bottoms, bottomMeshes, bodyChest, { ...steps, body: lower, ...(surfaces.length ? { under: layerField(surfaces, lower.torso[1]!.y, { depth: TUCK_FADE, drop: TUCK_FADE_DROP }), underGap: TUCK_LAYER_GAP } : {}), progress: report(frames) });
    placed = under.parts.map(({ part, positions }) => ({ part, positions: Float32Array.from(positions, (value, i) => i % 3 === 1 ? value + shift : value) }));
  } else {
    under = simulateGarment(bottoms, bottomMeshes, bodyChest, { ...steps, body: lower, progress: report(0) });
    placed = under.parts.map(({ part, positions }) => ({ part, positions: Float32Array.from(positions, (value, i) => i % 3 === 1 ? value + shift : value) }));
    const surfaces = placed.map(({ part, positions }) => ({ positions, indices: bottomMeshes.find(mesh => mesh.part === part)!.indices }));
    over = simulateGarment(top, topMeshes, bodyChest, { ...steps, body, under: layerField(surfaces, body.torso[1]!.y), progress: report(frames) });
  }
  if (designIsTop) return { ...over, companion: { parts: placed, metrics: under.metrics } };
  const back = (parts: GarmentDrapeResult['parts']) => parts.map(({ part, positions }) => ({ part, positions: Float32Array.from(positions, (value, i) => i % 3 === 1 ? value - shift : value) }));
  const moved = (point: Vec): Vec => [point[0], point[1] - shift, point[2]];
  const marks = body.landmarks ?? {};
  const own: BodyProxy = { ...body, torso: body.torso.map(section => ({ ...section, y: section.y - shift })), capsules: body.capsules.map(capsule => ({ ...capsule, a: moved(capsule.a), b: moved(capsule.b) })),
    ...(body.bottom === undefined ? {} : { bottom: body.bottom - shift }),
    landmarks: Object.fromEntries(Object.entries(marks).map(([key, value]) => [key, ['waist', 'hip', 'floor'].includes(key) ? value - shift : value])) };
  return { parts: under.parts, metrics: under.metrics, body: own, companion: { parts: back(over.parts), metrics: over.metrics } };
}
