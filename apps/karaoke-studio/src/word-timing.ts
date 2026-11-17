import type { Cue } from './lyrics.ts';

/** One word of a lyric line and the time it starts being sung (from the studio's word timing). */
export interface TimedWord { text: string; start: number; heard: boolean }
/** Each line's words with their start times, and where its script needs it, how it is said in Latin letters: a piece
 * for each word, '' for a word said with the one before it (null for a line in Latin letters). */
export interface WordTiming { recognized: boolean; lines: TimedWord[][]; said: (string[] | null)[] }

const unreadable = () => new Error('The studio returned unreadable word timing.');
// Scripts written without spaces (karaoke/lyrics_auto.py has the same rule): each Chinese, Japanese, Thai,
// Lao, Myanmar or Khmer character is its own word, and Tibetan words end at a syllable mark.
const EACH = [[0x0E00, 0x0EFF], [0x1000, 0x109F], [0x1780, 0x17FF], [0x2E80, 0x2FDF], [0x3005, 0x3007], [0x3021, 0x3029],
  [0x3038, 0x303B], [0x3040, 0x30FF], [0x31F0, 0x31FF], [0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xF900, 0xFAFF], [0xFF66, 0xFF9F],
  [0x20000, 0x3134F]] as const;
const SYLLABLE_ENDS = new Set(['་', '༌', '།', '༎']);
function kind(character: string): 'each' | 'tibetan' | 'other' {
  const code = character.codePointAt(0)!;
  if (EACH.some(([low, high]) => low <= code && code <= high)) return 'each';
  return code >= 0x0F00 && code <= 0x0FFF ? 'tibetan' : 'other';
}
const opening = /^[\p{Ps}\p{Pi}]+$/u, attached = /^[\p{M}\p{Pd}\p{Pe}\p{Pf}\p{Pc}\p{Po}]$/u;
/** Words as the studio splits them, kept exactly: whitespace-separated, with spaceless scripts split as above. */
export function cueWords(text: string): string[] {
  const words: string[] = [];
  for (const part of text.split(/\s+/).filter(Boolean)) {
    const pieces: string[] = [];
    for (const character of part) {
      const last = pieces.length ? [...pieces[pieces.length - 1]!].at(-1)! : '';
      const now = kind(character), before = last ? kind(last) : null;
      if (last && (opening.test(pieces[pieces.length - 1]!) || attached.test(character)
        || (now === 'tibetan' && before === 'tibetan' && !SYLLABLE_ENDS.has(last)) || (now === 'other' && before === 'other'))) {
        pieces[pieces.length - 1] += character;
      } else pieces.push(character);
    }
    words.push(...pieces);
  }
  return words;
}

/** Strictly validate a word-timing reply for exactly these cues; anything else is refused. */
export function parseWordTiming(value: unknown, cues: readonly Cue[]): WordTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  const reply = value as Record<string, unknown>;
  const keys = Object.keys(reply).sort().join(',');
  if ((keys !== 'lines,recognized' && keys !== 'lines,recognized,said') || typeof reply.recognized !== 'boolean'
    || !Array.isArray(reply.lines) || reply.lines.length !== cues.length) throw unreadable();
  const said = reply.said === undefined ? cues.map(() => null) : reply.said;
  if (!Array.isArray(said) || said.length !== cues.length) throw unreadable();
  const lines = reply.lines.map((line, index) => {
    const cue = cues[index], expected = cueWords(cue.text);
    if (!Array.isArray(line) || line.length !== expected.length) throw unreadable();
    let previous = cue.start;
    return line.map((raw, k) => {
      const word = raw as Record<string, unknown>;
      if (!word || typeof word !== 'object' || Object.keys(word).sort().join(',') !== 'heard,start,text') throw unreadable();
      const { text, start, heard } = word;
      if (text !== expected[k] || typeof heard !== 'boolean' || typeof start !== 'number' || !Number.isFinite(start)
        || start < previous || start > cue.end) throw unreadable();
      previous = start;
      return { text, start, heard } as TimedWord;
    });
  });
  return {
    recognized: reply.recognized, lines,
    said: said.map((pieces, index) => {
      if (pieces === null) return null;
      if (!Array.isArray(pieces) || pieces.length !== lines[index]!.length || !pieces.every(piece => typeof piece === 'string' && piece.length <= 120)) throw unreadable();
      return pieces as string[];
    }),
  };
}

/** A line's pronunciation as shown: its pieces with a space between each. */
export function saidLine(pieces: readonly string[]): string {
  return pieces.filter(Boolean).join(' ');
}

/** Non-space characters of the pronunciation said by `time`: the pieces of the words that have started. */
export function saidCharacters(pieces: readonly string[], words: readonly TimedWord[], time: number): number {
  let count = 0;
  pieces.forEach((piece, index) => { if (words[index] && words[index]!.start <= time) count += [...piece].filter(ch => !/\s/.test(ch)).length; });
  return count;
}

/** Non-space characters (Unicode code points) of the words that have started by `time`. */
export function sungCharacters(words: readonly TimedWord[], time: number): number {
  let count = 0;
  for (const word of words) if (word.start <= time) count += [...word.text].length;
  return count;
}

/** Split a displayed line after `count` non-space code points: the sung part and the rest. */
export function splitSung(line: string, count: number): [string, string] {
  let sung = '', seen = 0;
  for (const character of line) {
    if (seen >= count) break;
    sung += character;
    if (!/\s/.test(character)) seen++;
  }
  return [sung, line.slice(sung.length)];
}
