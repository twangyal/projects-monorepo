import { MAX_CUES, validateCues, type Cue } from './lyrics.ts';

export type TimingPhase = 'start' | 'end' | 'review' | 'cancelled';
export interface TimingState {
  phase: TimingPhase;
  lineIndex: number;
  pendingStart: number | null;
  texts: string[];
  completed: Cue[];
}

function capturedTexts(cues: readonly Cue[]): string[] {
  if (!Array.isArray(cues) || Object.getPrototypeOf(cues) !== Array.prototype || cues.length < 1 || cues.length > MAX_CUES) {
    throw new Error('Choose 1–200 supplied lyric lines before timing.');
  }
  const texts: string[] = [];
  for (let index = 0; index < cues.length; index++) {
    const item = Object.getOwnPropertyDescriptor(cues, String(index));
    if (!item || !('value' in item)) throw new Error(`Line ${index + 1}: supply a literal lyric record.`);
    const cue: unknown = item.value;
    if (!cue || typeof cue !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(cue))) {
      throw new Error(`Line ${index + 1}: supply a literal lyric record.`);
    }
    const text = Object.getOwnPropertyDescriptor(cue, 'text');
    if (!text || !('value' in text) || typeof text.value !== 'string') {
      throw new Error(`Line ${index + 1}: supply literal lyric text.`);
    }
    texts.push(text.value);
  }
  // These private integer intervals serve only to reuse existing text admission.
  // Old numeric timings (including their accessors) are never read or retained.
  validateCues(texts.map((text, index) => ({ start: index, end: index + 1, text })), texts.length);
  return texts;
}

/** Transient supplied-line timing; callers provide actual media positions. */
export class TimingCapture {
  readonly #duration: number;
  readonly #texts: string[];
  readonly #completed: Cue[] = [];
  #phase: TimingPhase = 'start';
  #pendingStart: number | null = null;

  constructor(cues: readonly Cue[], duration: number) {
    validateCues([], duration);
    const texts = capturedTexts(cues);
    this.#duration = duration;
    this.#texts = texts;
  }
  get state(): TimingState {
    return { phase: this.#phase, lineIndex: this.#completed.length, pendingStart: this.#pendingStart,
      texts: [...this.#texts], completed: this.#completed.map(cue => ({ ...cue })) };
  }
  markStart(time: number): void {
    if (this.#phase !== 'start') throw new Error('Mark a line start only when the next supplied line is ready.');
    const previous = this.#completed.at(-1)?.end ?? 0;
    if (!Number.isFinite(time) || time < 0 || time >= this.#duration || time < previous) {
      throw new Error('Choose a finite line start after the previous end and before the clip ends.');
    }
    this.#pendingStart = time === 0 ? 0 : time;
    this.#phase = 'end';
  }
  markEnd(time: number): void {
    if (this.#phase !== 'end') throw new Error('Mark a line start before its end.');
    const start = this.#pendingStart!;
    if (!Number.isFinite(time) || time <= start || time > this.#duration) {
      throw new Error('Choose a finite line end strictly after its start and within the clip.');
    }
    const text = this.#texts[this.#completed.length];
    this.#completed.push({ start, end: time, text });
    this.#pendingStart = null;
    this.#phase = this.#completed.length === this.#texts.length ? 'review' : 'start';
  }
  review(): Cue[] {
    if (this.#phase !== 'review' || this.#completed.length !== this.#texts.length) {
      throw new Error('Complete every supplied line before reviewing captured timings.');
    }
    return validateCues(this.#completed, this.#duration);
  }
  cancel(): void {
    this.#phase = 'cancelled';
    this.#pendingStart = null;
  }
}
