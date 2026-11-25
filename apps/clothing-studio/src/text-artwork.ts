// Words printed on a garment (a slogan or a name), as artwork: read from a description ("with "Stay Wild" on the
// back in white letters") or typed in the Artwork section, then drawn into an image the garment carries like any
// uploaded artwork, so the 3D view, tech pack and exports need nothing new.
import { readStylePrompt } from './style-prompt.ts';
import { ARTWORK_PART_NAMES, artworkDefaults, type Artwork, type PartStyle, type Product } from './product.ts';

export const TEXT_FONTS = { sans: 'Sans serif', serif: 'Serif', mono: 'Monospace' } as const;
export type TextFont = keyof typeof TEXT_FONTS;
export interface TextRequest { text: string; side: Artwork['part']; color: string; font: TextFont; /** Clockwise as seen from outside: 90 runs it down a sleeve. */ rotation?: number }
/** Text read from a description, before its default colour is chosen against the garment's. */
export type SloganRequest = Omit<TextRequest, 'color'> & { color: string | null };
export const MAX_TEXT = 40;

const QUOTED = /["“”„«»]([^"“”„«»]+)["“”„«»]/;
const SIDE = /\b(on|across|down|along)\s+(?:the\s+)?(?:(left|right)\s+)?(back|front|chest|sleeve)\b/i;
const INTERNAL_SIDE = /\b(?:on|across|down|along)\s+(?:the\s+)?(?:(?:front\s+)?(?:fusible\s+)?interfacing|fusible\s+front\s+interfacing)\b/i;
const LETTERS = /\b(?:in\s+)?([a-z][a-z -]{1,30}?)\s+(?:letters|lettering|text|type|writing|print|ink)\b/i;
const COLOURED = /\bin\s+([a-z][a-z -]{1,30}?)(?=\s*(?:[,.;]|$|\bon\b|\bacross\b))/i;

/** Text that reads clearly on a garment of this colour: near-white on dark colours, near-black on light ones. */
export function contrastingInk(color: string): string {
  const value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#ffffff';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.25 ? '#1b1c1b' : '#f8f6f0';
}

const NEUTRAL: PartStyle = { material: 'jersey-180', color: '#808080', print: null };
function colourOf(words: string): string | null {
  const reading = readStylePrompt(words, NEUTRAL);
  return reading.understood.some(item => item.startsWith('colour')) ? reading.style.color : null;
}

/**
 * The words in quotes in a description, where they go and in what colour: `"Stay Wild" on the back in white letters`.
 * `rest` is the description without them, for reading the garment itself. Null when nothing is quoted.
 */
export function readSlogan(prompt: string): { request: SloganRequest; rest: string; unsupportedPlacement?: string } | null {
  const quote = QUOTED.exec(prompt);
  if (!quote) return null;
  const text = quote[1]!.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if ([...text].length > MAX_TEXT) throw new Error(`Text on a garment can be up to ${MAX_TEXT} characters; “${text.slice(0, 20)}…” is longer.`);
  const blank = (from: number, length: number) => { rest = rest.slice(0, from) + ' '.repeat(length) + rest.slice(from + length); };
  let rest = prompt;
  blank(quote.index, quote[0].length);
  // Placement and colour words follow the quote ("… on the back in white letters") or come just before it.
  const end = quote.index + quote[0].length;
  const near = (pattern: RegExp) => {
    const after = pattern.exec(rest.slice(end));
    if (after && after.index <= 40) return { match: after, at: end + after.index };
    const from = Math.max(0, quote.index - 40), before = pattern.exec(rest.slice(from, quote.index));
    return before ? { match: before, at: from + before.index } : null;
  };
  // An explicit internal destination must not fall through to the default front-shell placement.
  const internal = near(INTERNAL_SIDE);
  const placed = internal ? null : near(SIDE);
  if (internal) blank(internal.at, internal.match[0].length);
  if (placed) blank(placed.at, placed.match[0].length);
  // On a sleeve: the left one unless the right is named, across the arm, or running down it for "down" or "along".
  const where = placed?.match[3]?.toLowerCase(), along = where === 'sleeve' && /^(?:down|along)$/i.test(placed!.match[1]!);
  const side: Artwork['part'] = where === 'back' ? 'back' : where === 'sleeve' ? (placed!.match[2]?.toLowerCase() === 'right' ? 'sleeveRight' : 'sleeveLeft') : 'front';
  let color: string | null = null;
  for (const pattern of [LETTERS, COLOURED]) {
    const found = near(pattern), named = found && colourOf(found.match[1]!);
    if (found && named) { color = named; blank(found.at, found.match[0].length); break; }
  }
  // "With", "saying" or "printed" left before the quote ("with the words …") go with it.
  for (let pass = 0; pass < 3; pass++) rest = rest.replace(/\b(?:with|saying|that says|reading|printed(?: with)?|the words?|slogan|text)(?=\s{2,}|\s*$)/gi, '  ');
  return { request: { text, side, color, font: 'sans', ...(along ? { rotation: 90 } : {}) }, rest, ...(internal ? { unsupportedPlacement: internal.match[0] } : {}) };
}

const CSS_FONTS: Record<TextFont, string> = { sans: '700 160px sans-serif', serif: '700 160px serif', mono: '700 150px monospace' };

/** Lines of at most about 20 characters, broken at spaces (a longer word keeps a line of its own). */
export function textLines(text: string): string[] {
  const words = text.split(' '), lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && [...last].length + 1 + [...word].length <= 20) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

/** The request drawn as a transparent PNG, sized to its text. */
export function renderText(request: TextRequest, doc: Document = document): { dataUrl: string; width: number; height: number } {
  const canvas = doc.createElement('canvas'), context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot draw text artwork.');
  const lines = textLines(request.text), font = CSS_FONTS[request.font], size = request.font === 'mono' ? 150 : 160, pad = 24;
  context.font = font;
  const width = Math.ceil(Math.max(...lines.map(line => context.measureText(line).width))) + pad * 2;
  canvas.width = Math.min(4096, width); canvas.height = Math.ceil(lines.length * size * 1.2) + pad * 2;
  context.font = font; context.fillStyle = request.color; context.textAlign = 'center'; context.textBaseline = 'middle';
  lines.forEach((line, i) => context.fillText(line, canvas.width / 2, pad + size * 1.2 * (i + 0.5), canvas.width - pad * 2));
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/** The artwork for drawn text, placed like uploaded artwork (see artworkDefaults): on a top, centred 10 cm below the
 * shoulder at the front; on a sleeve, on its upper arm, or running down it when turned. */
export function textArtwork(request: TextRequest, image: { dataUrl: string; width: number; height: number }, product: Product): Artwork {
  const turned = request.rotation ? { rotation: request.rotation } : {};
  return { part: request.side, ...image, name: `Text: ${request.text}`.slice(0, 120), ...artworkDefaults(product, request.side, { ...image, ...turned }), ...turned };
}

/** Where text goes, in words: "the front", "the left sleeve, running down it". */
export function textPlace(request: Pick<TextRequest, 'side' | 'rotation'>): string {
  return `the ${ARTWORK_PART_NAMES[request.side]}${request.rotation ? ', running down it' : ''}`;
}
