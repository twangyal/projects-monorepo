/**
 * Local color reading for wardrobe photos: separate the garment from its background, find its main
 * colors, suggest a palette tag and describe how pieces' colors relate. Deterministic rules on
 * measured pixels; no learned recognition, and every result is a suggestion the person can ignore.
 */
import type { Palette } from './types.ts';

export interface Lab { l: number; a: number; b: number }
export interface ReadColor { hex: string; name: string; share: number; lab: Lab }
export interface GarmentColors { colors: ReadColor[]; garmentShare: number; palette: Palette; reason: string }

const SIDE = 96, BORDER = 4, BACKGROUND_DISTANCE = 14, MIN_GARMENT_SHARE = 0.03, MIN_CLUSTER_SHARE = 0.08;
// Colors closer than this (CIELAB ΔE) are one color under noise, shading or compression.
const DISTINCT_COLOR = 20;

function linear(channel: number): number { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function toLab(r: number, g: number, b: number): Lab {
  const R = linear(r), G = linear(g), B = linear(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}
function fromLab({ l, a, b }: Lab): [number, number, number] {
  const fy = (l + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inverse = (t: number) => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const x = inverse(fx) * 0.95047, y = inverse(fy), z = inverse(fz) * 1.08883;
  const gamma = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return [gamma(3.2406 * x - 1.5372 * y - 0.4986 * z), gamma(-0.9689 * x + 1.8758 * y + 0.0415 * z), gamma(0.0557 * x - 0.2040 * y + 1.0570 * z)];
}
const distance = (p: Lab, q: Lab) => Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
export const chroma = (c: Lab) => Math.hypot(c.a, c.b);
export const hue = (c: Lab) => (Math.atan2(c.b, c.a) * 180 / Math.PI + 360) % 360;
const hex = (rgb: [number, number, number]) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

// A small reference set for readable explanations; names are approximate by design.
const NAMED: [string, string][] = [
  ['black', '#1c1c1c'], ['charcoal', '#3d3d3f'], ['grey', '#8a8a8a'], ['light grey', '#c8c8c8'], ['white', '#f5f5f2'], ['cream', '#efe6cf'],
  ['beige', '#d6c4a0'], ['tan', '#b58b5a'], ['brown', '#6b4428'], ['burgundy', '#6e1f2e'], ['red', '#c62a2a'], ['coral', '#ec7a63'],
  ['orange', '#e8822a'], ['mustard', '#cfa22c'], ['yellow', '#f0d43a'], ['olive', '#6f6b2e'], ['green', '#3d8b3d'], ['forest green', '#24472f'],
  ['teal', '#22777a'], ['light blue', '#9cc3e4'], ['blue', '#2f62c4'], ['navy', '#1f2a4f'], ['purple', '#6b3f8f'], ['lavender', '#b9a6d9'],
  ['pink', '#e89ab6'], ['magenta', '#c2347e'],
];
const NAMED_LAB = NAMED.map(([name, value]) => [name, toLab(parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16))] as const);
export function colorName(lab: Lab): string {
  let best = NAMED_LAB[0];
  for (const entry of NAMED_LAB) if (distance(entry[1], lab) < distance(best[1], lab)) best = entry;
  return best[0];
}

/** Palette tag rules: low chroma is neutral; vivid mid-lightness is bright; otherwise warm or cool by hue. */
export function paletteFor(color: Lab): { palette: Palette; why: string } {
  const c = chroma(color), h = hue(color);
  if (c < 12) return { palette: 'neutral', why: 'very low color saturation' };
  if (c > 50 && color.l > 35 && color.l < 88) return { palette: 'bright', why: 'high saturation at medium lightness' };
  const warm = h >= 345 || h < 105;
  return { palette: warm ? 'warm' : 'cool', why: `${warm ? 'red-to-yellow' : 'green-to-blue-to-violet'} hue` };
}

/** Read a garment photo given as RGBA pixels (any size; sampled on a 96×96 grid). */
export function readGarmentColors(rgba: ArrayLike<number>, width: number, height: number): GarmentColors | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || rgba.length !== width * height * 4) throw new Error('Photo pixels have unexpected dimensions.');
  const samples: Lab[] = [], border: Lab[] = [];
  for (let gy = 0; gy < SIDE; gy++) for (let gx = 0; gx < SIDE; gx++) {
    const x = Math.min(width - 1, Math.floor((gx + 0.5) * width / SIDE)), y = Math.min(height - 1, Math.floor((gy + 0.5) * height / SIDE)), i = (y * width + x) * 4;
    if (rgba[i + 3] < 128) continue;
    const lab = toLab(rgba[i], rgba[i + 1], rgba[i + 2]);
    samples.push(lab);
    if (gx < BORDER || gy < BORDER || gx >= SIDE - BORDER || gy >= SIDE - BORDER) border.push(lab);
  }
  if (!samples.length) return null;
  // The background is the typical border color (per-channel median), which also covers the white padding added to photos.
  const median = (values: number[]) => values.sort((p, q) => p - q)[Math.floor(values.length / 2)];
  const background = { l: median(border.map(c => c.l)), a: median(border.map(c => c.a)), b: median(border.map(c => c.b)) };
  const garment = samples.filter(c => distance(c, background) > BACKGROUND_DISTANCE);
  const garmentShare = garment.length / samples.length;
  if (garmentShare < MIN_GARMENT_SHARE) return null;
  // Deterministic k-means (k ≤ 3) with farthest-point initialization.
  const centres: Lab[] = [garment.reduce((acc, c) => ({ l: acc.l + c.l / garment.length, a: acc.a + c.a / garment.length, b: acc.b + c.b / garment.length }), { l: 0, a: 0, b: 0 })];
  while (centres.length < 3) {
    let far = garment[0], farDistance = -1;
    for (const c of garment) { const d = Math.min(...centres.map(centre => distance(c, centre))); if (d > farDistance) { far = c; farDistance = d; } }
    if (farDistance < DISTINCT_COLOR) break;
    centres.push({ ...far });
  }
  let assignment = new Array<number>(garment.length).fill(0);
  for (let iteration = 0; iteration < 12; iteration++) {
    assignment = garment.map(c => { let best = 0; centres.forEach((centre, k) => { if (distance(c, centre) < distance(c, centres[best])) best = k; }); return best; });
    centres.forEach((_, k) => {
      const members = garment.filter((_, i) => assignment[i] === k);
      if (members.length) centres[k] = { l: members.reduce((s, c) => s + c.l, 0) / members.length, a: members.reduce((s, c) => s + c.a, 0) / members.length, b: members.reduce((s, c) => s + c.b, 0) / members.length };
    });
  }
  let clusters = centres.map((lab, k) => ({ lab, share: assignment.filter(a => a === k).length / garment.length }));
  // Merge clusters that converged close together, weighting by share.
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < clusters.length && !merged; i++) for (let j = i + 1; j < clusters.length && !merged; j++) {
      if (distance(clusters[i].lab, clusters[j].lab) >= DISTINCT_COLOR) continue;
      const p = clusters[i], q = clusters[j], share = p.share + q.share, w = share ? p.share / share : 0.5;
      clusters[i] = { share, lab: { l: p.lab.l * w + q.lab.l * (1 - w), a: p.lab.a * w + q.lab.a * (1 - w), b: p.lab.b * w + q.lab.b * (1 - w) } };
      clusters = clusters.filter((_, k) => k !== j); merged = true;
    }
  }
  const kept = clusters.filter(entry => entry.share >= MIN_CLUSTER_SHARE), total = kept.reduce((sum, entry) => sum + entry.share, 0);
  const colors = kept.map(entry => ({ ...entry, share: entry.share / total })).sort((p, q) => q.share - p.share)
    .map(({ lab, share }) => ({ lab, share, hex: hex(fromLab(lab)), name: colorName(lab) }));
  const main = colors[0], { palette, why } = paletteFor(main.lab);
  const reason = `Main color ${main.name} (${Math.round(main.share * 100)}% of the piece): ${why}.`;
  return { colors, garmentShare, palette, reason };
}

/** Plain-language notes on how the main colors of an outfit's pieces relate. Rules, not taste. */
export function colorHarmony(pieces: readonly { label: string; colors: GarmentColors | null }[]): string[] {
  const read = pieces.filter((piece): piece is { label: string; colors: GarmentColors } => piece.colors !== null);
  const notes: string[] = [];
  if (read.length < 2) return ['Add photos to at least two pieces to compare their actual colors.'];
  const main = read.map(piece => ({ label: piece.label, color: piece.colors.colors[0] }));
  const accents = main.filter(item => chroma(item.color.lab) >= 15);
  if (!accents.length) notes.push('An all-neutral outfit: the pieces differ in lightness rather than color.');
  else if (accents.length === 1) notes.push(`One color accent (${accents[0].label}, ${accents[0].color.name}) against neutral pieces.`);
  for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) {
    const p = main[i], q = main[j], dl = Math.abs(p.color.lab.l - q.color.lab.l);
    const contrast = dl > 40 ? 'strong light–dark contrast' : dl < 12 ? 'similar lightness (tonal)' : 'moderate lightness contrast';
    let relation = '';
    if (chroma(p.color.lab) >= 15 && chroma(q.color.lab) >= 15) {
      const dh = Math.abs(hue(p.color.lab) - hue(q.color.lab)), gap = Math.min(dh, 360 - dh);
      // Complementary pairs (blue/orange, red/green, violet/yellow) sit roughly 140–180° apart in CIELAB hue.
      relation = gap < 30 ? '; analogous hues' : gap >= 140 ? '; complementary hues' : '; contrasting hues';
    } else relation = '; a neutral anchors the pair';
    notes.push(`${p.label} (${p.color.name}) and ${q.label} (${q.color.name}): ${contrast}${relation}.`);
  }
  if (read.length < pieces.length) notes.push(`${pieces.length - read.length} piece${pieces.length - read.length > 1 ? 's have' : ' has'} no readable photo and ${pieces.length - read.length > 1 ? 'are' : 'is'} not compared.`);
  return notes;
}
