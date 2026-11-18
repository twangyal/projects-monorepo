import type { PartMesh } from '../../src/product.ts';

type Parts = { part: string; positions: Float32Array }[];

/** How many points of `under` (in `parts`, between heights `low` and `high`, cm) a camera far in front or behind, at
 * height `eye`, sees past the cloth of `over`, stopping just short of each point. */
export function shownThrough(over: Parts, overMeshes: PartMesh[], under: Parts, parts: string[], low: number, high: number, eye: number): number {
  const corners: number[] = [];
  for (const { part, positions } of over) for (const index of overMeshes.find(mesh => mesh.part === part)!.indices) corners.push(positions[index * 3]!, positions[index * 3 + 1]!, positions[index * 3 + 2]!);
  let seen = 0;
  for (const camera of [[0, eye, 300], [0, eye, -300]] as const) for (const { part, positions } of under) {
    if (!parts.includes(part)) continue;
    for (let v = 0; v < positions.length; v += 3) {
      if (positions[v + 1]! < low || positions[v + 1]! > high) continue;
      // Möller–Trumbore along the sight line.
      const dx = positions[v]! - camera[0], dy = positions[v + 1]! - camera[1], dz = positions[v + 2]! - camera[2], length = Math.hypot(dx, dy, dz);
      let hidden = false;
      for (let c = 0; c < corners.length && !hidden; c += 9) {
        const ux = corners[c + 3]! - corners[c]!, uy = corners[c + 4]! - corners[c + 1]!, uz = corners[c + 5]! - corners[c + 2]!;
        const wx = corners[c + 6]! - corners[c]!, wy = corners[c + 7]! - corners[c + 1]!, wz = corners[c + 8]! - corners[c + 2]!;
        const hx = dy * wz - dz * wy, hy = dz * wx - dx * wz, hz = dx * wy - dy * wx, det = ux * hx + uy * hy + uz * hz;
        if (Math.abs(det) < 1e-12) continue;
        const sx = camera[0] - corners[c]!, sy = camera[1] - corners[c + 1]!, sz = camera[2] - corners[c + 2]!, a = (sx * hx + sy * hy + sz * hz) / det;
        if (a < 0 || a > 1) continue;
        const qx = sy * uz - sz * uy, qy = sz * ux - sx * uz, qz = sx * uy - sy * ux, b = (dx * qx + dy * qy + dz * qz) / det;
        if (b < 0 || a + b > 1) continue;
        const t = (wx * qx + wy * qy + wz * qz) / det;
        hidden = t > 0 && t < 1 - 0.1 / length;
      }
      if (!hidden) seen++;
    }
  }
  return seen;
}
