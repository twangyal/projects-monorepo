// A mannequin surface for the body a garment drapes on: the same torso sections and limbs the cloth collides with,
// blended into one smooth form like a dress form, and drawn just inside the shape the cloth keeps clear of.
import type { BodyProxy } from './garment-drape.ts';

/** How far, cm, the blend between torso and limbs reaches. */
const BLEND = 2.5;
/** The surface is drawn this far inside the collision shape, so blended corners stay under the cloth. */
const INSET = 0.3;

/** The larger of two distances, with the edge where they meet rounded over BLEND (a smooth intersection). */
function roundedMax(a: number, b: number): number {
  const h = Math.max(BLEND - Math.abs(a - b), 0) / BLEND;
  return Math.max(a, b) + h * h * BLEND / 4;
}

/** Signed distance from the mannequin (negative inside), before the inset. */
export function mannequinDistance(body: BodyProxy): (x: number, y: number, z: number) => number {
  // A measured hip may sit below the old display cutoff; keep that real landmark, not the terminal proxy extension.
  const kept = body.torso.filter(section => section.y > -50 || section.y === body.landmarks?.hip);
  const sections = kept.length ? kept : body.torso.slice(0, 1);
  const top = sections[0]!.y;
  // Keep the complete measured hip even below a short skirt's hem; otherwise retain the established display bounds.
  const bottom = body.bottom ?? (body.capsules.length ? sections.at(-1)!.y - 12 : Math.min(-12, (body.landmarks?.hip ?? 0) - 12));
  const section = (y: number) => {
    const at = Math.min(top, Math.max(bottom, y));
    let i = 1;
    while (i < sections.length - 1 && sections[i]!.y > at) i++;
    if (sections.length === 1) return sections[0]!;
    const upper = sections[i - 1]!, lower = sections[i]!;
    const t = upper.y === lower.y ? 0 : Math.min(1, Math.max(0, (upper.y - at) / (upper.y - lower.y)));
    return { halfWidth: upper.halfWidth + (lower.halfWidth - upper.halfWidth) * t, halfDepth: upper.halfDepth + (lower.halfDepth - upper.halfDepth) * t };
  };
  const capsules = body.capsules.map(({ a, b, radius, end }) => {
    const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const, span = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
    return { a, axis, inverse: span ? 1 / span : 0, radius, change: end - radius };
  });
  return (x, y, z) => {
    const { halfWidth, halfDepth } = section(y);
    const q = Math.max(Math.abs(x) - (halfWidth - halfDepth), 0);
    // The torso is a stack of stadium sections, closed at its top and bottom with rounded edges.
    let distance = roundedMax(roundedMax(Math.hypot(q, z) - halfDepth, y - top), bottom - y);
    for (const { a, axis, inverse, radius, change } of capsules) {
      const px = x - a[0], py = y - a[1], pz = z - a[2];
      const t = Math.min(1, Math.max(0, (px * axis[0] + py * axis[1] + pz * axis[2]) * inverse));
      const limb = Math.hypot(px - axis[0] * t, py - axis[1] * t, pz - axis[2] * t) - (radius + change * t);
      // Smooth union: within BLEND of each other the two surfaces round into one.
      const h = Math.max(BLEND - Math.abs(distance - limb), 0) / BLEND;
      distance = Math.min(distance, limb) - h * h * BLEND / 4;
    }
    return distance;
  };
}

/**
 * The surface where `distance` is zero inside the box `low`–`high`, sampled every `step` cm, as triangles (surface
 * nets: one vertex per grid cell the surface crosses, at the mean of its edge crossings, joined across every crossed
 * grid edge). Triangles wind outwards.
 */
export function surfaceNet(distance: (x: number, y: number, z: number) => number, low: readonly number[], high: readonly number[], step: number) {
  const n = [0, 1, 2].map(axis => Math.max(2, Math.ceil((high[axis]! - low[axis]!) / step) + 1)) as [number, number, number];
  const [nx, ny, nz] = n, values = new Float32Array(nx * ny * nz), at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    values[at(i, j, k)] = distance(low[0]! + i * step, low[1]! + j * step, low[2]! + k * step);
  }
  const cell = new Int32Array((nx - 1) * (ny - 1) * nz).fill(-1), cellAt = (i: number, j: number, k: number) => (k * (ny - 1) + j) * (nx - 1) + i;
  const positions: number[] = [], indices: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const;
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  const value = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let inside = 0;
    corners.forEach(([di, dj, dk], c) => { value[c] = values[at(i + di, j + dj, k + dk)]!; if (value[c]! < 0) inside++; });
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, crossings = 0;
    for (const [p, q] of edges) {
      const vp = value[p]!, vq = value[q]!;
      if ((vp < 0) === (vq < 0)) continue;
      const t = vp / (vp - vq), cp = corners[p], cq = corners[q];
      sx += cp[0] + (cq[0] - cp[0]) * t; sy += cp[1] + (cq[1] - cp[1]) * t; sz += cp[2] + (cq[2] - cp[2]) * t; crossings++;
    }
    cell[cellAt(i, j, k)] = positions.length / 3;
    positions.push(low[0]! + (i + sx / crossings) * step, low[1]! + (j + sy / crossings) * step, low[2]! + (k + sz / crossings) * step);
  }
  // Each crossed grid edge joins the four cells around it.
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, b, c, a, c, d); else indices.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = values[at(i, j, k)]!, v1 = values[at(i + 1, j, k)]!;
    if ((v0 < 0) !== (v1 < 0)) quad(cell[cellAt(i, j - 1, k - 1)]!, cell[cellAt(i, j, k - 1)]!, cell[cellAt(i, j, k)]!, cell[cellAt(i, j - 1, k)]!, v0 < 0);
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = values[at(i, j, k)]!, v1 = values[at(i, j + 1, k)]!;
    if ((v0 < 0) !== (v1 < 0)) quad(cell[cellAt(i - 1, j, k - 1)]!, cell[cellAt(i - 1, j, k)]!, cell[cellAt(i, j, k)]!, cell[cellAt(i, j, k - 1)]!, v0 < 0);
  }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = values[at(i, j, k)]!, v1 = values[at(i, j, k + 1)]!;
    if ((v0 < 0) !== (v1 < 0)) quad(cell[cellAt(i - 1, j - 1, k)]!, cell[cellAt(i, j - 1, k)]!, cell[cellAt(i, j, k)]!, cell[cellAt(i - 1, j, k)]!, v0 < 0);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

const made = new Map<string, ReturnType<typeof surfaceNet>>();
/** The mannequin for `body`, cached for the bodies drawn most recently. */
export function mannequinMesh(body: BodyProxy, step = 1.4) {
  const key = JSON.stringify([body.torso, body.capsules, body.bottom ?? null, body.landmarks?.hip ?? null, step]);
  const cached = made.get(key);
  if (cached) return cached;
  const distance = mannequinDistance(body), inset = (x: number, y: number, z: number) => distance(x, y, z) + INSET;
  // The box around every torso section and limb, with a margin.
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  const include = (x: number, y: number, z: number, r: number) => {
    low[0] = Math.min(low[0]!, x - r); low[1] = Math.min(low[1]!, y - r); low[2] = Math.min(low[2]!, z - r);
    high[0] = Math.max(high[0]!, x + r); high[1] = Math.max(high[1]!, y + r); high[2] = Math.max(high[2]!, z + r);
  };
  const sections = body.torso.filter(section => section.y > -50 || section.y === body.landmarks?.hip);
  const bottom = body.bottom ?? (body.capsules.length ? (sections.at(-1) ?? body.torso[0]!).y - 12 : Math.min(-12, (body.landmarks?.hip ?? 0) - 12));
  for (const section of sections.length ? sections : body.torso.slice(0, 1)) { include(0, section.y, 0, section.halfWidth); }
  include(0, bottom, 0, 2);
  for (const capsule of body.capsules) { include(...capsule.a, capsule.radius); include(...capsule.b, capsule.end); }
  const mesh = surfaceNet(inset, low.map(v => v - 3), high.map(v => v + 3), step);
  if (made.size >= 4) made.delete(made.keys().next().value!);
  made.set(key, mesh);
  return mesh;
}
