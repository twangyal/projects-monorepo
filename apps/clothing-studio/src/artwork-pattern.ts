// Artwork placements on the pattern pieces: where each print lies on its cut piece, as the 3D view shows it, so that the
// cutting room and the printer can find it. A top's body and sleeves are printed flat as placed, so a print is its own
// rectangle on the piece. On bottoms a print is projected straight on as seen from that side, so its edges are traced
// through the garment's surface onto the flat piece, where they curve as the legs or skirt turn away.
import Delaunator from 'delaunator';
import { ARTWORK_SHOULDER_OFFSET } from './artwork-placement.ts';
import {
  ARTWORK_PART_NAMES, bodiceShift, bottomsArtworkFrame, flare, isBottoms, isSleeveArtwork, optionsOf, panelSize, patternPieces,
  sleeveArtworkFrame, teeMesh, topMeasurements, YOKE_CM, type Artwork, type PartId, type PartMesh, type PatternPiece, type Product,
} from './product.ts';

type Pt = { x: number; y: number };
/** One print on one cut piece, in the piece's pattern coordinates (cm, y down), with its right side up as drawn. */
export interface ArtworkMark {
  part: PartId;
  /** The print's place in the design's artwork list. */
  index: number;
  /** What it is, its size and, on one of a mirrored pair of pieces, which of the pair. */
  label: string;
  /** The print's edges where they lie on the piece: open where the print runs off the piece or over its centre front. */
  lines: Pt[][];
  /** Where to write the label. */
  at: Pt;
  /** On the second of a mirrored pair, cut with the pattern turned over: the lines are where the print lands on that
   * piece, seen through the paper. */
  turned: boolean;
  /** A print laid flat as placed (a top's body or a sleeve), right side up: its centre, size and clockwise turn on the
   * piece, and the part of the piece it can cover, for drawing the image itself. */
  image?: { centre: Pt; width: number; height: number; rotation: number; region: Pt[] };
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
function inside(p: Pt, polygon: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
/** The rectangle's corners from its top left, clockwise, turned clockwise (y down) by `rotation` degrees about its centre. */
function rectangle(centre: Pt, width: number, height: number, rotation: number): Pt[] {
  const angle = rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const x = i! * width / 2, y = j! * height / 2;
    return { x: centre.x + x * cos - y * sin, y: centre.y + x * sin + y * cos };
  });
}
/** The part of the segment where `keep` (a linear function) is not negative, or null. */
function keepWhere(a: Pt, b: Pt, keep: (p: Pt) => number): [Pt, Pt] | null {
  const ka = keep(a), kb = keep(b);
  if (ka < 0 && kb < 0) return null;
  if (ka >= 0 && kb >= 0) return [a, b];
  const t = ka / (ka - kb);
  return ka < 0 ? [lerp(a, b, t), b] : [a, lerp(a, b, t)];
}
/** The parts of the segment inside the polygon. */
function within(a: Pt, b: Pt, polygon: readonly Pt[]): [Pt, Pt][] {
  const cuts = [0, 1], dx = b.x - a.x, dy = b.y - a.y;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!, ex = q.x - p.x, ey = q.y - p.y, d = dx * ey - dy * ex;
    if (Math.abs(d) < 1e-12) continue;
    const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / d, s = ((p.x - a.x) * dy - (p.y - a.y) * dx) / d;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  const out: [Pt, Pt][] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    if (cuts[k + 1]! - cuts[k]! < 1e-9 || !inside(lerp(a, b, (cuts[k]! + cuts[k + 1]!) / 2), polygon)) continue;
    out.push([lerp(a, b, cuts[k]!), lerp(a, b, cuts[k + 1]!)]);
  }
  return out;
}
/** The polygon cut back to where `keep` (a linear function) is not negative. */
function polygonWhere(polygon: readonly Pt[], keep: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!, ka = keep(a), kb = keep(b);
    if (ka >= 0) out.push(a);
    if ((ka < 0) !== (kb < 0)) out.push(lerp(a, b, ka / (ka - kb)));
  }
  return out;
}

/** Segments joined end to end into polylines (closed ones repeat their first point), with straight runs merged. */
export function joinSegments(segments: readonly (readonly [Pt, Pt])[]): Pt[][] {
  const cell = 1e-3, near = 1e-4, grid = new Map<string, number[]>(), points: Pt[] = [];
  const id = (p: Pt) => {
    const i = Math.floor(p.x / cell), j = Math.floor(p.y / cell);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const k of grid.get(`${i + di},${j + dj}`) ?? []) if (Math.hypot(points[k]!.x - p.x, points[k]!.y - p.y) < near) return k;
    }
    points.push(p); grid.set(`${i},${j}`, [...(grid.get(`${i},${j}`) ?? []), points.length - 1]);
    return points.length - 1;
  };
  const edges = segments.map(([a, b]) => [id(a), id(b)] as const).filter(([a, b]) => a !== b), used = edges.map(() => false);
  const at = new Map<number, number[]>();
  edges.forEach(([a, b], e) => { at.set(a, [...(at.get(a) ?? []), e]); at.set(b, [...(at.get(b) ?? []), e]); });
  const walk = (start: number) => {
    const line = [start];
    for (let node = start; ;) {
      const e = at.get(node)!.find(k => !used[k]);
      if (e === undefined) break;
      used[e] = true; node = edges[e]![0] === node ? edges[e]![1] : edges[e]![0]; line.push(node);
    }
    return line;
  };
  const lines: number[][] = [];
  // Open lines start at an end; what is left are closed loops.
  for (const [node, list] of at) if (list.length % 2 === 1 && list.some(k => !used[k])) lines.push(walk(node));
  edges.forEach(([a], e) => { if (!used[e]) lines.push(walk(a)); });
  return lines.map(line => simplify(line.map(k => points[k]!)));
}
/** The polyline without points that lie on the straight line between their neighbours (within 0.01 mm). */
function simplify(line: Pt[]): Pt[] {
  const out = [line[0]!];
  for (let i = 1; i < line.length - 1; i++) {
    const a = out.at(-1)!, b = line[i]!, c = line[i + 1]!, length = Math.hypot(c.x - a.x, c.y - a.y);
    if (length > 1e-9 && Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / length < 1e-3) continue;
    out.push(b);
  }
  out.push(line.at(-1)!);
  return out;
}
function middle(lines: Pt[][]): Pt {
  const all = lines.flat(), xs = all.map(p => p.x), ys = all.map(p => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}
const cm = (value: number) => String(Math.round(value * 10) / 10);

/** Every print's marks on the pattern pieces it lies on, in the order of the design's artwork. */
export function artworkMarks(product: Product): ArtworkMark[] {
  if (!product.artwork.length) return [];
  const pieces = patternPieces(product), marks: ArtworkMark[] = [];
  let meshes: PartMesh[] | null = null;
  product.artwork.forEach((art, index) => {
    const piece = pieces.find(item => item.part === art.part);
    if (!piece) return;
    const height = art.widthCm * art.height / art.width, name = ARTWORK_PART_NAMES[art.part];
    const label = `${name[0]!.toUpperCase()}${name.slice(1)} artwork${art.name ? ` (${art.name})` : ''}, ${cm(art.widthCm)} × ${cm(height)} cm`;
    if (isSleeveArtwork(art.part)) marks.push(...flatMarks(art, index, label, piece, sleeveOrigin(product), false));
    else if (!isBottoms(product)) marks.push(...flatMarks(art, index, label, piece, topOrigin(product, art), piece.cutCount === 2));
    else marks.push(...projectedMarks(product, art, index, label, piece, (meshes ??= teeMesh(product, Delaunator))));
  });
  return marks;
}

/**
 * Where a print's flat coordinates start on its piece. A top's body is flat across from its centre line, down from the
 * neck points, seen from outside, and its piece is the body outline from the side seam (moved left on a dress's bodice,
 * and up below a back yoke). A sleeve's print is placed across from its centre line, down from the shoulder point,
 * seen from outside with the shoulder up: the piece is symmetrical, so it is drawn so on either sleeve.
 */
function topOrigin(product: Product, art: Artwork): { at: Pt; top: number } {
  const centre = flare(product) + panelSize(topMeasurements(product)).width / 2 - bodiceShift(product);
  return { at: { x: centre, y: art.part === 'back' && optionsOf(product).yoke ? -YOKE_CM : 0 }, top: ARTWORK_SHOULDER_OFFSET };
}
function sleeveOrigin(product: Product): { at: Pt; top: number } { return { at: { x: sleeveArtworkFrame(product).centre, y: 0 }, top: 0 }; }

/**
 * A print laid flat on its piece: a rectangle, cut back to the piece. A front cut as a mirrored pair (a button, zip or
 * lapel front) is drawn as the wearer's right front: the print's part on the wearer's left front is drawn where it lands
 * when the pattern is turned over to cut that piece.
 */
function flatMarks(art: Artwork, index: number, label: string, piece: PatternPiece, origin: { at: Pt; top: number }, pair: boolean): ArtworkMark[] {
  const height = art.widthCm * art.height / art.width, rotation = art.rotation ?? 0, centre = { x: art.xCm, y: origin.top + art.yCm + height / 2 };
  const corners = rectangle(centre, art.widthCm, height, rotation), outline = piece.outline;
  const sides = pair
    ? [{ keep: (p: Pt) => -p.x, turned: false, who: 'wearer’s right front' }, { keep: (p: Pt) => p.x, turned: true, who: 'wearer’s left front' }]
    : [{ keep: () => 0, turned: false, who: '' }];
  const marks: ArtworkMark[] = [];
  for (const side of sides) {
    const onPiece = (p: Pt): Pt => ({ x: side.turned ? origin.at.x - p.x : origin.at.x + p.x, y: origin.at.y + p.y });
    const segments: [Pt, Pt][] = [];
    corners.forEach((corner, i) => {
      const kept = keepWhere(corner, corners[(i + 1) % 4]!, side.keep);
      if (kept) segments.push(...within(onPiece(kept[0]), onPiece(kept[1]), outline));
    });
    const middleAt = onPiece(centre), covers = side.keep(centre) >= 0 && inside(middleAt, outline);
    if (!segments.length && !covers) continue;
    const lines = joinSegments(segments);
    marks.push({
      part: piece.part, index, label: side.who ? `${label}, ${side.who}${side.turned ? ', pattern turned over' : ''}` : label, lines,
      at: covers ? middleAt : middle(lines), turned: side.turned,
      ...(side.turned ? {} : { image: { centre: middleAt, width: art.widthCm, height, rotation, region: pair ? polygonWhere(outline, p => origin.at.x - p.x) : outline } }),
    });
  }
  return marks;
}

/**
 * Where a print laid flat (on a top's body or a sleeve) goes when its image is put down with its centre at `centre` on
 * its piece, as drawn right side up (pattern cm): the placement the artwork fields give, to the millimetre. It is the
 * inverse of how `flatMarks` draws the image.
 */
export function placementOnPattern(product: Product, index: number, centre: Pt): { xCm: number; yCm: number } {
  const art = product.artwork[index];
  if (!art || isBottoms(product)) throw new Error('Only a print laid flat on a top or a sleeve can be moved on the pattern.');
  const height = art.widthCm * art.height / art.width, origin = isSleeveArtwork(art.part) ? sleeveOrigin(product) : topOrigin(product, art);
  const round = (value: number) => Math.round(value * 10) / 10;
  return { xCm: round(centre.x - origin.at.x), yCm: round(centre.y - origin.at.y - origin.top - height / 2) };
}

/** How far the decal reaches in front of and behind its centre, as in 3D (see Product3D.addDecal). */
const DECAL_DEPTH = 30;
/**
 * A print on bottoms, projected straight onto its side's part as the 3D view does (three.js DecalGeometry: a box the
 * print's size, centred where a ray through its centre first meets the part, reaching 15 cm either way), and its edges
 * traced onto the flat piece through the part's surface. Each leg is a piece of its own: the pattern is drawn as one
 * leg, right side up, and the other leg is cut with it turned over.
 */
function projectedMarks(product: Product, art: Artwork, index: number, label: string, piece: PatternPiece, meshes: PartMesh[]): ArtworkMark[] {
  const mesh = meshes.find(item => item.part === art.part);
  if (!mesh) return [];
  const front = art.part === 'front', height = art.widthCm * art.height / art.width, P = mesh.positions, U = mesh.uvs, I = mesh.indices;
  const x = front ? art.xCm : -art.xCm, y = bottomsArtworkFrame(product).top - art.yCm - height / 2;
  // The decal's centre: the first point of the part on a ray straight through the print's centre from outside.
  let hit: { z: number; uv: Pt; side: number } | null = null;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t]! * 3, I[t + 1]! * 3, I[t + 2]! * 3];
    const d = (P[b + 1]! - P[c + 1]!) * (P[a]! - P[c]!) + (P[c]! - P[b]!) * (P[a + 1]! - P[c + 1]!);
    if (Math.abs(d) < 1e-12) continue;
    const wa = ((P[b + 1]! - P[c + 1]!) * (x - P[c]!) + (P[c]! - P[b]!) * (y - P[c + 1]!)) / d;
    const wb = ((P[c + 1]! - P[a + 1]!) * (x - P[c]!) + (P[a]! - P[c]!) * (y - P[c + 1]!)) / d, wc = 1 - wa - wb;
    if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) continue;
    const z = wa * P[a + 2]! + wb * P[b + 2]! + wc * P[c + 2]!;
    if (hit && (front ? z <= hit.z : z >= hit.z)) continue;
    const [ua, ub, uc] = [I[t]! * 2, I[t + 1]! * 2, I[t + 2]! * 2];
    hit = { z, uv: { x: wa * U[ua]! + wb * U[ub]! + wc * U[uc]!, y: wa * U[ua + 1]! + wb * U[ub + 1]! + wc * U[uc + 1]! }, side: (P[a]! + P[b]! + P[c]!) < 0 ? 0 : 1 };
  }
  if (!hit) return [];
  // Each vertex's distance inside the box's six faces (negative outside), in the decal's own axes: three.js turns it by
  // the Euler angles (0, 0 in front or π behind, −rotation), so that the print reads left to right from outside.
  const angle = -(art.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle), n = P.length / 3, inset = new Float64Array(n * 6);
  for (let v = 0; v < n; v++) {
    const dx = P[v * 3]! - x, dy = P[v * 3 + 1]! - y, dz = P[v * 3 + 2]! - hit.z;
    const lx = front ? cos * dx + sin * dy : -cos * dx + sin * dy, ly = front ? -sin * dx + cos * dy : sin * dx + cos * dy, lz = front ? dz : -dz;
    inset.set([art.widthCm / 2 - lx, art.widthCm / 2 + lx, height / 2 - ly, height / 2 + ly, DECAL_DEPTH / 2 - lz, DECAL_DEPTH / 2 + lz], v * 6);
  }
  // Mesh flat coordinates are the pieces' own, from where each piece starts (a jeans back below its yoke starts lower).
  const xs = Array.from({ length: n }, (_, v) => U[v * 2]!), ys = Array.from({ length: n }, (_, v) => U[v * 2 + 1]!);
  const shift = { x: Math.min(...piece.outline.map(p => p.x)) - Math.min(...xs), y: Math.min(...piece.outline.map(p => p.y)) - Math.min(...ys) };
  const pair = piece.cutCount === 2, sideOf = (t: number) => (pair && P[I[t]! * 3]! + P[I[t + 1]! * 3]! + P[I[t + 2]! * 3]! >= 0 ? 1 : 0);
  // Whether a leg's flat x runs the way the viewer's right does (it is drawn right side up) or against it (turned over).
  const lean = [0, 0];
  for (let t = 0; t < I.length; t += 3) for (const v of [I[t]!, I[t + 1]!]) {
    const w = I[t + 2]!;
    lean[sideOf(t)]! += (U[v * 2]! - U[w * 2]!) * (P[v * 3]! - P[w * 3]!) * (front ? 1 : -1);
  }
  const segments: [Pt, Pt][][] = [[], []];
  const corner = (lo: number, hi: number, face: number) => {
    const t = inset[lo * 6 + face]! / (inset[lo * 6 + face]! - inset[hi * 6 + face]!);
    return { uv: { x: U[lo * 2]! + (U[hi * 2]! - U[lo * 2]!) * t, y: U[lo * 2 + 1]! + (U[hi * 2 + 1]! - U[lo * 2 + 1]!) * t },
      inset: Array.from({ length: 6 }, (_, k) => inset[lo * 6 + k]! + (inset[hi * 6 + k]! - inset[lo * 6 + k]!) * t) };
  };
  for (let t = 0; t < I.length; t += 3) {
    const tri = [I[t]!, I[t + 1]!, I[t + 2]!];
    // A pleat's underlays, a layer or more in, lie hidden under its outer layer (its folded edges are half a layer in).
    if (mesh.layers && tri.some(v => mesh.layers![v]! >= 1)) continue;
    if (Array.from({ length: 6 }, (_, k) => k).some(k => tri.every(v => inset[v * 6 + k]! < 0))) continue;
    for (let face = 0; face < 6; face++) {
      const crossing = [[0, 1], [1, 2], [2, 0]].map(([i, j]) => [tri[i!]!, tri[j!]!] as const)
        .filter(([a, b]) => (inset[a * 6 + face]! < 0) !== (inset[b * 6 + face]! < 0))
        .map(([a, b]) => (a < b ? corner(a, b, face) : corner(b, a, face)));
      if (crossing.length !== 2) continue;
      // Along the face's line across the triangle, keep what lies inside the box's other faces.
      let from = 0, to = 1;
      for (let k = 0; k < 6 && from < to; k++) {
        if (k === face) continue;
        const g0 = crossing[0]!.inset[k]!, g1 = crossing[1]!.inset[k]!;
        if (g0 < 0 && g1 < 0) to = from;
        else if (g0 < 0) from = Math.max(from, g0 / (g0 - g1));
        else if (g1 < 0) to = Math.min(to, g0 / (g0 - g1));
      }
      if (to - from < 1e-9) continue;
      const [a, b] = [crossing[0]!.uv, crossing[1]!.uv];
      segments[sideOf(t)]!.push([lerp(a, b, from), lerp(a, b, to)].map(p => ({ x: p.x + shift.x, y: p.y + shift.y })) as [Pt, Pt]);
    }
  }
  const leg = ['wearer’s right leg', 'wearer’s left leg'];
  return [0, 1].flatMap(side => {
    if (!segments[side]!.length) return [];
    const lines = joinSegments(segments[side]!), turned = pair && lean[side]! < 0;
    const at = hit.side === side || !pair ? { x: hit.uv.x + shift.x, y: hit.uv.y + shift.y } : middle(lines);
    return [{ part: piece.part, index, label: pair ? `${label}, ${leg[side]}${turned ? ', pattern turned over' : ''}` : label, lines, at, turned }];
  });
}
