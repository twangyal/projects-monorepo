import type { Cue } from './lyrics.ts';

export interface RawTiming { start: number; end: number; startText: string; endText: string }
export interface LyricDraft { title: string; cues: Cue[]; pastedText: string; pastedDirty: boolean; rawTimings?: RawTiming[] }

function sameLyrics(a: LyricDraft, b: LyricDraft): boolean {
  return a.title === b.title && a.cues.length === b.cues.length && a.cues.every((cue, index) => {
    const other = b.cues[index];
    return cue.text === other.text && Object.is(cue.start, other.start) && Object.is(cue.end, other.end);
  });
}
function sameDraft(a: LyricDraft, b: LyricDraft): boolean {
  const spelling = (draft: LyricDraft, index: number, boundary: 'start' | 'end') => {
    const value = draft.cues[index][boundary], raw = draft.rawTimings?.[index];
    return raw && Object.is(raw[boundary], value) ? raw[`${boundary}Text`] : Number.isFinite(value) ? String(value) : '';
  };
  return sameLyrics(a, b) && a.pastedText === b.pastedText && a.pastedDirty === b.pastedDirty
    && a.cues.every((_, index) => spelling(a, index, 'start') === spelling(b, index, 'start') && spelling(a, index, 'end') === spelling(b, index, 'end'));
}

export class LyricHistory {
  private saved: LyricDraft;
  private states: LyricDraft[];
  private index = 0;
  private group: string | null = null;
  constructor(draft: LyricDraft) {
    this.saved = structuredClone(draft);
    this.states = [structuredClone(draft)];
  }
  get current(): LyricDraft { return structuredClone(this.states[this.index]); }
  get canUndo(): boolean { return this.index > 0; }
  get canRedo(): boolean { return this.index < this.states.length - 1; }
  get dirty(): boolean { return !sameLyrics(this.states[this.index], this.saved); }
  record(draft: LyricDraft, group: string | null = null): void {
    if (sameDraft(draft, this.states[this.index])) {
      if (group !== this.group) this.endGroup();
      return;
    }
    this.states.length = this.index + 1;
    if (group !== null && group === this.group && this.index > 0) this.states[this.index] = structuredClone(draft);
    else {
      this.states.push(structuredClone(draft));
      if (this.states.length > 31) this.states.shift();
      this.index = this.states.length - 1;
    }
    this.group = group;
  }
  endGroup(): void { this.group = null; }
  undo(): LyricDraft | null {
    this.endGroup();
    if (!this.canUndo) return null;
    this.index--; return this.current;
  }
  redo(): LyricDraft | null {
    this.endGroup();
    if (!this.canRedo) return null;
    this.index++; return this.current;
  }
}
