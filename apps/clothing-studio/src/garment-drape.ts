import { isBottoms, material, teeDimensions, topMeasurements, trouserDimensions, type Material, type PartId, type PartMesh, type Product } from './product.ts';
import { skirtDraft, skirtHeight } from './product-skirt.ts';

/**
 * Drapes a top on a body: the product's own 3D parts become one cloth, sewn at the seams where they already meet,
 * and an extended position-based (XPBD) solver lets it settle on a body proxy under gravity.
 *
 * - Rest lengths are flat fabric distances: the body, sleeves, cuffs and bands are meshed from the flat silhouette, so
 *   each vertex's x and y are its position on the flat garment. Across a seam (front to back) bending rest lengths are
 *   measured unfolded, so seams do not hold a crease. The neck rib and hood keep their modelled 3D lengths.
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
/** Parts whose shape is modelled in 3D rather than cut from the flat silhouette. */
const MODELLED: ReadonlySet<PartId> = new Set(['neckband', 'hood']);
/** Overlays carried on the front body rather than simulated: [part, height above the front]. */
const CARRIED: ReadonlyMap<PartId, number> = new Map([['pocket', 0.5], ['chestPocket', 0.35]]);

export const BODY_CHEST = [70, 140] as const;
export const BODY_WAIST = [50, 180] as const;
export const BODY_HIP = [50, 220] as const;
export const BODY_CHEST_DEPTH = [10, 44] as const;
export const BODY_HEIGHT = [140, 210] as const;
/** Optional body measurements beyond the chest; omitted ones follow automatic proportions. */
export interface TopBodyShape { waist?: number; hip?: number; chestDepth?: number; height?: number }
/** Body height, if given, sets the body's lengths (arm, torso landmarks, legs) as typical fractions of it. */
export function validateBodyHeight(height: unknown): number | undefined {
  if (height === undefined) return undefined;
  if (typeof height !== 'number' || !Number.isFinite(height) || height < BODY_HEIGHT[0] || height > BODY_HEIGHT[1]) throw new Error(`Body height must be from ${BODY_HEIGHT[0]} to ${BODY_HEIGHT[1]} cm, or blank for automatic proportions.`);
  return height;
}
export function validateTopBodyShape(chest:number, shape:TopBodyShape = {}):TopBodyShape & {waist:number;hip:number}{
  validateBodyChest(chest);
  if(!shape||typeof shape!=='object'||Array.isArray(shape))throw new Error('Enter optional body waist, hip and chest depth measurements.');
  const waist=shape.waist===undefined?chest*.86:shape.waist,hip=shape.hip===undefined?chest*1.02:shape.hip;
  if(typeof waist!=='number'||!Number.isFinite(waist)||waist<BODY_WAIST[0]||waist>BODY_WAIST[1])throw new Error('Body waist must be from 50 to 180 cm, or blank for automatic proportions.');
  if(typeof hip!=='number'||!Number.isFinite(hip)||hip<BODY_HIP[0]||hip>BODY_HIP[1])throw new Error('Body hip must be from 50 to 220 cm, or blank for automatic proportions.');
  const height = validateBodyHeight(shape.height), tall = height === undefined ? {} : { height };
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
const FRICTION = 0.35;    // share of sliding removed while touching the body
export const FRAME = 1 / 60;
// Fabric loses energy as it bends: a damping force proportional to the bending rate, in seconds. Without it stiff
// cloth keeps vibrating at its bending frequency instead of settling.
const BEND_DAMPING = 0.03;
const GROW_FRAMES = 45;
const GATHER_FRAMES = 30;
/** Default solve: 3 s of 1/60 s frames, 24 substeps each, enough for woven fabrics to stay close to their length. */
export const GARMENT_FRAMES = 180;
export const GARMENT_SUBSTEPS = 24;
export const GARMENT_SOLVER = 'xpbd-top-isometric-bending-v2';

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
export function skirtBodyProxy(product: Product, shape: { waist?: number; hip?: number } = {}): BodyProxy {
  const draft = skirtDraft(product), top = skirtHeight(product);
  const waist = shape.waist ?? Math.max(BODY_WAIST[0], draft.waist - 2), hip = shape.hip ?? Math.min(BODY_HIP[1], waist * 1.19);
  if (typeof waist !== 'number' || !Number.isFinite(waist) || waist < BODY_WAIST[0] || waist > BODY_WAIST[1]) throw new Error('Body waist must be from 50 to 180 cm.');
  if (typeof hip !== 'number' || !Number.isFinite(hip) || hip < BODY_HIP[0] || hip > BODY_HIP[1]) throw new Error('Body hip must be from 50 to 220 cm.');
  if (waist > draft.waist - 1) throw new Error(`The body waist must be at least 1 cm smaller than the skirt's ${draft.waist} cm waist.`);
  const waistHalf = stadiumHalfWidth(waist, 0.8), hipHalf = stadiumHalfWidth(hip, 0.75);
  const torso: TorsoSection[] = [
    { y: top, halfWidth: waistHalf, halfDepth: waistHalf * 0.8 },
    { y: top - SKIRT_HIP_DEPTH, halfWidth: hipHalf, halfDepth: hipHalf * 0.75 },
    { y: -60, halfWidth: hipHalf, halfDepth: hipHalf * 0.75 },
  ];
  return { chest: 0, waist, hip, chestDepth: 2 * waistHalf * 0.8, torso, capsules: [] };
}

/**
 * The lower body in shorts or trousers: a stadium-sectioned torso from the waist (the waistband) to the hip and down
 * to the crotch, where it ends, and two straight legs from there to the ankles, apart enough that the inseams pass
 * between them. By default the waist and hip are the ones the trousers were drafted for. The legs keep within the
 * trouser legs' circumference where they are inside them. The waistband is held round the body waist.
 */
export function trouserBodyProxy(product: Product, shape: { waist?: number; hip?: number; height?: number } = {}): BodyProxy {
  const d = trouserDimensions(product), waist = shape.waist ?? d.waist, hip = shape.hip ?? d.hip, height = validateBodyHeight(shape.height);
  if (typeof waist !== 'number' || !Number.isFinite(waist) || waist < BODY_WAIST[0] || waist > BODY_WAIST[1]) throw new Error('Body waist must be from 50 to 180 cm.');
  if (typeof hip !== 'number' || !Number.isFinite(hip) || hip < BODY_HIP[0] || hip > BODY_HIP[1]) throw new Error('Body hip must be from 50 to 220 cm.');
  if (hip > d.waistbandLength - 2) throw new Error(`The body hip must be at least 2 cm smaller than the trousers' ${d.waistbandLength} cm hip.`);
  if (waist > hip) throw new Error('The body waist must not be larger than its hip.');
  const waistHalf = stadiumHalfWidth(waist, 0.8), hipHalf = stadiumHalfWidth(hip, 0.75), top = d.length + d.waistbandHeight;
  // The legs' length (crotch to floor) is 45% of the body's height when it is given, else 80 cm.
  const crotchY = d.inseam + 3.5, legLength = height ? 0.45 * height : 80, kneeY = crotchY - 0.475 * legLength, ankleY = crotchY - 0.925 * legLength;
  // A leg's room at height y: the trouser leg's circumference there (front plus back, linear from crotch to hem).
  const thighRoom = (d.thighHalf + 1) * 2, room = (y: number, own: number) => y <= 0 ? own
    : Math.min(own, 0.9 * (thighRoom + (d.legOpening - thighRoom) * (d.inseam - Math.min(d.inseam, y)) / d.inseam) / (2 * Math.PI) - OFFSET);
  const thigh = room(crotchY - 2, hip * 0.55 / (2 * Math.PI)), knee = Math.min(thigh, room(kneeY, hip * 0.37 / (2 * Math.PI))), ankle = Math.min(knee, room(ankleY, hip * 0.22 / (2 * Math.PI)));
  const legX = thigh + 2;
  // The torso carries on above the waistband, so fabric gathered under the band cannot ride over it.
  const torso: TorsoSection[] = [
    { y: top + 16, halfWidth: waistHalf * 1.06, halfDepth: waistHalf * 0.84 },
    { y: top, halfWidth: waistHalf, halfDepth: waistHalf * 0.8 },
    { y: d.length - d.hipDepth, halfWidth: hipHalf, halfDepth: hipHalf * 0.75 },
    { y: crotchY, halfWidth: Math.max(legX + thigh * 0.8, hipHalf * 0.9), halfDepth: Math.min(hipHalf * 0.75, thigh * 0.9) },
  ];
  const capsules: Capsule[] = [];
  for (const side of [1, -1]) {
    capsules.push({ a: [side * legX, crotchY + thigh * 0.6, 0], b: [side * legX * 0.92, kneeY, 0], radius: thigh, end: knee, limb: true });
    capsules.push({ a: [side * legX * 0.92, kneeY, 0], b: [side * legX * 0.85, ankleY, 0], radius: knee, end: ankle, limb: true });
  }
  return { chest: 0, waist, hip, chestDepth: 2 * waistHalf * 0.8, torso, capsules, bottom: crotchY,
    landmarks: { waist: top, hip: d.length - d.hipDepth, floor: crotchY - legLength, ...(height ? { height } : {}) } };
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
export interface BodyLandmarks { waist?: number; hip?: number; floor?: number; height?: number; sleeveBeyondWrist?: number }
export interface BodyProxy { chest: number; waist: number; hip: number; chestDepth: number; torso: TorsoSection[]; capsules: Capsule[]; bottom?: number; landmarks?: BodyLandmarks }

/** Half-width of a stadium section of circumference c whose depth is `ratio` of its width. */
const stadiumHalfWidth = (c: number, ratio: number) => c / (4 + ratio * (2 * Math.PI - 4));

/** The body proxy for a top, standing so that its shoulders carry the garment's shoulder line. */
export function bodyProxy(product: Product, chest: number, shape:TopBodyShape = {}): BodyProxy {
  const {waist,hip,chestDepth,height}=validateTopBodyShape(chest,shape);
  const d = teeDimensions(product), top = d.length, shoulderLine = top - d.shoulderDrop;
  // Keep the original arithmetic exactly when omitted. Entered depth solves
  // c = 4(w-d) + 2πd for half-width w, where d is the half-depth.
  const chestHalf = chestDepth === undefined ? stadiumHalfWidth(chest, .7) : Math.max(chestDepth / 2, (chest - (Math.PI - 2) * chestDepth) / 4);
  const depth = chestDepth === undefined ? .7 : chestDepth / (2 * chestHalf);
  const waistHalf = stadiumHalfWidth(waist, depth), hipHalf = stadiumHalfWidth(hip, 0.74);
  const shoulderHalf = chest * 0.235, shoulderRadius = chestHalf * depth * 0.8;
  // The shoulder tops sit just under the garment's shoulder points; the torso section there is the shoulder capsule's.
  // Torso depths below the shoulder: typical fractions of the body's height when it is given, else of its chest.
  const torsoTop = top - d.shoulderDrop - OFFSET - shoulderRadius;
  const armpit = height ? shoulderLine - 0.11 * height : top - d.shoulderDrop - chest * 0.21;
  const waistY = height ? shoulderLine - 0.235 * height : top - chest * 0.44, hipY = height ? shoulderLine - 0.335 * height : top - chest * 0.64;
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
    { a: [0, torsoTop, -1.5], b: [0, top + 9, -1.5], radius: chest * 0.4 / (2 * Math.PI), end: chest * 0.4 / (2 * Math.PI), limb: true },
    { a: [0, top + 17.5, -0.5], b: [0, top + 17.5, -0.5], radius: 9.5, end: 9.5, limb: true },
  ];
  // Arms are posed along the sleeves (as a fitting mannequin is posed), slightly above their centre lines, from inside
  // the shoulder to the wrist: a third of the body's height when it is given, else past the sleeve opening. They taper to fit inside the sleeves' flat width (front plus back) at the
  // armhole and at the opening, so a narrow sleeve gets a slimmer arm rather than one it cannot contain.
  const shoulderPoint = { x: d.shoulderX, y: top - d.shoulderDrop }, underarm = { x: d.half, y: top - d.shoulderDrop - d.armDepth };
  const middle = { x: (shoulderPoint.x + underarm.x) / 2, y: (shoulderPoint.y + underarm.y) / 2 + 1 };
  const direction = { x: Math.cos(angle), y: -Math.sin(angle) };
  const armholeWidth = Math.abs((underarm.x - shoulderPoint.x) * direction.y - (underarm.y - shoulderPoint.y) * direction.x);
  const upper = Math.min(chest * 0.058, 0.85 * armholeWidth / Math.PI), opening = Math.min(chest * 0.05, upper, 0.85 * d.cuffHalf / Math.PI);
  const wrist = Math.min(chest * 0.03, opening), inside = 3, reach = inside + d.sleeveLength;
  const armEnd = height ? inside + 0.33 * height : Math.max(reach, 62) + 4;
  for (const side of [1, -1]) {
    const at = (distance: number): Vec => [side * (middle.x + direction.x * (distance - inside)), middle.y + direction.y * (distance - inside), 0];
    // A sleeve longer than the arm hangs past the hand.
    capsules.push({ a: at(0), b: at(Math.min(reach, armEnd)), radius: upper, end: armEnd < reach ? wrist : opening, limb: true });
    if (armEnd > reach) capsules.push({ a: at(reach), b: at(armEnd), radius: opening, end: wrist, limb: true });
  }
  return { chest, waist, hip, chestDepth: chestDepth ?? 2 * chestHalf * depth, torso, capsules,
    landmarks: { waist: waistY, hip: hipY, ...(height ? { height, sleeveBeyondWrist: reach - armEnd } : {}) } };
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
  // A top's body, sleeves and bands are meshed in their flat silhouette (x, y); skirt and trouser panels carry their flat
  // pattern position in their UVs.
  return clothFromMeshes(meshes, part => material(product.parts[part].material), isBottoms(product));
}

/**
 * One cloth from part meshes, each part of the material `materialOf` names: coincident vertices become one particle.
 * Rest shapes are flat fabric coordinates, the vertex's UVs when `flatFromUvs`, otherwise its x and y.
 */
export function clothFromMeshes(meshes: PartMesh[], materialOf: (part: PartId) => Material, flatFromUvs: boolean): Cloth {
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
  // The hood rises from the same neckline: its lengths around the head shrink by the neckline's flat-to-modelled
  // ratio, keeping its height. Its first row is the neck edge (see hoodMesh).
  const hoodMesh = meshes.find(mesh => mesh.part === 'hood'), hoodIds = vertices.get('hood');
  let hoodScale = 1;
  if (hoodMesh && hoodIds) {
    const base: number[] = [];
    for (let v = 0; v < hoodIds.length && Math.abs(hoodMesh.uvs[v * 2 + 1]!) < 1e-9; v++) base.push(hoodIds[v]!);
    let flatLength = 0, modelledLength = 0;
    for (let v = 1; v < base.length; v++) { flatLength += flat(base[v - 1]!, base[v]!); modelledLength += spatial(base[v - 1]!, base[v]!); }
    if (modelledLength > 0) hoodScale = Math.min(1, flatLength / modelledLength);
  }
  const modelledRest = (part: PartId, i: number, j: number) => {
    if (part === 'hood') return Math.hypot(Math.hypot(p(i, 0) - p(j, 0), p(i, 2) - p(j, 2)) * hoodScale, p(i, 1) - p(j, 1));
    if (part !== 'neckband' || !ribAlong.has(i) || !ribAlong.has(j)) return spatial(i, j);
    let along = Math.abs(ribAlong.get(i)! - ribAlong.get(j)!);
    // The ring closes: the last neck point joins the first.
    const total = Math.max(...ribAlong.values()) + flat(ribIds![ribIds!.length - 2]!, ribIds![0]!);
    along = Math.min(along, total - along);
    return Math.hypot(along, ribEdge.has(i) === ribEdge.has(j) ? 0 : ribWidth);
  };
  const mass = new Float64Array(position.length / 3);
  // Flat fabric coordinates of a mesh vertex on its own pattern piece.
  const flatCorner = (mesh: PartMesh, v: number): [number, number] => flatFromUvs
    ? [mesh.uvs[v * 2]!, mesh.uvs[v * 2 + 1]!] : [mesh.positions[v * 3]!, mesh.positions[v * 3 + 1]!];
  type Opposite = { vertex: number; modelled: boolean; edgeI: [number, number]; edgeJ: [number, number]; corner: [number, number] };
  // Each edge: rest length, summed compliance and count (averaged where parts meet), and its opposite vertices with
  // the flat positions of that triangle's corners.
  const edges = new Map<string, { i: number; j: number; rest: number; tensile: number; bend: number; area: number; count: number; opposite: Opposite[] }>();
  for (const mesh of simulated) {
    const ids = vertices.get(mesh.part)!, fabric = materialOf(mesh.part), properties = fabricProperties(fabric), modelled = MODELLED.has(mesh.part);
    // The hood is lined and holds its shape; its modelled 3D form is kept with stiffer bending.
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
export interface GarmentDrapeResult { parts: { part: PartId; positions: Float32Array }[]; metrics: GarmentDrapeMetrics; body: BodyProxy }

/**
 * The extended position-based solver for one cloth with time step `dt`: `inverseMass` (0 holds a particle still) may
 * differ from the cloth's own, and `rest` lengths may be changed between steps. Each `step` integrates bending
 * explicitly, then gravity and damping, then solves the stretch constraints once (XPBD), calls `contact` to correct
 * positions, and returns the fastest particle speed.
 */
export function clothSolver(cloth: Cloth, inverseMass: Float32Array, dt: number) {
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

/**
 * Drapes `meshes` (the product's 3D parts, as teeMesh builds them) on a body of `bodyChest`. Deterministic for the
 * same inputs; `progress` receives completed frames and can return false to stop early.
 */
export function simulateGarment(product: Product, meshes: PartMesh[], bodyChest: number,
  options: { bodyShape?:TopBodyShape; frames?: number; substeps?: number; progress?: (frame: number, frames: number) => boolean | void } = {}): GarmentDrapeResult {
  const skirt = product.base === 'skirt', trousers = product.base === 'trousers';
  const body = garmentBody(product, bodyChest, options.bodyShape);
  const cloth = buildCloth(product, meshes);
  const frames = options.frames ?? GARMENT_FRAMES, substeps = options.substeps ?? GARMENT_SUBSTEPS, dt = FRAME / substeps;
  if (!Number.isInteger(frames) || frames <= GROW_FRAMES || frames > 2000 || !Number.isInteger(substeps) || substeps < 1 || substeps > 60) throw new Error('Simulation steps are out of range.');
  const inverseMass = Float32Array.from(cloth.inverseMass), count = inverseMass.length;
  // A skirt's waist row is held at its waistline, as a waistband would hold it.
  if (skirt) {
    let top = -Infinity;
    for (let i = 0; i < count; i++) top = Math.max(top, cloth.positions[i * 3 + 1]!);
    for (let i = 0; i < count; i++) if (cloth.positions[i * 3 + 1]! > top - 1e-6) inverseMass[i] = 0;
  }
  // A trouser waistband is held. Once the body has grown, its elastic gathers it from the hip-wide shell onto the
  // body's waist (gathering earlier would fold fabric into the space the body grows into): each band point moves along
  // its direction from the centre line to just outside the waist.
  const gathered = new Map<number, Vec>();
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
      gathered.set(id, [x * high, cloth.positions[id * 3 + 1]!, z * high]);
      inverseMass[id] = 0;
    }
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
  const core = body.torso[1]!.y, normal: Vec = [0, 0, 0], field = bodyField(body, core, HOOD_OFFSET + 4);
  let speed = 0;
  for (let frame = 1; frame <= frames; frame++) {
    // The body grows to full size from inside the garment, then gravity starts.
    const growing = frame <= GROW_FRAMES, scale = growing ? 0.5 + 0.5 * frame / GROW_FRAMES : 1;
    const damping = Math.exp((growing ? -12 : -1.2) * dt), gravity = growing ? 0 : GRAVITY;
    if (frame <= GROW_FRAMES) {
      const t = frame / GROW_FRAMES;
      for (let n = 0; n < rest.length; n++) rest[n] = shell[n]! + (cloth.rest[n]! - shell[n]!) * t;
    }
    if (gathered.size && frame > GROW_FRAMES && frame <= GROW_FRAMES + GATHER_FRAMES) {
      const t = (frame - GROW_FRAMES) / GATHER_FRAMES;
      for (const [id, to] of gathered) for (let axis = 0; axis < 3; axis++) positions[id * 3 + axis] = cloth.positions[id * 3 + axis]! + (to[axis]! - cloth.positions[id * 3 + axis]!) * t;
    }
    field.scale(scale);
    for (let step = 0; step < substeps; step++) {
      // Body contact with friction: sliding along the body is partly removed, then the point is pushed out.
      speed = solver.step(damping, gravity, () => {
        for (let i = 0; i < count; i++) {
          if (inverseMass[i] === 0) continue;
          const k = i * 3, distance = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal);
          const keep = cloth.offset[i]!;
          if (distance >= keep) continue;
          if (!growing) for (let axis = 0; axis < 3; axis++) positions[k + axis] = previous[k + axis]! + (positions[k + axis]! - previous[k + axis]!) * (1 - FRICTION);
          const again = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal);
          if (again < keep) for (let axis = 0; axis < 3; axis++) positions[k + axis] += normal[axis]! * (keep - again);
        }
      });
    }
    if (options.progress && options.progress(frame, frames) === false) break;
  }
  // Metrics.
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
