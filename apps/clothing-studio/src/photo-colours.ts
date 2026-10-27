// Colours from a reference photo: its main colours, found by clustering its pixels in CIELAB (where distance follows
// perceived difference), and a colorway that puts them on a garment's parts. Runs on pixels already drawn locally.
import { RIB_PARTS, partsOf, type PartId, type Product } from './product.ts';

export const MAX_PALETTE = 8;
type Lab = [number, number, number];

function toLab(r: number, g: number, b: number): Lab {
  const linear = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = linear(r), G = linear(g), B = linear(b);
  // sRGB to XYZ (D65), relative to the white point.
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function toHex([L, a, b]: Lab): string {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inverse = (t: number) => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const x = inverse(fx) * 0.95047, y = inverse(fy), z = inverse(fz) * 1.08883;
  const gamma = (v: number) => { const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };
  return '#' + [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z]
    .map(v => gamma(v).toString(16).padStart(2, '0')).join('');
}
const distance = (p: Lab, q: Lab) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export function colourDifference(one: string, two: string): number {
  const lab = (hex: string) => toLab(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
  return distance(lab(one), lab(two));
}

/**
 * The main colours of an RGBA image `width` × `height`, most of the picture first, with their shares. Transparent
 * pixels are ignored, and the middle of the picture (where a garment usually is) counts three times as much as its
 * edges. Colours closer than a just-noticeable step (ΔE 10) are one colour; colours under 3% of the picture are left out.
 */
export function photoColours(data: Uint8ClampedArray, width: number, height: number, count = 6): { hex: string; share: number }[] {
  const samples: Lab[] = [], weights: number[] = [];
  const step = Math.max(1, Math.round(Math.sqrt(width * height / 12000)));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const i = (y * width + x) * 4;
    if (data[i + 3]! < 128) continue;
    samples.push(toLab(data[i]!, data[i + 1]!, data[i + 2]!));
    const middle = Math.abs(x / width - 0.5) < 0.3 && Math.abs(y / height - 0.5) < 0.3;
    weights.push(middle ? 3 : 1);
  }
  if (!samples.length) return [];
  // Seeds: the most common coarse colours, each at least ΔE 15 from the seeds before it.
  const bins = new Map<string, { weight: number; at: Lab }>();
  samples.forEach((lab, k) => {
    const key = lab.map(v => Math.round(v / 12)).join();
    const bin = bins.get(key);
    if (bin) bin.weight += weights[k]!; else bins.set(key, { weight: weights[k]!, at: lab });
  });
  const centres: Lab[] = [];
  for (const { at } of [...bins.values()].sort((p, q) => q.weight - p.weight)) {
    if (centres.length >= 10) break;
    if (centres.every(centre => distance(centre, at) >= 15)) centres.push([...at]);
  }
  const owner = new Int32Array(samples.length);
  for (let round = 0; round < 12; round++) {
    samples.forEach((lab, k) => {
      let best = 0;
      for (let c = 1; c < centres.length; c++) if (distance(lab, centres[c]!) < distance(lab, centres[best]!)) best = c;
      owner[k] = best;
    });
    const sums = centres.map(() => [0, 0, 0, 0]);
    samples.forEach((lab, k) => { const s = sums[owner[k]!]!, w = weights[k]!; s[0] += lab[0] * w; s[1] += lab[1] * w; s[2] += lab[2] * w; s[3] += w; });
    sums.forEach((s, c) => { if (s[3]) centres[c] = [s[0]! / s[3], s[1]! / s[3], s[2]! / s[3]]; });
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let clusters = centres.map((at, c) => ({ at, weight: weights.reduce((sum, w, k) => owner[k] === c ? sum + w : sum, 0) })).filter(cluster => cluster.weight > 0);
  // Near-identical clusters merge, weighted by their size.
  clusters.sort((p, q) => q.weight - p.weight);
  const merged: typeof clusters = [];
  for (const cluster of clusters) {
    const near = merged.find(other => distance(other.at, cluster.at) < 10);
    if (!near) { merged.push({ ...cluster }); continue; }
    const w = near.weight + cluster.weight;
    near.at = near.at.map((v, i) => (v * near.weight + cluster.at[i]! * cluster.weight) / w) as Lab; near.weight = w;
  }
  clusters = merged.filter(cluster => cluster.weight / total >= 0.03).sort((p, q) => q.weight - p.weight);
  const seen = new Set<string>();
  return clusters.map(cluster => ({ hex: toHex(cluster.at), share: Math.round(cluster.weight / total * 1000) / 1000 }))
    .filter(({ hex }) => !seen.has(hex) && seen.add(hex)).slice(0, count);
}

const POCKETS: ReadonlySet<PartId> = new Set(['pocket', 'chestPocket']), TRIMS: ReadonlySet<PartId> = new Set([...RIB_PARTS, 'waistband']);
/**
 * A colorway from a palette (most-used colour first): the first colour on the garment's main parts, the next clearly
 * different one (ΔE ≥ 20) on its trims (ribs and waistband) and as the colour of its library prints, and a third on pockets. Fabrics,
 * motifs and uploaded prints stay as they are.
 */
export function paletteColorway(product: Product, palette: readonly string[]): Product['parts'] {
  if (!palette.length) throw new Error('Pick colours from a photo first.');
  const main = palette[0]!;
  const accent = palette.find(colour => colourDifference(colour, main) >= 20) ?? main;
  const third = palette.find(colour => colourDifference(colour, main) >= 20 && colourDifference(colour, accent) >= 20) ?? accent;
  const parts = structuredClone(product.parts);
  for (const id of partsOf(product)) {
    const style = parts[id];
    style.color = TRIMS.has(id) ? accent : POCKETS.has(id) ? third : main;
    if (style.print && !style.print.motif.startsWith('upload:') && accent !== main) style.print.color = TRIMS.has(id) ? main : accent;
  }
  return parts;
}
