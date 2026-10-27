import { validateCues, type Cue } from './lyrics.ts';
import { cueWords } from './word-timing.ts';

/** What the studio recognized from a clip's separated vocals. */
export interface RecognizedCue extends Cue { confidence: number }
export type Transcript = { available: false } | { available: true; model: string; words: number; cues: RecognizedCue[] };
export interface AlignedCue extends Cue { matched: number }

/** Lines whose words were mostly not heard are placed between neighbours and need a listen. */
export const UNCERTAIN_SHARE = 0.5;
/** Automatic lines whose words averaged below this confidence were usually misheard (see README). */
export const UNSURE_CONFIDENCE = 0.7;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The studio returned an unreadable lyric reply.');
  return value as Record<string, unknown>;
}

function cues(value: unknown, duration: number, score: 'matched' | 'confidence'): (Cue & { score: number })[] {
  if (!Array.isArray(value)) throw new Error('The studio returned an unreadable lyric reply.');
  const result = value.map((raw) => {
    const item = record(raw);
    const keys = Object.keys(item).sort().join(',');
    if (keys !== (score === 'matched' ? 'end,matched,start,text' : 'confidence,end,start,text')) throw new Error('The studio returned an unreadable lyric reply.');
    const share = item[score];
    if (typeof share !== 'number' || !(share >= 0 && share <= 1)) throw new Error('The studio returned an unreadable lyric reply.');
    return { start: item.start as number, end: item.end as number, text: item.text as string, score: share };
  });
  // The same rules as saving: ordered, non-overlapping, inside the clip, bounded text.
  validateCues(result.map(({ start, end, text }) => ({ start, end, text })), duration);
  return result;
}

/** Which recognizer heard a clip, in words: the studio uses its English model for English songs. */
export function recognizerName(model: string): string {
  if (model.startsWith('parakeet-tdt-0.6b-v2')) return 'the English recognition model';
  if (model.startsWith('parakeet-tdt-0.6b-v3')) return 'the multilingual recognition model';
  if (model.startsWith('sensevoice')) return 'the East Asian recognition model';
  if (model.startsWith('whisper')) return 'Whisper, timed by the multilingual recognition model';
  return 'the local recognition model';
}

export function parseTranscript(value: unknown, duration: number): Transcript {
  const reply = record(value);
  if (reply.available === false && Object.keys(reply).length === 1) return { available: false };
  if (reply.available !== true || Object.keys(reply).sort().join(',') !== 'available,cues,model,words'
    || typeof reply.model !== 'string' || reply.model.length > 80 || !Number.isSafeInteger(reply.words) || (reply.words as number) < 0) {
    throw new Error('The studio returned an unreadable lyric reply.');
  }
  return { available: true, model: reply.model, words: reply.words as number, cues: cues(reply.cues, duration, 'confidence').map(({ start, end, text, score }) => ({ start, end, text, confidence: score })) };
}

export function parseAlignment(value: unknown, duration: number, lines: readonly string[]): AlignedCue[] {
  const reply = record(value);
  if (Object.keys(reply).join(',') !== 'cues') throw new Error('The studio returned an unreadable lyric reply.');
  const result = cues(reply.cues, duration, 'matched').map(({ start, end, text, score }) => ({ start, end, text, matched: score }));
  if (result.length !== lines.length || result.some((cue, index) => cue.text !== lines[index])) {
    throw new Error('The studio changed the supplied lyric lines. Your pasted words are kept.');
  }
  return result;
}

/** “lines 3, 7 and 12” for aligned lines that were not clearly heard, or an empty string. */
export function uncertainSummary(aligned: readonly AlignedCue[]): string {
  return lineList(aligned.flatMap((cue, index) => (cue.matched < UNCERTAIN_SHARE ? [index + 1] : [])));
}

/** The same for automatic lines that recognition was unsure about. */
export function unsureSummary(recognized: readonly RecognizedCue[]): string {
  return lineList(recognized.flatMap((cue, index) => (cue.confidence < UNSURE_CONFIDENCE ? [index + 1] : [])));
}

function lineList(numbers: number[]): string {
  if (!numbers.length) return '';
  if (numbers.length === 1) return `line ${numbers[0]}`;
  const shown = numbers.slice(0, 12);
  const rest = numbers.length - shown.length;
  return `lines ${shown.slice(0, -1).join(', ')}${rest ? `, ${shown.at(-1)} and ${rest} more` : ` and ${shown.at(-1)}`}`;
}

/** A saved line start this far from every automatic line start was moved by the user. */
export const MOVED_SECONDS = 0.5;
export interface Correction { words: number; changed: number; lines: number; moved: number }

/**
 * How far saved lyrics are from the automatic ones, as a measure of correction effort: word edits (changed, added or
 * removed words, ignoring case and punctuation) against the automatic words, and saved lines that start more than
 * MOVED_SECONDS from every automatic line start.
 */
export function correction(automatic: readonly Cue[], saved: readonly Cue[]): Correction {
  const words = (cues: readonly Cue[]) => cues.flatMap(cue => cueWords(cue.text)).map(word => word.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const before = words(automatic), after = words(saved);
  let previous = Int32Array.from({ length: after.length + 1 }, (_, j) => j);
  for (let i = 1; i <= before.length; i++) {
    const current = new Int32Array(after.length + 1);
    current[0] = i;
    for (let j = 1; j <= after.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (before[i - 1] === after[j - 1] ? 0 : 1));
    previous = current;
  }
  const starts = automatic.map(cue => cue.start);
  const moved = saved.filter(cue => !starts.some(start => Math.abs(start - cue.start) <= MOVED_SECONDS)).length;
  return { words: before.length, changed: previous[after.length]!, lines: saved.length, moved };
}

/** The correction in a sentence, or an empty string when there were no automatic words. */
export function correctionSummary({ words, changed, lines, moved }: Correction): string {
  if (!words) return '';
  if (!changed && !moved) return 'Your saved lyrics are the automatic lyrics unchanged.';
  const share = Math.round(100 * changed / words);
  return `Compared with them, your saved lyrics changed ${changed.toLocaleString('en-US')} of ${words.toLocaleString('en-US')} words (${share}%)`
    + ` and moved ${moved} of ${lines} line ${lines === 1 ? 'start' : 'starts'} by over half a second.`;
}
