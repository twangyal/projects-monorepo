import { isBottoms, material, teeDimensions, topMeasurements, type Material, type PartId, type PartMesh, type Product } from './product.ts';

/**
 * Drapes a top on a body: the product's own 3D parts become one cloth, sewn at the seams where they already meet,
 * and an extended position-based (XPBD) solver lets it settle on a body proxy under gravity.
 *
 * - Rest lengths are flat fabric distances: the body, sleeves, cuffs and bands are meshed from the flat silhouette, so
 *   each vertex's x and y are its position on the flat garment. Across a seam (front to back) bending rest lengths are
 *   measured unfolded, so seams do not hold a crease. The neck rib and hood keep their modelled 3D lengths.
 * - The body is a proxy from chest and optional waist/hip girths, with assumed heights/depth/limbs: a torso of stadium-shaped sections,
 *   sloped shoulders, neck, head and arms along the sleeve angle. It grows from inside the garment to full size before
 *   gravity starts, so the cloth starts outside it.
 * - Fabric weight comes from each part's library material (g/m²); stretch and bending from its construction (knits
 *   stretch, twills bend least). These are approximate relative values, not measured fabric data.
 * Units are centimetres, grams and seconds; y is up with the hem at 0, as in the product's 3D view.
 */

const BEHAVIOUR: Record<Material['texture'], { stretch: number; bend: number }> = {
  jersey: { stretch: 0.000008, bend: 0.12 }, slub: { stretch: 0.000008, bend: 0.1 }, rib: { stretch: 0.00003, bend: 0.15 },
  pique: { stretch: 0.000006, bend: 0.25 }, terry: { stretch: 0.000006, bend: 0.5 }, linen: { stretch: 0.000001, bend: 0.8 },
  twill: { stretch: 0.0000005, bend: 2.5 }, canvas: { stretch: 0.0000004, bend: 4 },
};
/** Parts whose shape is modelled in 3D rather than cut from the flat silhouette. */
const MODELLED: ReadonlySet<PartId> = new Set(['neckband', 'hood']);
/** Overlays carried on the front body rather than simulated: [part, height above the front]. */
const CARRIED: ReadonlyMap<PartId, number> = new Map([['pocket', 0.5], ['chestPocket', 0.35]]);

export const BODY_CHEST = [70, 140] as const;
export const BODY_WAIST = [50, 180] as const;
export const BODY_HIP = [50, 220] as const;
export interface TopBodyShape { waist?: number; hip?: number }
export function validateTopBodyShape(chest:number, shape:TopBodyShape = {}):{waist:number;hip:number}{
  validateBodyChest(chest);
  if(!shape||typeof shape!=='object'||Array.isArray(shape))throw new Error('Enter optional body waist and hip measurements.');
  const waist=shape.waist===undefined?chest*.86:shape.waist,hip=shape.hip===undefined?chest*1.02:shape.hip;
  if(typeof waist!=='number'||!Number.isFinite(waist)||waist<BODY_WAIST[0]||waist>BODY_WAIST[1])throw new Error('Body waist must be from 50 to 180 cm, or blank for automatic proportions.');
  if(typeof hip!=='number'||!Number.isFinite(hip)||hip<BODY_HIP[0]||hip>BODY_HIP[1])throw new Error('Body hip must be from 50 to 220 cm, or blank for automatic proportions.');
  return{waist,hip};
}
const GRAVITY = 981;
const OFFSET = 0.35;      // fabric thickness kept from the body, cm
// The hood falls back onto the garment; there is no cloth-to-cloth contact, so it keeps a layer's distance from the
// body instead, lying over the back rather than through it.
const HOOD_OFFSET = 1.1;
const FRICTION = 0.35;    // share of sliding removed while touching the body
const FRAME = 1 / 60;
const GROW_FRAMES = 45;

/** A body a little smaller than the garment: 10 cm less than its chest, within the supported range. */
export function defaultBodyChest(product: Product): number {
  return Math.min(BODY_CHEST[1], Math.max(BODY_CHEST[0], Math.round(topMeasurements(product).chest - 10)));
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
export interface BodyProxy { chest: number; waist: number; hip: number; torso: TorsoSection[]; capsules: Capsule[] }

/** Half-width of a stadium section of circumference c whose depth is `ratio` of its width. */
const stadiumHalfWidth = (c: number, ratio: number) => c / (4 + ratio * (2 * Math.PI - 4));

/** The body proxy for a top, standing so that its shoulders carry the garment's shoulder line. */
export function bodyProxy(product: Product, chest: number, shape:TopBodyShape = {}): BodyProxy {
  const {waist,hip}=validateTopBodyShape(chest,shape);
  const d = teeDimensions(product), top = d.length;
  const depth = 0.7, chestHalf = stadiumHalfWidth(chest, depth), waistHalf = stadiumHalfWidth(waist, depth), hipHalf = stadiumHalfWidth(hip, 0.74);
  const shoulderHalf = chest * 0.235, shoulderRadius = chestHalf * depth * 0.8;
  // The shoulder tops sit just under the garment's shoulder points; the torso section there is the shoulder capsule's.
  const torsoTop = top - d.shoulderDrop - OFFSET - shoulderRadius, armpit = top - d.shoulderDrop - chest * 0.21;
  const torso: TorsoSection[] = [
    { y: torsoTop, halfWidth: shoulderHalf, halfDepth: shoulderRadius },
    { y: armpit, halfWidth: chestHalf, halfDepth: chestHalf * depth },
    { y: top - chest * 0.44, halfWidth: waistHalf, halfDepth: waistHalf * depth },
    { y: top - chest * 0.64, halfWidth: hipHalf, halfDepth: hipHalf * 0.74 },
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
  // the shoulder out past the sleeve opening. They taper to fit inside the sleeves' flat width (front plus back) at the
  // armhole and at the opening, so a narrow sleeve gets a slimmer arm rather than one it cannot contain.
  const shoulderPoint = { x: d.shoulderX, y: top - d.shoulderDrop }, underarm = { x: d.half, y: top - d.shoulderDrop - d.armDepth };
  const middle = { x: (shoulderPoint.x + underarm.x) / 2, y: (shoulderPoint.y + underarm.y) / 2 + 1 };
  const direction = { x: Math.cos(angle), y: -Math.sin(angle) };
  const armholeWidth = Math.abs((underarm.x - shoulderPoint.x) * direction.y - (underarm.y - shoulderPoint.y) * direction.x);
  const upper = Math.min(chest * 0.058, 0.85 * armholeWidth / Math.PI), opening = Math.min(chest * 0.05, upper, 0.85 * d.cuffHalf / Math.PI);
  const wrist = Math.min(chest * 0.03, opening), inside = 3, reach = inside + d.sleeveLength;
  for (const side of [1, -1]) {
    const at = (distance: number): Vec => [side * (middle.x + direction.x * (distance - inside)), middle.y + direction.y * (distance - inside), 0];
    capsules.push({ a: at(0), b: at(reach), radius: upper, end: opening, limb: true });
    capsules.push({ a: at(reach), b: at(Math.max(reach, 62) + 4), radius: opening, end: wrist, limb: true });
  }
  return { chest, waist, hip, torso, capsules };
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
  let scaled = NaN;
  const scale = (s: number) => {
    if (s === scaled) return;
    scaled = s;
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
}

/** Sews the product's parts into one cloth: coincident vertices become one particle. */
export function buildCloth(product: Product, meshes: PartMesh[]): Cloth {
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
  // Each edge: rest length, summed compliance and count (averaged where parts meet), and its opposite vertices.
  const edges = new Map<string, { i: number; j: number; rest: number; stretch: number; bend: number; count: number; opposite: { vertex: number; side: number; modelled: boolean }[] }>();
  for (const mesh of simulated) {
    const ids = vertices.get(mesh.part)!, fabric = material(product.parts[mesh.part].material), behaviour = BEHAVIOUR[fabric.texture], modelled = MODELLED.has(mesh.part);
    // Heavier knits are a little stiffer than the reference 180 g/m² jersey.
    const bend = behaviour.bend * fabric.gsm / 180 * (mesh.part === 'hood' ? 4 : 1);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const tri = [ids[mesh.indices[t]!]!, ids[mesh.indices[t + 1]!]!, ids[mesh.indices[t + 2]!]!];
      if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
      const side = Math.sign(p(tri[0]!, 2) + p(tri[1]!, 2) + p(tri[2]!, 2)) || 1;
      const ux = p(tri[1]!, 0) - p(tri[0]!, 0), uy = p(tri[1]!, 1) - p(tri[0]!, 1), uz = p(tri[1]!, 2) - p(tri[0]!, 2);
      const vx = p(tri[2]!, 0) - p(tri[0]!, 0), vy = p(tri[2]!, 1) - p(tri[0]!, 1), vz = p(tri[2]!, 2) - p(tri[0]!, 2);
      const area = modelled ? Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 : Math.abs(ux * vy - uy * vx) / 2;
      for (const vertex of tri) mass[vertex] += area * fabric.gsm / 10000 / 3;
      for (let e = 0; e < 3; e++) {
        const i = tri[e]!, j = tri[(e + 1) % 3]!, opposite = tri[(e + 2) % 3]!, k = i < j ? `${i},${j}` : `${j},${i}`;
        let edge = edges.get(k);
        if (!edge) { edge = { i: Math.min(i, j), j: Math.max(i, j), rest: modelled ? modelledRest(mesh.part, i, j) : flat(i, j), stretch: 0, bend: 0, count: 0, opposite: [] }; edges.set(k, edge); }
        edge.stretch += behaviour.stretch; edge.bend += bend; edge.count++;
        edge.opposite.push({ vertex: opposite, side, modelled });
      }
    }
  }
  const a: number[] = [], b: number[] = [], rest: number[] = [], compliance: number[] = [], structural: number[] = [];
  const add = (i: number, j: number, length: number, value: number, isStructural: boolean) => { a.push(i); b.push(j); rest.push(length); compliance.push(value); structural.push(isStructural ? 1 : 0); };
  for (const edge of edges.values()) {
    const stretch = edge.stretch / edge.count, bend = edge.bend / edge.count;
    add(edge.i, edge.j, edge.rest, stretch, true);
    if (edge.opposite.length !== 2) continue;
    const [o1, o2] = edge.opposite as [typeof edge.opposite[0], typeof edge.opposite[0]];
    let length: number;
    if (o1.modelled || o2.modelled) length = spatial(o1.vertex, o2.vertex);
    else if (o1.side === o2.side) length = flat(o1.vertex, o2.vertex);
    else {
      // Across a front-to-back seam: the distance with both triangles unfolded flat about the shared edge.
      const ex = p(edge.j, 0) - p(edge.i, 0), ey = p(edge.j, 1) - p(edge.i, 1), span = Math.hypot(ex, ey) || 1;
      const along = (o: number) => ((p(o, 0) - p(edge.i, 0)) * ex + (p(o, 1) - p(edge.i, 1)) * ey) / span;
      const across = (o: number) => Math.abs((p(o, 0) - p(edge.i, 0)) * ey - (p(o, 1) - p(edge.i, 1)) * ex) / span;
      length = Math.hypot(across(o1.vertex) + across(o2.vertex), along(o1.vertex) - along(o2.vertex));
    }
    add(o1.vertex, o2.vertex, length, 1 / (bend * 40), false);
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
  return { offset, positions: Float32Array.from(position), inverseMass, a: Int32Array.from(a), b: Int32Array.from(b), rest: Float32Array.from(rest), compliance: Float32Array.from(compliance), structural: Uint8Array.from(structural), vertices, carried };
}

export interface GarmentDrapeMetrics {
  /** Garment chest minus body chest, cm. */
  ease: number;
  /** Smallest distance from the cloth to the body, cm. */
  minClearance: number;
  /** Share of the cloth resting on the body (within 0.3 cm of the fabric offset). */
  contact: number;
  /** Largest stretch of any seam-to-seam fabric edge relative to its flat length. */
  maxStrain: number;
  /** Fastest point speed at the end, cm/s. */
  residualSpeed: number;
}
export interface GarmentDrapeResult { parts: { part: PartId; positions: Float32Array }[]; metrics: GarmentDrapeMetrics; body: BodyProxy }

/**
 * Drapes `meshes` (the product's 3D parts, as teeMesh builds them) on a body of `bodyChest`. Deterministic for the
 * same inputs; `progress` receives completed frames and can return false to stop early.
 */
export function simulateGarment(product: Product, meshes: PartMesh[], bodyChest: number,
  options: { bodyShape?:TopBodyShape; frames?: number; substeps?: number; progress?: (frame: number, frames: number) => boolean | void } = {}): GarmentDrapeResult {
  if (isBottoms(product)) throw new Error('Draping on a body is available for tops.');
  const body = bodyProxy(product, validateBodyChest(bodyChest),options.bodyShape), cloth = buildCloth(product, meshes);
  const frames = options.frames ?? 240, substeps = options.substeps ?? 10, dt = FRAME / substeps;
  if (!Number.isInteger(frames) || frames <= GROW_FRAMES || frames > 2000 || !Number.isInteger(substeps) || substeps < 1 || substeps > 60) throw new Error('Simulation steps are out of range.');
  const positions = Float32Array.from(cloth.positions), previous = Float32Array.from(positions), velocity = new Float32Array(positions.length);
  const { a, b, inverseMass } = cloth, count = inverseMass.length, lambdas = new Float32Array(cloth.rest.length);
  // The shell is the cloth stretched over a pillow: while the body grows inside it, every rest length eases from its
  // length on the shell to its flat length, so the fabric shrinks onto the body instead of snapping.
  const shell = Float32Array.from(cloth.rest, (_, n) => {
    const ka = a[n]! * 3, kb = b[n]! * 3;
    return Math.hypot(positions[ka]! - positions[kb]!, positions[ka + 1]! - positions[kb + 1]!, positions[ka + 2]! - positions[kb + 2]!);
  });
  const rest = Float32Array.from(shell);
  const alpha = Float32Array.from(cloth.compliance, c => c / (dt * dt));
  const core = body.torso[1]!.y, normal: Vec = [0, 0, 0], field = bodyField(body, core, HOOD_OFFSET + 4);
  let speed = 0;
  for (let frame = 1; frame <= frames; frame++) {
    // The body grows to full size from inside the garment, then gravity starts.
    const growing = frame <= GROW_FRAMES, scale = growing ? 0.5 + 0.5 * frame / GROW_FRAMES : 1;
    const damping = Math.exp((growing ? -12 : -1.2) * dt), gravity = growing ? 0 : GRAVITY;
    if (frame <= GROW_FRAMES) { const t = frame / GROW_FRAMES; for (let n = 0; n < rest.length; n++) rest[n] = shell[n]! + (cloth.rest[n]! - shell[n]!) * t; }
    for (let step = 0; step < substeps; step++) {
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        previous[k] = positions[k]!; previous[k + 1] = positions[k + 1]!; previous[k + 2] = positions[k + 2]!;
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
      // Body contact with friction: sliding along the body is partly removed, then the point is pushed out.
      field.scale(scale);
      for (let i = 0; i < count; i++) {
        const k = i * 3, distance = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal);
        const keep = cloth.offset[i]!;
        if (distance >= keep) continue;
        if (!growing) for (let axis = 0; axis < 3; axis++) positions[k + axis] = previous[k + axis]! + (positions[k + axis]! - previous[k + axis]!) * (1 - FRICTION);
        const again = field.distance(positions[k]!, positions[k + 1]!, positions[k + 2]!, normal);
        if (again < keep) for (let axis = 0; axis < 3; axis++) positions[k + axis] += normal[axis]! * (keep - again);
      }
      speed = 0;
      for (let i = 0; i < count; i++) {
        const k = i * 3;
        velocity[k] = (positions[k]! - previous[k]!) / dt; velocity[k + 1] = (positions[k + 1]! - previous[k + 1]!) / dt; velocity[k + 2] = (positions[k + 2]! - previous[k + 2]!) / dt;
        speed = Math.max(speed, Math.hypot(velocity[k]!, velocity[k + 1]!, velocity[k + 2]!));
      }
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
  return { parts, body, metrics: { ease: topMeasurements(product).chest - body.chest, minClearance, contact: touching / count, maxStrain, residualSpeed: speed } };
}
