import type { Cue } from './lyrics.ts';
import { cueWords } from './word-timing.ts';

/** How long before a line playback starts when its words are tapped, in seconds, so the first word can be caught. */
export const TAP_LEAD = 1.5;
/** How long after the line's end tapping waits for words still to come before giving up, in seconds. */
export const TAP_GRACE = 1.5;

/**
 * Timing a line's words by tapping while it plays: each tap marks where the next word starts. A tap before the line
 * starts counts from its start, and one after it ends from its end, so the starts stay in order inside the line.
 */
export class WordTapping {
  readonly cue: Readonly<Cue>;
  readonly words: string[];
  readonly #taps: number[] = [];
  #late = 0;
  constructor(cue: Readonly<Cue>) {
    this.cue = cue;
    this.words = cueWords(cue.text);
    if (!this.words.length) throw new Error('This line has no words to time.');
  }
  /** The word the next tap times, or null when all are timed. */
  get next(): string | null { return this.words[this.#taps.length] ?? null; }
  get tapped(): number { return this.#taps.length; }
  get done(): boolean { return this.#taps.length === this.words.length; }
  /** How many words were tapped after the line had ended (they start at its end). */
  get late(): number { return this.#late; }
  tap(time: number): void {
    if (this.done) return;
    if (!Number.isFinite(time)) throw new Error('The player has no playback time to mark.');
    if (time > this.cue.end) this.#late++;
    const earliest = this.#taps.at(-1) ?? this.cue.start;
    this.#taps.push(Math.round(Math.min(Math.max(time, earliest), this.cue.end) * 1000) / 1000);
  }
  /** Whether playback has gone so far past the line that the words still to tap will not come. */
  overdue(time: number): boolean { return !this.done && time > this.cue.end + TAP_GRACE; }
  /** Each word's start, once every word is tapped. */
  result(): number[] {
    if (!this.done) throw new Error(`Tap every word: ${this.words.length - this.tapped} still to time.`);
    return [...this.#taps];
  }
}
