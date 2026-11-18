// Word-by-word highlighting for lines with right-to-left text. Such a line is shaped and ordered as a whole (Arabic
// letters join, and the bidirectional algorithm places Latin words and numbers among the right-to-left ones), so the
// words sung first can lie anywhere along it. It is drawn whole twice over: in the colour of words not yet sung, and in
// the sung colour where the sung words lie. The browser's own layout says where that is (see `wordPlaces` in main.ts);
// the video finds the same places from FriBidi (karaoke/bidi.py), and sung-stretches.json holds cases both agree on.

/** A word's place on its line: the left and right edges of each piece of it from the line's left edge (several when
 * the bidirectional algorithm splits it). */
export type WordPlace = readonly (readonly [number, number])[];

/** The whitespace-separated words of a line, with where each starts and ends (UTF-16 offsets). */
export function lineWords(line: string): { start: number; end: number; text: string }[] {
  return [...line.matchAll(/\S+/gu)].map(match => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
}

/** Which words of `line` are lit when `count` leading non-space characters (code points) are sung: each word once its
 * first character is. */
export function litWords(line: string, count: number): boolean[] {
  let before = 0;
  return lineWords(line).map(({ text }) => {
    const lit = before < count;
    before += [...text].length;
    return lit;
  });
}

/** Pieces of one word that touch are one stretch of it. */
export function joinPieces(pieces: readonly (readonly [number, number])[]): [number, number][] {
  const joined: [number, number][] = [];
  for (const [left, right] of [...pieces].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = joined.at(-1);
    if (last && left - last[1] < 0.5) last[1] = Math.max(last[1], right);
    else joined.push([left, right]);
  }
  return joined;
}

/**
 * The stretches of a line to draw in the sung colour: the lit words' pieces, widened halfway to the neighbouring pieces
 * of unlit words and, where no unlit piece lies further out, to the line's ends and beyond (infinite).
 */
export function sungStretches(places: readonly WordPlace[], lit: readonly boolean[]): [number, number][] {
  const boxes = places.flatMap((place, index) => place.map(([left, right]) => ({ left, right, on: !!lit[index] })))
    .sort((a, b) => a.left - b.left || a.right - b.right || Number(a.on) - Number(b.on));
  const stretches: [number, number][] = [];
  let start: number | null = null;
  boxes.forEach((box, index) => {
    const between = index ? (boxes[index - 1]!.right + box.left) / 2 : -Infinity;
    if (box.on && start === null) start = between;
    if (!box.on && start !== null) { stretches.push([start, between]); start = null; }
  });
  if (start !== null) stretches.push([start, Infinity]);
  return stretches;
}

/** Whole-pixel stretches of a frame `width` wide for the sung colour and for the rest, from stretches of a line whose
 * left edge is at `left`: together they cover the frame once. */
export function framed(stretches: readonly (readonly [number, number])[], left: number, width: number): { sung: [number, number][]; rest: [number, number][] } {
  const sung: [number, number][] = [], rest: [number, number][] = [];
  let from = 0;
  for (const [low, high] of stretches) {
    const a = low === -Infinity ? 0 : Math.max(0, Math.round(left + low)), b = high === Infinity ? width : Math.min(width, Math.round(left + high));
    if (b <= a) continue;
    if (a > from) rest.push([from, a]);
    sung.push([a, b]); from = b;
  }
  if (from < width) rest.push([from, width]);
  return { sung, rest };
}
