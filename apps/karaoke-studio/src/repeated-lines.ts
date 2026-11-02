// Choruses and refrains repeat, but recognition often hears each repeat differently ("this is our chorus", "this is
// a chorus"). Once one repeat is corrected, the others that were heard like it, or like the correction, can take the
// same wording in one step. Lines the person has already changed are never offered.

/** The words of a line for comparison: lower case, without punctuation; unspaced scripts compare by character. */
export function lineWords(text: string): string[] {
  const words = (text.normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'").match(/[\p{L}\p{N}\p{M}']+/gu) ?? [])
    .map(word => word.replace(/^'+|'+$/g, '')).filter(Boolean);
  return words.length === 1 && [...words[0]!].length > 3 && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u.test(words[0]!)
    ? [...words[0]!] : words;
}

/** Word-level edit distance between two lines. */
function distance(a: readonly string[], b: readonly string[]): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length]!;
}

/** Repeats are lines of at least this many words that differ in at most this share of them. */
const MIN_WORDS = 3, MAX_DIFFERENCE = 0.4;

/** Whether two lines read like the same lyric heard twice. */
export function heardAlike(a: string, b: string): boolean {
  const x = lineWords(a), y = lineWords(b);
  if (Math.min(x.length, y.length) < MIN_WORDS) return false;
  return distance(x, y) <= MAX_DIFFERENCE * Math.max(x.length, y.length);
}

/**
 * Other lines that could take `wording`, the correction of line `index`: lines still as they were heard
 * (`drafts[j] === heard[j]`) whose recognized text reads like line `index`'s, or like the correction, and that do not
 * already say it.
 */
export function similarLines(heard: readonly string[], drafts: readonly string[], index: number, wording: string): number[] {
  if (!lineWords(wording).length || lineWords(wording).join(' ') === lineWords(heard[index] ?? '').join(' ')) return [];
  const result: number[] = [];
  for (const [j, text] of heard.entries()) {
    if (j === index || drafts[j] !== text || lineWords(text).join(' ') === lineWords(wording).join(' ')) continue;
    if (heardAlike(text, heard[index] ?? '') || heardAlike(text, wording)) result.push(j);
  }
  return result;
}

/** "lines 5 and 9", "line 3", "lines 2, 4 and 7" (1-based). */
export function lineList(indices: readonly number[]): string {
  const numbers = indices.map(index => String(index + 1));
  return numbers.length === 1 ? `line ${numbers[0]}` : `lines ${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}
