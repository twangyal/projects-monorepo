import { clothFromMeshes, clothSolver, FRAME, GARMENT_SUBSTEPS, GRAVITY } from './garment-drape.ts';
import type { Material, PartMesh } from './product.ts';

/**
 * A drape test of a library fabric in the garment solver, after the Cusick drape tester: a 30 cm disc of the fabric is
 * held between two 18 cm discs and the rest hangs under gravity. The drape coefficient is the share of the hanging
 * ring that its shadow still covers, (shadow − support) / (specimen − support): near 0 for a limp fabric that falls
 * straight down, near 1 for a stiff one that stays flat. Units are centimetres; the grain runs along z.
 */
export const SPECIMEN_RADIUS = 15;
export const SUPPORT_RADIUS = 9;
const SPACING = 1.5;
export const DRAPE_TEST_FRAMES = 300;

/**
 * Approximate drape coefficients reported for these constructions in drape-tester studies (Cusick's 30/18 cm
 * geometry), not measurements of the library fabrics. Knits and lightweight cottons hang in deep folds; heavy twills
 * and canvas barely fold.
 */
export const TYPICAL_DRAPE: Record<Material['texture'], readonly [number, number]> = {
  jersey: [0.25, 0.5], slub: [0.25, 0.5], rib: [0.2, 0.45], pique: [0.4, 0.65], terry: [0.45, 0.75],
  linen: [0.4, 0.65], twill: [0.6, 0.85], canvas: [0.75, 0.95], chiffon: [0.15, 0.35], poplin: [0.45, 0.7],
};

type DelaunatorLike = { from(points: number[][]): { triangles: Uint32Array | number[] } };

/** The specimen: rings every 1.5 cm out to the edge (one exactly at the support's rim), triangulated, flat at y = 0. */
export function specimenMesh(Delaunator: DelaunatorLike): PartMesh {
  const points: number[][] = [[0, 0]];
  const radii: number[] = [];
  for (let r = SPACING; r < SUPPORT_RADIUS - SPACING / 2; r += SPACING) radii.push(r);
  radii.push(SUPPORT_RADIUS);
  const rings = Math.round((SPECIMEN_RADIUS - SUPPORT_RADIUS) / SPACING);
  for (let k = 1; k <= rings; k++) radii.push(SUPPORT_RADIUS + (SPECIMEN_RADIUS - SUPPORT_RADIUS) * k / rings);
  radii.forEach((r, ring) => {
    const n = Math.max(6, Math.round(2 * Math.PI * r / SPACING));
    // Alternate rings are turned half a step, so the triangles between them are not long and thin.
    for (let i = 0; i < n; i++) { const angle = 2 * Math.PI * (i + (ring % 2) / 2) / n; points.push([r * Math.cos(angle), r * Math.sin(angle)]); }
  });
  const triangles = Delaunator.from(points).triangles;
  return { part: 'front', positions: points.flatMap(([x, z]) => [x!, 0, z!]), uvs: points.flatMap(([x, z]) => [x!, z!]), indices: Array.from(triangles) };
}

export interface DrapeTestResult {
  coefficient: number;
  /** Folds round the edge (the tester's "nodes"). */
  nodes: number;
  /** The hanging edge seen from above, in angle order: [x, z] in cm. */
  outline: [number, number][];
  residualSpeed: number;
}

/** Drapes the specimen in `fabric`; deterministic. `progress` receives completed frames and can return false to stop. */
export function drapeTest(fabric: Material, Delaunator: DelaunatorLike,
  options: { frames?: number; substeps?: number; progress?: (frame: number, frames: number) => boolean | void } = {}): DrapeTestResult {
  const mesh = specimenMesh(Delaunator), cloth = clothFromMeshes([mesh], () => fabric);
  const frames = options.frames ?? DRAPE_TEST_FRAMES, substeps = options.substeps ?? GARMENT_SUBSTEPS, dt = FRAME / substeps;
  if (!Number.isInteger(frames) || frames < 1 || frames > 2000 || !Number.isInteger(substeps) || substeps < 1 || substeps > 60) throw new Error('Simulation steps are out of range.');
  const inverseMass = Float32Array.from(cloth.inverseMass), count = inverseMass.length, radius = (i: number, p: ArrayLike<number>) => Math.hypot(p[i * 3]!, p[i * 3 + 2]!);
  for (let i = 0; i < count; i++) if (radius(i, cloth.positions) <= SUPPORT_RADIUS + 1e-6) inverseMass[i] = 0;
  const solver = clothSolver(cloth, inverseMass, dt), { positions } = solver;
  // A flat disc held at its centre has no reason to fold one way rather than another: a tiny fixed ripple (a tenth of
  // a millimetre) stands in for the unevenness of a real specimen, so folds form where the fabric itself decides.
  for (let i = 0; i < count; i++) {
    if (inverseMass[i] === 0) continue;
    const angle = Math.atan2(positions[i * 3 + 2]!, positions[i * 3]!);
    positions[i * 3 + 1] = 0.01 * (Math.sin(3 * angle + 1) + Math.sin(7 * angle + 2) + Math.sin(11 * angle));
  }
  solver.previous.set(positions);
  const damping = Math.exp(-1.2 * dt);
  let speed = 0;
  for (let frame = 1; frame <= frames; frame++) {
    for (let step = 0; step < substeps; step++) speed = solver.step(damping, GRAVITY);
    if (options.progress && options.progress(frame, frames) === false) break;
  }
  // The shadow: the specimen's triangles seen from above, rasterized every 2 mm.
  const cell = 0.2, size = Math.ceil(2 * SPECIMEN_RADIUS / cell), covered = new Uint8Array(size * size);
  const ids = cloth.vertices.get('front')!, at = (v: number) => [positions[ids[v]! * 3]!, positions[ids[v]! * 3 + 2]!] as const;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [x0, z0] = at(mesh.indices[t]!), [x1, z1] = at(mesh.indices[t + 1]!), [x2, z2] = at(mesh.indices[t + 2]!);
    const det = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(det) < 1e-12) continue;
    const toCell = (v: number) => Math.floor((v + SPECIMEN_RADIUS) / cell);
    const c0 = Math.max(0, toCell(Math.min(x0, x1, x2))), c1 = Math.min(size - 1, toCell(Math.max(x0, x1, x2)));
    const r0 = Math.max(0, toCell(Math.min(z0, z1, z2))), r1 = Math.min(size - 1, toCell(Math.max(z0, z1, z2)));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const x = (c + 0.5) * cell - SPECIMEN_RADIUS, z = (r + 0.5) * cell - SPECIMEN_RADIUS;
      const w0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / det, w1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / det;
      if (w0 >= -1e-9 && w1 >= -1e-9 && w0 + w1 <= 1 + 1e-9) covered[r * size + c] = 1;
    }
  }
  const shadow = covered.reduce((sum, v) => sum + v, 0) * cell * cell, support = Math.PI * SUPPORT_RADIUS ** 2;
  const coefficient = Math.min(1, Math.max(0, (shadow - support) / (Math.PI * SPECIMEN_RADIUS ** 2 - support)));
  // The edge in angle order (the flat specimen's own angles), and its folds: outward peaks of its distance from the centre.
  const edge: { angle: number; point: [number, number] }[] = [];
  for (let v = 0; v < ids.length; v++) {
    const x = mesh.positions[v * 3]!, z = mesh.positions[v * 3 + 2]!;
    if (Math.hypot(x, z) > SPECIMEN_RADIUS - 1e-6) edge.push({ angle: Math.atan2(z, x), point: [...at(v)] as [number, number] });
  }
  edge.sort((p, q) => p.angle - q.angle);
  const reach = edge.map(e => Math.hypot(...e.point)), n = reach.length;
  // Smoothed over neighbours so that one wobbly point is not a fold; a peak must stand clear of the troughs beside it.
  const smooth = reach.map((_, i) => (reach[(i - 1 + n) % n]! + 2 * reach[i]! + reach[(i + 1) % n]!) / 4);
  let nodes = 0;
  for (let i = 0; i < n; i++) {
    if (!(smooth[i]! > smooth[(i - 1 + n) % n]! && smooth[i]! >= smooth[(i + 1) % n]!)) continue;
    let left = smooth[i]!, right = smooth[i]!;
    for (let k = 1; k < n / 2 && smooth[(i - k + n) % n]! <= smooth[i]!; k++) left = Math.min(left, smooth[(i - k + n) % n]!);
    for (let k = 1; k < n / 2 && smooth[(i + k) % n]! <= smooth[i]!; k++) right = Math.min(right, smooth[(i + k) % n]!);
    if (smooth[i]! - Math.max(left, right) > 0.3) nodes++;
  }
  return { coefficient, nodes, outline: edge.map(e => e.point), residualSpeed: speed };
}
