import type { Cue } from './lyrics.ts';

/** Search current words literally; invalid timing must not hide a line needing correction. */
export function findCueIndices(cues: Cue[], query: string): number[] {
  if (!query.trim()) return [];
  const needle = query.toLowerCase();
  return cues.flatMap((cue, index) => cue.text.toLowerCase().includes(needle) ? [index] : []);
}

export function nextCueMatch(matches: number[], current: number | null, direction: 1 | -1): number | null {
  if (!matches.length) return null;
  const at = current === null ? -1 : matches.indexOf(current);
  if (at < 0) return direction === 1 ? matches[0] : matches[matches.length - 1];
  return matches[(at + direction + matches.length) % matches.length];
}
