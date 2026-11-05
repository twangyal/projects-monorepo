import type { Cue } from './lyrics.ts';
import { parseSyncedLyrics } from './lyrics-lookup.ts';

export const MAX_LRC_BYTES = 128 * 1024;
/** Read local LRC line timings. Enhanced word tags supply text only; word highlighting is regenerated. */
export function parseLrc(bytes: Uint8Array, duration: number): Cue[] {
  if (!bytes.byteLength || bytes.byteLength > MAX_LRC_BYTES) throw new Error('Choose a nonempty UTF-8 LRC file no larger than 128 KiB.');
  let source: string;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('LRC must be valid UTF-8 text; other encodings are not supported.'); }
  for (const point of source) {
    const code = point.codePointAt(0)!;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 || code === 127 || code === 133 || code === 0x2028 || code === 0x2029) {
      throw new Error('LRC contains unsupported controls or line separators. Use plain UTF-8 text.');
    }
  }
  // Unlike a catalogue preview, an explicit local file keeps a line until the next stamp or clip end.
  const cues = parseSyncedLyrics(source, duration, duration);
  if (!cues) throw new Error('LRC needs nonoverlapping [mm:ss.xx] lyric lines within this clip. Check every timestamp and remove unsupported tags such as [offset:…]. Untimed lines cannot be skipped.');
  return cues;
}
