import type { Cue } from './lyrics.ts';

/** One word of a lyric line and the time it starts being sung (from the studio's word timing). */
export interface TimedWord { text: string; start: number; heard: boolean }
export interface WordTiming { recognized: boolean; lines: TimedWord[][] }

const unreadable = () => new Error('The studio returned unreadable word timing.');
/** Words as the studio splits them: whitespace-separated, kept exactly. */
export function cueWords(text: string): string[] { return text.split(/\s+/).filter(Boolean); }

/** Strictly validate a word-timing reply for exactly these cues; anything else is refused. */
export function parseWordTiming(value: unknown, cues: readonly Cue[]): WordTiming {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unreadable();
  const reply = value as Record<string, unknown>;
  if (Object.keys(reply).sort().join(',') !== 'lines,recognized' || typeof reply.recognized !== 'boolean'
    || !Array.isArray(reply.lines) || reply.lines.length !== cues.length) throw unreadable();
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
  return { recognized: reply.recognized, lines };
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
