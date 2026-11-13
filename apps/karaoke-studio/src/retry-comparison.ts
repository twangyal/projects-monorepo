import { validateCues, type Cue } from './lyrics.ts';

export interface RetryLineComparison {
  referenceIndices: number[];
  /** Null when intervals are regrouped or have no reference; this is not an accuracy score. */
  wordingChanged: boolean | null;
  timingChanged: boolean;
  regrouped: boolean;
  different: boolean;
}
export interface RetryComparison { lines: RetryLineComparison[]; missingReferenceIndices: number[] }

function wording(text: string): string {
  const tokens = text.normalize('NFKC').toLowerCase().replace(/[’‘`]/g, "'").match(/[\p{L}\p{M}\p{N}']+/gu) ?? [];
  // Space-separated words keep their boundaries. Unspaced-script characters compare consistently across inserted spaces.
  return tokens.flatMap(token => token.replace(/'/g, '').split(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}])/u)).filter(Boolean).join('\0');
}

/** Positive time overlap, bounded by the studio's two 200-line/20k-character inputs. Never decides which reading is right. */
export function compareRetry(reference: readonly Cue[], candidate: readonly Cue[], duration: number): RetryComparison {
  const before = validateCues([...reference], duration), after = validateCues([...candidate], duration);
  const overlaps = after.map(cue => before.flatMap((other,index) => cue.start < other.end && other.start < cue.end ? [index] : []));
  const counts = before.map((_,index) => overlaps.filter(indices => indices.includes(index)).length);
  const lines = after.map((cue,index): RetryLineComparison => {
    const referenceIndices = overlaps[index];
    const regrouped = referenceIndices.length > 1 || referenceIndices.some(index => counts[index] > 1);
    const other = before[referenceIndices[0]];
    const comparable = referenceIndices.length === 1 && !regrouped;
    const wordingChanged = comparable ? wording(other.text) !== wording(cue.text) : null;
    const timingChanged = comparable && (other.start !== cue.start || other.end !== cue.end);
    return { referenceIndices, wordingChanged, timingChanged, regrouped,
      different: !referenceIndices.length || regrouped || wordingChanged === true || timingChanged };
  });
  return { lines, missingReferenceIndices: counts.flatMap((count,index) => count === 0 ? [index] : []) };
}
