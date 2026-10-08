import { practiceBoundary, type PracticeMode, type PracticeRange } from './practice.ts';

// Native media clocks can quantize an exact requested seek. This allowance is
// only for admitting our own seek, never for cue validation or end decisions.
const NATIVE_SEEK_TOLERANCE = 1 / 44100;

type PracticePhase = 'seeking' | 'starting' | 'playing' | 'paused';
interface Owner {
  range: Readonly<PracticeRange>;
  mode: PracticeMode;
  current: () => boolean;
  phase: PracticePhase;
  operation: number;
  target: number | null;
  abort: AbortController | null;
}

/** Transient ownership of the existing player; no editor or saved state lives here. */
export class PracticeController {
  private owner: Owner | null = null;
  private frame = 0;
  private text = 'Choose a lyric range, then Play once or Repeat range. Nothing is saved.';
  private audio: HTMLAudioElement;
  private update: () => void;

  constructor(audio: HTMLAudioElement, update: () => void) {
    this.audio = audio;
    this.update = update;
    for (const kind of ['timeupdate', 'play', 'playing', 'pause', 'ended', 'canplay']) {
      audio.addEventListener(kind, () => this.observe());
    }
    audio.addEventListener('seeking', () => {
      const owner = this.owner;
      if (owner && !(owner.phase === 'seeking' && owner.target !== null
          && Math.abs(owner.target - audio.currentTime) <= NATIVE_SEEK_TOLERANCE))
        this.stop('Seeking stopped practice. Choose Play once or Repeat range to begin again.');
    });
    for (const kind of ['emptied', 'error', 'ratechange', 'loadedmetadata']) {
      audio.addEventListener(kind, () => this.stop('Playback changed. Practice stopped; choose a range to begin again.'));
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop('The page became hidden. Practice stopped; resume only when you choose.');
      else this.update();
    });
    window.addEventListener('pagehide', () => this.stop('The page was suspended. Practice stopped.'));
  }

  get active(): boolean { return this.owner !== null; }
  get paused(): boolean { return this.owner?.phase === 'paused'; }
  get status(): string { return this.text; }

  private publish(text: string): void { this.text = text; this.update(); }
  private cancelOperation(owner: Owner): void {
    owner.operation++;
    owner.abort?.abort(); owner.abort = null; owner.target = null;
    cancelAnimationFrame(this.frame); this.frame = 0;
  }
  stop(text = 'Practice stopped. The playhead and lyric edits are kept.'): void {
    const owner = this.owner;
    if (!owner) return;
    // Clear ownership first: pause may itself dispatch more media work.
    this.owner = null; this.cancelOperation(owner); this.audio.pause(); this.publish(text);
  }
  start(range: Readonly<PracticeRange>, mode: PracticeMode, current: () => boolean): void {
    this.stop();
    const owner: Owner = { range, mode, current, phase: 'seeking', operation: 0, target: null, abort: null };
    this.owner = owner;
    if (!this.valid(owner)) { this.stop('Practice cannot start until matching audio is loaded at normal 1× speed.'); return; }
    void this.begin(owner, range.start, true);
  }
  pause(): void {
    const owner = this.owner; if (!owner) return;
    if (!this.valid(owner)) { this.stop('Playback or the editor changed. Practice stopped.'); return; }
    // Explicit pause intent wins even when the last playback frame just crossed
    // an endpoint; only ordinary playback observation may trigger a repeat.
    this.cancelOperation(owner); owner.phase = 'paused'; this.audio.pause();
    this.publish('Practice paused. Choose Resume practice or use the player’s Play button to continue.');
  }
  resume(): void {
    const owner = this.owner; if (!owner || owner.phase !== 'paused') return;
    if (!this.valid(owner)) { this.stop('Playback or the editor changed. Practice stopped.'); return; }
    const position = this.audio.currentTime;
    if (!Number.isFinite(position) || position < owner.range.start) {
      this.stop('The playhead left the practice range. Choose Play once or Repeat range to begin again.'); return;
    }
    if (position >= owner.range.end) { this.boundary(owner); return; }
    void this.begin(owner, position, this.audio.seeking);
  }
  private valid(owner: Owner): boolean {
    return this.owner === owner && owner.current() && !document.hidden && !this.audio.error
      && this.audio.playbackRate === 1 && !this.audio.loop;
  }
  private current(owner: Owner, operation: number): boolean {
    return this.valid(owner) && owner.operation === operation;
  }
  private async begin(owner: Owner, position: number, seek: boolean): Promise<void> {
    this.cancelOperation(owner);
    const operation = owner.operation, abort = new AbortController(); owner.abort = abort;
    owner.phase = 'seeking'; owner.target = position;
    this.audio.pause();
    this.publish(seek ? 'Seeking to the exact practice start…' : 'Preparing to resume practice…');
    // One deadline covers both native seek/readiness and play admission.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Audio did not become ready within 10 seconds. Practice stopped.')), 10000);
      abort.signal.addEventListener('abort', () => reject(new Error('Practice operation retired.')), { once: true });
    });
    try {
      await Promise.race([this.seekReady(owner, operation, position, seek, abort.signal), deadline]);
      if (!this.current(owner, operation)) return;
      owner.target = null; owner.phase = 'starting';
      this.publish('Starting practice…');
      await Promise.race([this.audio.play(), deadline]);
      if (!this.current(owner, operation)) return;
      if (this.audio.paused) { owner.phase = 'paused'; this.publish('Practice paused. Choose Resume practice when ready.'); return; }
      if (this.audio.currentTime >= owner.range.start) owner.phase = 'playing';
      this.playingText(owner); this.observe();
    } catch (error) {
      if (this.owner !== owner || owner.operation !== operation) return;
      this.stop(`${error instanceof Error ? error.message : 'Audio playback could not start.'} Choose Play once or Repeat range to retry.`);
    } finally {
      clearTimeout(timer);
      // Also removes any readiness listeners after failure or timeout.
      abort.abort(); if (owner.abort === abort) owner.abort = null;
    }
  }
  private seekReady(owner: Owner, operation: number, position: number, seek: boolean, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const events = ['seeked', 'canplay', 'loadeddata'];
      const cleanup = () => { for (const kind of events) this.audio.removeEventListener(kind, ready); signal.removeEventListener('abort', cancelled); };
      const cancelled = () => { cleanup(); reject(new Error('Practice operation retired.')); };
      const ready = () => {
        if (!this.current(owner, operation)) { cleanup(); reject(new Error('Playback or the editor changed. Practice stopped.')); return; }
        if (this.audio.seeking || this.audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        if (Math.abs(this.audio.currentTime - position) > NATIVE_SEEK_TOLERANCE) { cleanup(); reject(new Error('The playhead moved while preparing practice.')); return; }
        cleanup(); resolve();
      };
      for (const kind of events) this.audio.addEventListener(kind, ready);
      signal.addEventListener('abort', cancelled, { once: true });
      try { if (seek) this.audio.currentTime = position; ready(); }
      catch (error) { cleanup(); reject(error); }
    });
  }
  private playingText(owner: Owner): void {
    this.publish(owner.mode === 'repeat' ? 'Repeating the selected range at normal 1× speed, including instrumental gaps.' : 'Playing the selected range once at normal 1× speed, including instrumental gaps.');
  }
  private boundary(owner: Owner): boolean {
    let time = this.audio.currentTime;
    // The service admits original PCM duration within one sample. Only a real
    // natural end may use the exact project endpoint for the domain decision.
    if (this.audio.ended && time === this.audio.duration && Math.abs(time - owner.range.clipDuration) <= 1 / 44100)
      time = owner.range.clipDuration;
    let decision;
    try { decision = practiceBoundary(owner.range, owner.mode, time); }
    catch { this.stop('The playhead left the practice range. Practice stopped.'); return true; }
    if (decision === 'continue') return false;
    if (decision === 'repeat') void this.begin(owner, owner.range.start, true);
    else {
      this.stop('Practice complete. Paused at the exact selected end.');
      this.audio.currentTime = owner.range.end;
    }
    return true;
  }
  private observe(): void {
    const owner = this.owner;
    if (!owner) { this.update(); return; }
    if (!this.valid(owner)) { this.stop('Playback or the editor changed. Practice stopped.'); return; }
    if (owner.phase === 'seeking') return;
    if (this.audio.seeking) { this.stop('Seeking stopped practice. Choose a range to begin again.'); return; }
    // pause() establishes this state before invoking the native pause method.
    // A queued pause event must preserve that explicit intent at a repeat end.
    if (owner.phase === 'paused' && this.audio.paused) return;
    // A successfully admitted own seek may be just below the exact start.
    // Keep waiting for native forward playback; do not pass an expanded range
    // or a rounded timestamp to the strict boundary helper.
    if (owner.phase === 'starting' && this.audio.currentTime < owner.range.start
        && owner.range.start - this.audio.currentTime <= NATIVE_SEEK_TOLERANCE) {
      if (this.audio.paused) this.pause();
      else {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => { this.frame = 0; this.observe(); });
      }
      return;
    }
    // Native end can emit pause before ended, so always check the boundary first.
    if (this.boundary(owner)) return;
    if (this.audio.paused) {
      // Let an in-flight native play promise report refusal. Its queued pause
      // event is not evidence of an admitted, deliberately paused session.
      if (owner.phase === 'starting') return;
      if (owner.phase !== 'paused') {
        this.cancelOperation(owner); owner.phase = 'paused';
        this.publish('Practice paused. Choose Resume practice or use the player’s Play button to continue.');
      }
      return;
    }
    if (owner.phase === 'paused' || owner.phase === 'starting') { owner.phase = 'playing'; this.playingText(owner); }
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.observe(); });
  }
}
