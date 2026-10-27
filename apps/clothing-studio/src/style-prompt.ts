// "Describe a style": a local, deterministic interpreter from a short description ("navy breton stripe on
// heavyweight ecru jersey") to a part style. It knows a fashion colour vocabulary, the fabric library, the motif
// library, repeat sizes and layouts, and reports what it understood and which words it ignored. Nothing it was not
// told about changes. No network and no model: the same words always give the same style.
import { SURVEY_COLORS } from './colour-names.ts';
import { LAYOUTS, MATERIALS, MOTIFS, LIMITS, type Layout, type Motif, type PartStyle, type Print } from './product.ts';

const COLORS: Record<string, string> = {
  white: '#f7f7f4', 'off white': '#f2efe6', ivory: '#f4efe1', cream: '#f1e8d0', ecru: '#efe8d8', oatmeal: '#ddd3c0', stone: '#cfc6b6',
  sand: '#d8c7a6', beige: '#d9c8aa', khaki: '#b8a77c', camel: '#c19a6b', tan: '#b48a5e', brown: '#7a5236', chocolate: '#4e3427',
  black: '#1c1c1e', charcoal: '#36383b', graphite: '#4a4c50', grey: '#8d9093', gray: '#8d9093', 'heather grey': '#b7b4ad', 'heather gray': '#b7b4ad', silver: '#c4c6c8',
  red: '#b23a2e', 'cherry red': '#a51f2b', scarlet: '#c62c2c', burgundy: '#6d1f2c', wine: '#6a2333', maroon: '#5c1f24', rust: '#a4502a', terracotta: '#c0643f', brick: '#9c4a3a',
  coral: '#e57a62', salmon: '#ec9a84', peach: '#f2bfa0', orange: '#e0782f', tangerine: '#ef8a33', apricot: '#f0b27a',
  pink: '#e7a2b5', 'hot pink': '#e04f8c', blush: '#efc9c3', rose: '#d47a8a', fuchsia: '#c2337a', magenta: '#b5307a',
  lilac: '#c4b0d6', lavender: '#b9a9d9', purple: '#6d4a8f', plum: '#6b3a5e', violet: '#7b5ba6', mauve: '#a7869a',
  yellow: '#f0cd4b', lemon: '#f3e27a', mustard: '#d1a72f', gold: '#c99a33', butter: '#f5e3a1', ochre: '#c58f2b',
  green: '#4f8a4c', 'forest green': '#2f4f38', 'bottle green': '#24443a', emerald: '#2e7d5b', olive: '#6b6b3a', sage: '#9fae91', mint: '#b4dcc4',
  teal: '#2b7a78', turquoise: '#3ab0b0', aqua: '#7fd1cf',
  blue: '#3d6fb6', navy: '#1f2a4f', 'navy blue': '#1f2a4f', 'royal blue': '#2c4fa3', cobalt: '#2448a0', 'sky blue': '#8cbbe3', 'baby blue': '#b7d4ee',
  'powder blue': '#b9cfe2', denim: '#46628a', indigo: '#2d3f5c', 'slate blue': '#5a6f8d', 'steel blue': '#4f6f8f', petrol: '#2f5866',
};
// The fashion names above, then names from a colour survey; longer names are matched before shorter ones ("navy blue"
// before "navy", "heather grey" before "grey").
const NAMED: Record<string, string> = { ...SURVEY_COLORS, ...COLORS };

const MATERIAL_WORDS: [RegExp, string][] = [
  [/\b(heavy ?weight|heavy|thick|boxy)\b[^,;]*\bjersey\b|\bheavyweight\b/, 'jersey-240'],
  [/\bslub\b|\bvintage jersey\b/, 'slub-160'],
  [/\b(rib|ribbed|ribbing)\b/, 'rib-220'],
  [/\b(pique|piqué|polo)\b/, 'pique-200'],
  [/\b(terry|french terry|fleece|sweatshirt fabric|loopback)\b/, 'terry-300'],
  [/\b(linen|flax)\b/, 'linen-170'],
  [/\b(denim|twill|chambray|jean)\b/, 'denim-340'],
  [/\b(jersey|cotton|t-?shirt fabric)\b/, 'jersey-180'],
];
const MOTIF_WORDS: [RegExp, Motif][] = [
  [/\b(stripes?|striped|breton|pinstripes?|pin-stripes?|marini[eè]re)\b/, 'stripe'],
  [/\b(dots?|dotted|polka|spots?|spotted)\b/, 'dots'],
  [/\b(gingham|checks?|checked|checkered|chequered|plaid|tartan)\b/, 'gingham'],
  [/\b(floral|flowers?|flowery|ditsy|botanical|blossoms?)\b/, 'floral'],
  [/\b(geometric|triangles?|triangular|abstract|geo)\b/, 'triangles'],
  // "Ocean" alone is a colour ("ocean blue"); it is a print only as "ocean print" or "ocean waves".
  [/\b(waves?|wavy|ripples?|scallops?)\b|\bocean (?:print|pattern|waves?)\b/, 'waves'],
];
const LAYOUT_WORDS: [RegExp, Layout][] = [
  [/\bhalf[- ]?drop\b/, 'half-drop'], [/\bhalf[- ]?brick\b|\bbrick (?:repeat|layout)\b/, 'half-brick'], [/\bmirror(ed)?\b|\bmirror repeat\b/, 'mirror'], [/\b(grid|standard|straight) repeat\b|\bstandard\b/, 'grid'],
];
const SCALE_WORDS: [RegExp, number][] = [
  [/\b(tiny|micro|mini)\b/, 2], [/\b(pin|fine|thin|small|little|ditsy|narrow)\b/, 3], [/\b(medium|mid|regular)\b/, 6],
  [/\b(large|big|bold|wide)\b/, 10], [/\b(huge|oversized|giant|jumbo)\b/, 16],
];
// Modifiers move lightness part of the way toward light (or dark) and scale saturation, so a light colour is not
// pushed to white: `light` is the fraction of the remaining distance to 0.92 lightness (negative darkens toward 0).
const MODIFIERS: Record<string, { light: number; sat: number }> = {
  light: { light: 0.4, sat: 1 }, pale: { light: 0.55, sat: 0.75 }, pastel: { light: 0.45, sat: 0.6 }, soft: { light: 0.2, sat: 0.85 },
  dark: { light: -0.3, sat: 1 }, deep: { light: -0.2, sat: 1.1 }, muted: { light: 0, sat: 0.6 }, dusty: { light: 0.1, sat: 0.6 },
  washed: { light: 0.2, sat: 0.7 }, faded: { light: 0.3, sat: 0.65 }, bright: { light: 0.05, sat: 1.25 }, vivid: { light: 0, sat: 1.35 }, neon: { light: 0.1, sat: 1.6 },
};
// Words that carry no style information and are not reported as ignored.
const FILLER = new Set(['a', 'an', 'the', 'and', 'with', 'in', 'of', 'on', 'for', 'print', 'printed', 'pattern', 'patterned', 'fabric', 'colour', 'color', 'colored', 'coloured',
  'ground', 'background', 'base', 'repeat', 'all', 'over', 'allover', 'tee', 'shirt', 't-shirt', 'top', 'style', 'make', 'it', 'please', 'cm', 'in', 'look', 'like', 'some', 'very']);

// One pattern per name, an optional modifier just before it.
const COLOR_PATTERNS = Object.keys(NAMED).sort((a, b) => b.length - a.length)
  .map(name => [name, new RegExp(`(?:\\b(${Object.keys(MODIFIERS).join('|')})\\s+)?\\b${name}\\b`, 'g')] as const);

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1)), h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map(v => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
function modify(hex: string, modifier: string | undefined): string {
  if (!modifier) return hex;
  const { light, sat } = MODIFIERS[modifier], [h, s, l] = hexToHsl(hex);
  return hslToHex(h, clamp(s * sat), clamp(light >= 0 ? l + (0.92 - l) * light : l * (1 + light), 0.06, 0.95));
}

export interface StyleReading { style: PartStyle; understood: string[]; ignored: string[] }

/**
 * Reads a style description on top of `current`. Colours: with a motif, a colour written as "X on Y" or nearest the
 * motif ("navy stripe") is the print colour and the other the ground; without a motif the first colour is the ground.
 */
export function readStylePrompt(prompt: string, current: PartStyle, { allowUnapplied = false }: { allowUnapplied?: boolean } = {}): StyleReading {
  // Accents are folded ("piqué" reads as "pique"), because regular-expression word boundaries are ASCII.
  const text = prompt.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) throw new Error('Describe a fabric, colours or a print, for example "navy breton stripe on heavyweight ecru jersey".');
  const understood: string[] = [], used: [number, number][] = [];
  const claim = (match: RegExpExecArray | null) => { if (match) used.push([match.index, match.index + match[0].length]); return match; };

  // Colours, with their position and an optional modifier word just before.
  const colors: { hex: string; at: number; end: number; label: string }[] = [];
  let rest = text;
  for (const [name, pattern] of COLOR_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(rest))) {
      colors.push({ hex: modify(NAMED[name], match[1]), at: match.index, end: match.index + match[0].length, label: match[0] });
      rest = rest.slice(0, match.index) + ' '.repeat(match[0].length) + rest.slice(match.index + match[0].length);
    }
  }
  colors.sort((a, b) => a.at - b.at);
  const hexColor = /#([0-9a-f]{6})\b/g;
  for (let match; (match = hexColor.exec(text));) { colors.push({ hex: `#${match[1]}`, at: match.index, end: match.index + match[0].length, label: match[0] }); }
  colors.sort((a, b) => a.at - b.at);

  let material = current.material;
  for (const [pattern, id] of MATERIAL_WORDS) {
    const match = pattern.exec(text);
    if (match) {
      material = id; understood.push(`fabric: ${MATERIALS.find(m => m.id === id)!.name}`);
      // The heavyweight rule spans prose between the weight and jersey. Only its fabric words apply.
      const words = id === 'jersey-240' ? /\b(heavy ?weight|heavy|thick|boxy|jersey)\b/g : new RegExp(pattern.source, 'g');
      for (const more of text.matchAll(words)) claim(more);
      break;
    }
  }
  // "fleece" or "denim" may also be read as a colour word elsewhere; fabric words are claimed first.
  let motif: Motif | null = null, motifAt = -1;
  for (const [pattern, id] of MOTIF_WORDS) {
    const match = claim(pattern.exec(text));
    if (match) {
      motif = id; motifAt = match.index; understood.push(`print: ${id === 'triangles' ? 'geometric triangles' : id}`);
      // "breton stripe" names one motif twice.
      for (const more of text.matchAll(new RegExp(pattern.source, 'g'))) used.push([more.index!, more.index! + more[0].length]);
      break;
    }
  }
  const plain = /\b(plain|solid|no print|without (a )?print)\b/.exec(text);
  if (plain && !motif) { claim(plain); understood.push('no print'); }

  const stripe = motif === 'stripe' || (!motif && !plain && current.print?.motif === 'stripe');
  const directions = stripe ? [...text.matchAll(/\b(horizontal|vertical)\b/g)] : [];
  if (new Set(directions.map(match => match[1])).size > 1) throw new Error('Specify one stripe direction: horizontal or vertical.');
  for (const match of directions) claim(match);
  const direction = directions[0]?.[1] as Print['direction'];
  if (direction) understood.push(`stripe direction: ${direction}`);

  const hasPrint = !!motif || (!plain && !!current.print);
  let layout: Layout | null = null;
  if (hasPrint) for (const [pattern, id] of LAYOUT_WORDS) { const match = claim(pattern.exec(text)); if (match) { layout = id; understood.push(`repeat: ${id}`); break; } }
  let scale: number | null = null;
  const explicit = hasPrint ? claim(/(\d+(?:\.\d+)?)\s*(cm|mm)\b/.exec(text)) : null;
  if (explicit) scale = Number(explicit[1]) / (explicit[2] === 'mm' ? 10 : 1);
  else if (hasPrint) for (const [pattern, size] of SCALE_WORDS) { const match = claim(pattern.exec(text)); if (match) { scale = size; break; } }
  if (scale !== null) { scale = Math.min(LIMITS.scaleCm[1], Math.max(LIMITS.scaleCm[0], scale)); understood.push(`repeat size: ${scale} cm`); }

  // Only consume colours assigned to a supported role. A known colour next to an unsupported
  // construction detail is still unapplied; it must not recolour the fabric or print by accident.
  const candidates = colors.filter(c => !/^\s+(topstitch(?:ing)?|stitch(?:es|ing)?|seams?|buttons?|zips?|zippers?|piping|embroidery|lining)\b/.test(text.slice(c.end)));
  let groundColor: typeof colors[number] | undefined, inkColor: typeof colors[number] | undefined;
  const on = /\bon (?:an? )?(?:[a-z]+ )?$/;
  if (motif && candidates.length) {
    const onColor = candidates.find(c => on.test(text.slice(Math.max(0, c.at - 30), c.at)));
    if (onColor) { groundColor = onColor; inkColor = candidates.find(c => c !== onColor); }
    else if (candidates.length === 1) inkColor = candidates[0];
    else {
      inkColor = [...candidates].sort((a, b) => Math.abs(a.at - motifAt) - Math.abs(b.at - motifAt))[0];
      groundColor = candidates.find(c => c !== inkColor);
    }
  } else groundColor = candidates[0];
  for (const [color, role] of [[groundColor, 'colour'], [inkColor, 'print colour']] as const) {
    if (color) { used.push([color.at, color.end]); understood.push(`${role}: ${color.label}`); }
  }
  const ground = groundColor?.hex, ink = inkColor?.hex;

  const style: PartStyle = { material, color: ground ?? current.color, print: current.print };
  if (plain && !motif) style.print = null;
  else if (motif || (current.print && (ink || layout || scale !== null || direction))) {
    const base: Print = current.print ?? { motif: motif ?? 'stripe', color: '#1f2a4f', scaleCm: 6, layout: 'grid' };
    // A new motif starts at its own usual size and a standard repeat; an existing print keeps what was not described.
    const fresh = motif !== null && (!current.print || motif !== current.print.motif);
    style.print = { motif: motif ?? base.motif, color: ink ?? base.color, scaleCm: scale ?? (fresh ? defaultScale(motif!) : base.scaleCm), layout: layout ?? (fresh ? 'grid' : base.layout) };
    if (stripe) {
      const nextDirection = direction ?? (!fresh ? base.direction : undefined);
      if (nextDirection) style.print.direction = nextDirection;
    }
  }
  if (!understood.length && !allowUnapplied) throw new Error(`No fabric, colour or print was recognised in “${prompt.trim().slice(0, 60)}”. Try words like "linen", "navy", "breton stripe" or "small floral".`);

  // Report every word that was not part of something understood.
  const ignored: string[] = [];
  for (let match, pattern = /[a-z0-9#-]+/g; (match = pattern.exec(text));) {
    const inside = used.some(([start, end]) => match!.index >= start && match!.index < end);
    if (!inside && !FILLER.has(match[0])) ignored.push(match[0]);
  }
  return { style, understood, ignored };
}

function defaultScale(motif: Motif): number { return { stripe: 2, dots: 4, gingham: 3, floral: 7, triangles: 8, waves: 8 }[motif]; }

// Kept in sync with the library: every motif and layout named above exists.
void MOTIFS; void LAYOUTS;
