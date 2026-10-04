import { validateCues, MAX_CUES, type Cue } from './lyrics.ts';

export const MAX_SRT_BYTES = 128 * 1024;

const timestamp = /^(\d{2}):([0-5]\d):([0-5]\d),(\d{3}) --> (\d{2}):([0-5]\d):([0-5]\d),(\d{3})$/;
const separator = (line: string): boolean => /^[ \t]*$/.test(line);
// This is Python str.strip() whitespace that remains after control admission.
// U+FEFF is intentionally not whitespace: a BOM within lyric text is literal.
const whitespaceOnly = /^[\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]*$/;
const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };

export function parseSrt(bytes: Uint8Array, duration: number): Cue[] {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_SRT_BYTES) {
    throw new Error('Choose a nonempty UTF-8 SRT file of at most 128 KiB.');
  }
  let source: string;
  try {
    // Preserve the BOM here so exactly one optional initial BOM is consumed.
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('SRT must be valid UTF-8 text; other encodings are not supported.');
  }
  if (source.startsWith('\ufeff')) source = source.slice(1);
  source = source.replaceAll('\r\n', '\n');
  for (const point of source) {
    const code = point.codePointAt(0)!;
    if (code < 32 && code !== 9 && code !== 10 || code === 127 || code === 133 || code === 0x2028 || code === 0x2029) {
      throw new Error('SRT contains unsupported controls or line separators. Use LF or CRLF and plain text.');
    }
  }
  const lines = source.split('\n');
  const cues: Cue[] = [];
  let position = 0;
  while (position < lines.length) {
    while (position < lines.length && separator(lines[position])) position++;
    if (position === lines.length) break;
    const number = cues.length + 1;
    if (number > MAX_CUES) throw new Error('Use at most 200 SRT cues.');
    if (lines[position++] !== String(number)) {
      throw new Error(`Cue ${number}: use contiguous cue numbers starting at 1 without spaces or leading zeros.`);
    }
    const match = timestamp.exec(lines[position++] ?? '');
    if (!match) throw new Error(`Cue ${number}: use exactly HH:MM:SS,mmm --> HH:MM:SS,mmm without settings.`);
    const milliseconds = (offset: number): number =>
      ((Number(match[offset]) * 60 + Number(match[offset + 1])) * 60 + Number(match[offset + 2])) * 1000 + Number(match[offset + 3]);
    const textLines: string[] = [];
    while (position < lines.length && !separator(lines[position])) {
      const line = lines[position++];
      if (line.includes('<') || line.includes('>')) {
        throw new Error(`Cue ${number}: use plain text, with &lt; and &gt; for literal angle brackets; markup is not supported.`);
      }
      // One regex pass prevents &amp;lt; from being decoded a second time.
      const decoded = line.replace(/&amp;|&lt;|&gt;/g, entity => entities[entity]);
      if (whitespaceOnly.test(decoded)) {
        throw new Error(`Cue ${number}: remove whitespace-only lyric lines; blank lines separate SRT cues.`);
      }
      textLines.push(decoded);
    }
    if (!textLines.length) throw new Error(`Cue ${number}: include at least one nonblank lyric line.`);
    cues.push({ start: milliseconds(1) / 1000, end: milliseconds(5) / 1000, text: textLines.join('\n') });
  }
  if (!cues.length) throw new Error('Include at least one numbered SRT cue.');
  return validateCues(cues, duration);
}
