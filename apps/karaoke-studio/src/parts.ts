// Duets: the lines each singer sings light up in their own colour, and lines they sing together in a third; the words
// of a line still to be sung lean a little toward its colour, so singers see whose line it is before it starts, and the
// next line says whose it is. Singer 1 keeps the lyric style's own accent. The video draws the same (karaoke/video.py);
// part-colours.json holds what both give.
import type { Singer } from './lyrics.ts';

export type PartStyle = 'classic' | 'contrast' | 'large' | 'light';
/** Singer 2's colour and both singers' colour in each lyric style. */
export const PART_COLOURS: Record<PartStyle, { two: string; both: string }> = {
  classic: { two: '#8ec5ff', both: '#c9a7ff' },
  contrast: { two: '#00e5ff', both: '#ff7ae0' },
  large: { two: '#8ec5ff', both: '#c9a7ff' },
  light: { two: '#1f5fa8', both: '#7a3a9a' },
};
/** How far a part's words still to be sung lean from the style's main colour toward the part's colour. */
export const PART_TINT = 0.3;

/** `a` moved `t` of the way to `b`, both #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return `#${[0, 1, 2].map(i => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** The colours of a line: its words still to be sung (`main`) and those sung (`accent`). */
export function partLook(style: PartStyle, look: { main: string; accent: string }, singer?: Singer): { main: string; accent: string } {
  if (singer === undefined) return { main: look.main, accent: look.accent };
  const accent = singer === 1 ? look.accent : singer === 2 ? PART_COLOURS[style].two : PART_COLOURS[style].both;
  return { main: mix(look.main, accent, PART_TINT), accent };
}

/** How the next line is introduced: whose it is, in a duet. */
export function nextLabel(singer?: Singer): string {
  return singer === undefined ? 'Next' : singer === 'both' ? 'Next, both' : `Next, singer ${singer}`;
}
