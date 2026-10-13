import { validateConstruction, patternGeometry, type SkirtDraft } from './construction.ts';
import { validateBodyMeasurements, type BodyMeasurements } from './body-fitting.ts';

/**
 * Fabric drape of the measured two-panel skirt: an extended position-based (XPBD) cloth solver.
 *
 * Both panels are meshed directly from their flat annular-sector patterns, so every rest length is a
 * real fabric distance. The waist row is held at the waistline; gravity, stretch, shear and bending
 * constraints and contact with a body surface of revolution (from entered measurements) do the
 * rest. Units are centimetres, grams and seconds; +Y points down, as in the rigid shell.
 *
 * Fabric presets use approximate typical weights and relative stiffnesses, not measured fabric data.
 */
export type FabricKind = 'chiffon' | 'cotton' | 'linen' | 'denim';
export interface Fabric { label: string; gsm: number; bend: number; stretch: number }
export const FABRICS: Readonly<Record<FabricKind, Fabric>> = Object.freeze({
  chiffon: { label: 'Chiffon (light, fluid)', gsm: 50, bend: 0.02, stretch: 0.0004 },
  cotton: { label: 'Cotton poplin (medium)', gsm: 120, bend: 0.4, stretch: 0.0002 },
  linen: { label: 'Linen (crisp)', gsm: 190, bend: 1.6, stretch: 0.0001 },
  denim: { label: 'Denim (heavy, stiff)', gsm: 380, bend: 8, stretch: 0.00005 },
});
export const FABRIC_KINDS = Object.keys(FABRICS) as FabricKind[];
export function validateFabric(value: unknown): FabricKind {
  if (typeof value !== 'string' || !Object.hasOwn(FABRICS, value)) throw new Error(`Fabric must be one of ${FABRIC_KINDS.join(', ')}.`);
  return value as FabricKind;
}

export const ROWS = 24;          // Segments along the slant (waist to hem).
export const COLUMNS = 48;       // Segments across each panel; 96 around the skirt.
const GRAVITY = 981;
const THICKNESS = 0.4;           // Contact offset from the body surface, cm.
const FRAME = 1 / 60;

export interface DrapeMetrics {
  /** Mean vertical drop of the hem below the rigid cone's hem, cm. */
  hemDrop: number;
  /** Mean hem radius as a share of the rigid cone's hem radius (1 = fully flared). */
  hemFlare: number;
  /** Number of folds (outward lobes) around the hem. */
  folds: number;
  /** Largest stretch of any structural edge relative to its pattern length. */
  maxStrain: number;
  /** Smallest distance from any skirt point to the body surface, cm (negative = inside). */
  minClearance: number;
  /** Fastest point speed at the end, cm/s (near zero when settled). */
  residualSpeed: number;
}
export interface DrapeResult { rows: number; columns: number; positions: Float32Array; metrics: DrapeMetrics; body: BodyMeasurements; bodyAssumed: boolean }

/** Body proxy used when no measurements are saved: modest ease below the garment waist. */
export function assumedBody(draft: SkirtDraft): BodyMeasurements {
  const waist = Math.min(180, Math.max(50, draft.waist - 2));
  return { waist, hip: Math.min(220, waist + 20), hipDepth: 20 };
}

/** Body radius at depth y: waist above the waistline, linear to the hip, then constant (legs together). */
export function bodyRadius(body: BodyMeasurements, y: number): number {
  const waist = body.waist / (2 * Math.PI), hip = body.hip / (2 * Math.PI);
  if (y <= 0) return waist;
  if (y >= body.hipDepth) return hip;
  return waist + (hip - waist) * y / body.hipDepth;
}

/** Particle index for ring column c (0..2*COLUMNS-1) and row r. */
const index = (r: number, c: number): number => r * 2 * COLUMNS + c;

/** Flat pattern coordinates of a particle, in its own panel's plane (cm). */
function patternPoint(geometry: ReturnType<typeof patternGeometry>, r: number, c: number): [number, number] {
  // `c` counts columns from this panel's first edge; values past COLUMNS continue the same unfolded
  // sector across the side seam, where the identical neighbouring panel joins.
  const local = c;
  const radius = geometry.innerRadius + (geometry.outerRadius - geometry.innerRadius) * r / ROWS;
  const angle = -geometry.angle / 2 + geometry.angle * local / COLUMNS;
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}

interface Constraint { a: number; b: number; rest: number; compliance: number }

/** Distance between two particles measured on their shared panel's flat pattern. */
function restLength(geometry: ReturnType<typeof patternGeometry>, r1: number, c1: number, r2: number, c2: number): number {
  // Columns wrap around the ring; a constraint straddling a side seam is measured in one panel by
  // shifting both columns into the same panel (the seam joins identical edge lengths).
  const total = 2 * COLUMNS;
  let a = c1, b = c2;
  if (Math.abs(a - b) > COLUMNS) { if (a < b) a += total; else b += total; }
  const base = Math.min(a, b) - Math.min(a, b) % COLUMNS;
  const [x1, y1] = patternPoint(geometry, r1, a - base);
  const [x2, y2] = patternPoint(geometry, r2, b - base);
  return Math.hypot(x1 - x2, y1 - y2);
}

function seededJitter(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 - 0.5; };
}

/** The undraped starting surface: the rigid cone assembled from both panels (+ tiny jitter). */
export function initialPositions(draft: SkirtDraft, jitter = 0.05): Float32Array {
  const d = validateConstruction(draft), height = patternGeometry(d).height, total = 2 * COLUMNS;
  const random = seededJitter(20261013), positions = new Float32Array((ROWS + 1) * total * 3);
  for (let r = 0; r <= ROWS; r++) {
    const radius = (d.waist + (d.hem - d.waist) * r / ROWS) / (2 * Math.PI), y = height * r / ROWS;
    for (let c = 0; c < total; c++) {
      const angle = 2 * Math.PI * c / total, k = index(r, c) * 3, wobble = r === 0 ? 0 : jitter;
      positions[k] = radius * Math.cos(angle) + random() * wobble;
      positions[k + 1] = y + random() * wobble;
      positions[k + 2] = radius * Math.sin(angle) + random() * wobble;
    }
  }
  return positions;
}

/** Structural, shear and bending constraints with rest lengths from the flat patterns. */
export function constraints(draft: SkirtDraft, fabric: Fabric): Constraint[] {
  const geometry = patternGeometry(validateConstruction(draft)), total = 2 * COLUMNS, list: Constraint[] = [];
  const add = (r1: number, c1: number, r2: number, c2: number, compliance: number) => {
    if (r2 < 0 || r2 > ROWS) return;
    const w1 = (c1 + total) % total, w2 = (c2 + total) % total;
    list.push({ a: index(r1, w1), b: index(r2, w2), rest: restLength(geometry, r1, w1, r2, w2), compliance });
  };
  const bendCompliance = 1 / (fabric.bend * 40);
  for (let r = 0; r <= ROWS; r++) for (let c = 0; c < total; c++) {
    add(r, c, r, c + 1, fabric.stretch);           // around (weft)
    add(r, c, r + 1, c, fabric.stretch);           // down (warp)
    add(r, c, r + 1, c + 1, fabric.stretch * 4);   // shear
    add(r, c, r + 1, c - 1, fabric.stretch * 4);
    add(r, c, r, c + 2, bendCompliance);           // bending across two segments
    add(r, c, r + 2, c, bendCompliance);
  }
  return list;
}

/** Mass of each particle from the flat area it represents (grams). */
function inverseMasses(draft: SkirtDraft, fabric: Fabric): Float32Array {
  const geometry = patternGeometry(validateConstruction(draft)), total = 2 * COLUMNS, inverse = new Float32Array((ROWS + 1) * total);
  const dr = (geometry.outerRadius - geometry.innerRadius) / ROWS, density = fabric.gsm / 10000;
  for (let r = 0; r <= ROWS; r++) {
    const radius = geometry.innerRadius + dr * r, share = r === 0 || r === ROWS ? 0.5 : 1;
    const area = radius * (geometry.angle / COLUMNS) * dr * share;
    for (let c = 0; c < total; c++) inverse[index(r, c)] = r === 0 ? 0 : 1 / (area * density);
  }
  return inverse;
}

export function drapeMetrics(draft: SkirtDraft, body: BodyMeasurements, positions: Float32Array, velocitySpeed = 0): DrapeMetrics {
  const d = validateConstruction(draft), total = 2 * COLUMNS, geometry = patternGeometry(d), rigidHemRadius = d.hem / (2 * Math.PI);
  let drop = 0, hemRadius = 0, maxStrain = 0, minClearance = Infinity;
  const radii: number[] = [];
  for (let c = 0; c < total; c++) {
    const k = index(ROWS, c) * 3, radius = Math.hypot(positions[k]!, positions[k + 2]!);
    radii.push(radius); hemRadius += radius; drop += positions[k + 1]! - geometry.height;
  }
  hemRadius /= total; drop /= total;
  // Folds: smooth the hem radius slightly and count outward crossings of its mean.
  const smooth = radii.map((_, c) => (radii[(c + total - 1) % total]! + 2 * radii[c]! + radii[(c + 1) % total]!) / 4);
  let crossings = 0;
  for (let c = 0; c < total; c++) if (smooth[c]! < hemRadius && smooth[(c + 1) % total]! >= hemRadius) crossings++;
  for (const constraint of constraints(d, FABRICS.cotton)) {
    if (constraint.compliance > 0.01) continue; // Structural and shear only.
    const a = constraint.a * 3, b = constraint.b * 3;
    const length = Math.hypot(positions[a]! - positions[b]!, positions[a + 1]! - positions[b + 1]!, positions[a + 2]! - positions[b + 2]!);
    maxStrain = Math.max(maxStrain, (length - constraint.rest) / constraint.rest);
  }
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1]!;
    if (y < 0) continue;
    minClearance = Math.min(minClearance, Math.hypot(positions[i]!, positions[i + 2]!) - bodyRadius(body, y));
  }
  return { hemDrop: drop, hemFlare: hemRadius / rigidHemRadius, folds: crossings, maxStrain, minClearance, residualSpeed: velocitySpeed };
}

/**
 * Run the solver. `frames` of 1/60 s, each with `substeps` XPBD substeps; deterministic for the
 * same inputs. `progress` receives completed frames and can return false to stop early.
 */
export function simulateDrape(draft: SkirtDraft, kind: FabricKind, measured?: BodyMeasurements, options: { frames?: number; substeps?: number; progress?: (frame: number, frames: number) => boolean | void } = {}): DrapeResult {
  const d = validateConstruction(draft), fabric = FABRICS[validateFabric(kind)];
  const body = measured ? validateBodyMeasurements(measured) : assumedBody(d);
  const frames = options.frames ?? 240, substeps = options.substeps ?? 12, dt = FRAME / substeps;
  if (!Number.isInteger(frames) || frames < 1 || frames > 2000 || !Number.isInteger(substeps) || substeps < 1 || substeps > 60) throw new Error('Simulation steps are out of range.');
  const positions = initialPositions(d), previous = Float32Array.from(positions), velocity = new Float32Array(positions.length);
  const inverse = inverseMasses(d, fabric), list = constraints(d, fabric), lambdas = new Float32Array(list.length);
  // Flat typed arrays keep the inner loop fast.
  const ca = Int32Array.from(list, c => c.a * 3), cb = Int32Array.from(list, c => c.b * 3);
  const rest = Float32Array.from(list, c => c.rest), compliance = Float32Array.from(list, c => c.compliance / (dt * dt));
  const wA = Float32Array.from(list, c => inverse[c.a]!), wB = Float32Array.from(list, c => inverse[c.b]!);
  const pinned = Float32Array.from(positions.subarray(0, 2 * COLUMNS * 3));
  const damping = Math.exp(-1.5 * dt);
  // Warp length from the waist to each row, along the flat pattern (straight radial lines).
  const tether = new Float32Array(inverse.length), slantPerRow = d.slant / ROWS;
  for (let i = 0; i < inverse.length; i++) tether[i] = Math.floor(i / (2 * COLUMNS)) * slantPerRow * 1.005;
  let speed = 0;
  for (let frame = 1; frame <= frames; frame++) {
    for (let step = 0; step < substeps; step++) {
      for (let i = 0; i < inverse.length; i++) {
        const k = i * 3;
        previous[k] = positions[k]!; previous[k + 1] = positions[k + 1]!; previous[k + 2] = positions[k + 2]!;
        if (inverse[i] === 0) continue;
        velocity[k] *= damping; velocity[k + 1] = velocity[k + 1]! * damping + GRAVITY * dt; velocity[k + 2] *= damping;
        positions[k] += velocity[k]! * dt; positions[k + 1] += velocity[k + 1]! * dt; positions[k + 2] += velocity[k + 2]! * dt;
      }
      lambdas.fill(0);
      for (let n = 0; n < lambdas.length; n++) {
        const wa = wA[n]!, wb = wB[n]!, w = wa + wb;
        if (w === 0) continue;
        const ka = ca[n]!, kb = cb[n]!;
        const dx = positions[ka]! - positions[kb]!, dy = positions[ka + 1]! - positions[kb + 1]!, dz = positions[ka + 2]! - positions[kb + 2]!;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length < 1e-9) continue;
        const alpha = compliance[n]!, delta = (-(length - rest[n]!) - alpha * lambdas[n]!) / (w + alpha);
        lambdas[n] += delta;
        const sx = dx / length * delta, sy = dy / length * delta, sz = dz / length * delta;
        positions[ka] += sx * wa; positions[ka + 1] += sy * wa; positions[ka + 2] += sz * wa;
        positions[kb] -= sx * wb; positions[kb + 1] -= sy * wb; positions[kb + 2] -= sz * wb;
      }
      // Long-range attachments: woven fabric barely stretches along the warp, so no point may hang
      // farther from its waist anchor than the fabric between them allows.
      for (let i = 2 * COLUMNS; i < inverse.length; i++) {
        const k = i * 3, anchor = (i % (2 * COLUMNS)) * 3, limit = tether[i]!;
        const dx = positions[k]! - pinned[anchor]!, dy = positions[k + 1]! - pinned[anchor + 1]!, dz = positions[k + 2]! - pinned[anchor + 2]!;
        const length = Math.hypot(dx, dy, dz);
        if (length > limit) { const scale = limit / length; positions[k] = pinned[anchor]! + dx * scale; positions[k + 1] = pinned[anchor + 1]! + dy * scale; positions[k + 2] = pinned[anchor + 2]! + dz * scale; }
      }
      // Body contact: push points out of the surface of revolution (frictionless).
      for (let i = 0; i < inverse.length; i++) {
        if (inverse[i] === 0) continue;
        const k = i * 3, y = positions[k + 1]!;
        if (y < 0) { positions[k + 1] = 0; continue; } // Fabric cannot rise above the held waistline.
        const radius = Math.hypot(positions[k]!, positions[k + 2]!), minimum = bodyRadius(body, y) + THICKNESS;
        if (radius < minimum) {
          const scale = radius > 1e-6 ? minimum / radius : 1;
          positions[k] = radius > 1e-6 ? positions[k]! * scale : minimum; positions[k + 2] = positions[k + 2]! * scale;
        }
      }
      positions.set(pinned, 0);
      speed = 0;
      for (let i = 0; i < inverse.length; i++) {
        const k = i * 3;
        velocity[k] = (positions[k]! - previous[k]!) / dt; velocity[k + 1] = (positions[k + 1]! - previous[k + 1]!) / dt; velocity[k + 2] = (positions[k + 2]! - previous[k + 2]!) / dt;
        speed = Math.max(speed, Math.hypot(velocity[k]!, velocity[k + 1]!, velocity[k + 2]!));
      }
    }
    if (options.progress && options.progress(frame, frames) === false) break;
  }
  return { rows: ROWS, columns: 2 * COLUMNS, positions, metrics: drapeMetrics(d, body, positions, speed), body, bodyAssumed: !measured };
}

const fmt = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** Shaded, depth-sorted projection of the draped surface (and optionally the body proxy). */
export function drapeSvg(result: DrapeResult, yaw: number, color: string, showBody = true): string {
  if (!Number.isFinite(yaw) || Math.abs(yaw) > 360 || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Drape view settings are invalid.');
  const { positions, rows, columns, body } = result, angle = yaw * Math.PI / 180, tilt = 20 * Math.PI / 180;
  let maxRadius = 0, bottom = 0;
  for (let i = 0; i < positions.length; i += 3) { maxRadius = Math.max(maxRadius, Math.hypot(positions[i]!, positions[i + 2]!)); bottom = Math.max(bottom, positions[i + 1]!); }
  const scale = 300 / Math.max(maxRadius * 2.2, bottom * 1.1), center = bottom / 2;
  const project = (x: number, y: number, z: number) => {
    const rx = x * Math.cos(angle) - z * Math.sin(angle), rz = x * Math.sin(angle) + z * Math.cos(angle), cy = y - center;
    return { x: 240 + rx * scale, y: 180 + (cy * Math.cos(tilt) - rz * Math.sin(tilt)) * scale, depth: cy * Math.sin(tilt) + rz * Math.cos(tilt) };
  };
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  const light = [0.35, -0.55, -0.75], norm = Math.hypot(...light);
  // Layers: back half of the skirt, then the body proxy inside it, then the front half.
  const shapes: { layer: number; depth: number; svg: string }[] = [];
  const at = (r: number, c: number) => (r * columns + ((c % columns) + columns) % columns) * 3;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const corners = [at(r, c), at(r + 1, c), at(r + 1, c + 1), at(r, c + 1)];
    const p = corners.map(k => [positions[k]!, positions[k + 1]!, positions[k + 2]!] as const);
    const u = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]], v = [p[3]![0] - p[1]![0], p[3]![1] - p[1]![1], p[3]![2] - p[1]![2]];
    const normal = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!], length = Math.hypot(...normal) || 1;
    const lambert = Math.abs(normal[0]! * light[0]! + normal[1]! * light[1]! + normal[2]! * light[2]!) / length / norm;
    const shade = 0.45 + 0.55 * lambert;
    const projected = p.map(([x, y, z]) => project(x, y, z));
    const fill = `#${rgb.map(value => Math.round(value * shade).toString(16).padStart(2, '0')).join('')}`;
    const facing = p.reduce((sum, [x, , z]) => sum + x * Math.sin(angle) + z * Math.cos(angle), 0) / 4;
    shapes.push({ layer: facing >= 0 ? 2 : 0, depth: projected.reduce((s, q) => s + q.depth, 0) / 4, svg: `<polygon data-drape-face="${r * columns + c}" points="${projected.map(q => `${fmt(q.x)},${fmt(q.y)}`).join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="0.3"/>` });
  }
  if (showBody) {
    for (let r = 0; r < 12; r++) for (let c = 0; c < 32; c++) {
      const ring = (row: number, col: number) => { const y = bottom * row / 12, radius = bodyRadius(body, y), a = 2 * Math.PI * col / 32; return project(radius * Math.cos(a), y, radius * Math.sin(a)); };
      const q = [ring(r, c), ring(r + 1, c), ring(r + 1, c + 1), ring(r, c + 1)];
      shapes.push({ layer: 1, depth: q.reduce((s, x) => s + x.depth, 0) / 4, svg: `<polygon data-body-face="${r * 32 + c}" points="${q.map(x => `${fmt(x.x)},${fmt(x.y)}`).join(' ')}" fill="#879bad" fill-opacity="0.55" stroke="#364f66" stroke-width="0.3"/>` });
    }
  }
  shapes.sort((a, b) => a.layer - b.layer || a.depth - b.depth);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360" role="img" aria-label="Simulated fabric drape at ${yaw} degrees"><title>Simulated drape on a body proxy (surface of revolution from entered measurements)</title>${shapes.map(s => s.svg).join('')}</svg>`;
}

/** OBJ of the draped surface: centimetres, waist-centre origin, +Y toward the hem. */
export function drapeObj(result: DrapeResult, fabric: FabricKind): string {
  const { positions, rows, columns } = result, coordinate = (v: number) => String(Math.round(v * 1e6) / 1e6);
  const lines = ['# Units: centimetres. Waist-center origin; +Y points toward hem.', `# Simulated drape (XPBD cloth, ${FABRICS[validateFabric(fabric)].label}); approximate fabric preset, not measured fabric data.`, '# Body proxy and fabric thickness are not included.'];
  for (let i = 0; i < positions.length; i += 3) lines.push(`v ${coordinate(positions[i]!)} ${coordinate(positions[i + 1]!)} ${coordinate(positions[i + 2]!)}`);
  const vertex = (r: number, c: number) => r * columns + (c % columns) + 1, half = columns / 2;
  for (const [name, first, last] of [['Front_Panel', 0, half], ['Back_Panel', half, columns]] as const) {
    lines.push(`g ${name}`);
    for (let r = 0; r < rows; r++) for (let c = first; c < last; c++) lines.push(`f ${vertex(r, c)} ${vertex(r + 1, c)} ${vertex(r + 1, c + 1)} ${vertex(r, c + 1)}`);
  }
  return lines.join('\n') + '\n';
}
