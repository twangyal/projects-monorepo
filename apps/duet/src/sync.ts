export interface Playback { trackId: string | null; playing: boolean; position: number; revision: number }
export interface Track { id: string; title: string; artist: string; duration: number; uploadedBy: 'host' | 'guest'; createdAt: number }
export interface SyncSnapshot { serverTime: number; playback: Playback; tracks: Track[] }

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}

export function estimatedPosition(snapshot: SyncSnapshot, nowServerMs: number): number {
  finite(snapshot.serverTime, 'Snapshot time');
  finite(nowServerMs, 'Current server time');
  finite(snapshot.playback.position, 'Playback position');
  if (typeof snapshot.playback.playing !== 'boolean') throw new Error('Playback playing state must be a boolean.');
  const track = snapshot.tracks.find(item => item.id === snapshot.playback.trackId);
  if (!track) return 0;
  finite(track.duration, 'Track duration');
  if (track.duration < 1 || track.duration > 300) throw new Error('Track duration must be between 1 and 300 seconds.');
  const elapsed = snapshot.playback.playing ? Math.max(0, nowServerMs - snapshot.serverTime) / 1000 : 0;
  return Math.max(0, Math.min(track.duration, snapshot.playback.position + elapsed));
}

export function clockOffset(serverTime: number, requestStart: number, responseEnd: number): number {
  finite(serverTime, 'Server timestamp'); finite(requestStart, 'Request timestamp'); finite(responseEnd, 'Response timestamp');
  if (responseEnd < requestStart) throw new Error('Response timestamp cannot precede the request timestamp.');
  const offset = serverTime - (requestStart / 2 + responseEnd / 2);
  finite(offset, 'Clock offset');
  return offset;
}

interface Latest { snapshot: SyncSnapshot; offset: number }
interface PlayAttempt { generation: number; promise: Promise<void> }

/** Follows room snapshots through native audio events; it never writes room state. */
export class AudioSync {
  readonly #audio: HTMLAudioElement;
  readonly #onStatus: (message: string) => void;
  #enabled = false;
  #destroyed = false;
  #generation = 0;
  #latest: Latest | null = null;
  #source: string | null = null;
  #attempt: PlayAttempt | null = null;
  #blocked: string | null = null;
  #lastStatus = '';
  readonly #metadata = () => { void this.#synchronize(true); };
  readonly #ready = () => { void this.#synchronize(false); };
  readonly #error = () => {
    if (!this.#destroyed && this.#source && this.#audio.error && this.#audio.currentSrc === this.#source) {
      this.#block('Audio could not load. Check the local studio connection and click Enable audio to retry.');
    }
  };

  constructor(audio: HTMLAudioElement, onStatus: (message: string) => void) {
    this.#audio = audio;
    this.#onStatus = onStatus;
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', this.#metadata);
    audio.addEventListener('canplay', this.#ready);
    audio.addEventListener('ended', this.#ready);
    audio.addEventListener('error', this.#error);
  }

  get enabled(): boolean { return this.#enabled; }

  async enable(): Promise<void> {
    if (this.#destroyed) return;
    if (!this.#enabled) {
      this.#enabled = true;
      ++this.#generation;
      this.#attempt = null;
    }
    this.#blocked = null;
    if (this.#audio.error && this.#source) this.#audio.load();
    await this.#synchronize(false);
  }

  apply(snapshot: SyncSnapshot, audioUrl: (trackId: string) => string, offsetMs: number): void {
    if (this.#destroyed) return;
    finite(offsetMs, 'Clock offset');
    if (!Array.isArray(snapshot.tracks)) throw new Error('Room tracks must be an array.');
    if (!Number.isInteger(snapshot.playback.revision) || snapshot.playback.revision < 0) throw new Error('Playback revision must be a nonnegative integer.');
    estimatedPosition(snapshot, Date.now() + offsetMs);
    const safe: SyncSnapshot = {
      serverTime: snapshot.serverTime,
      playback: { ...snapshot.playback },
      tracks: snapshot.tracks.map(track => ({ ...track })),
    };
    const track = safe.tracks.find(item => item.id === safe.playback.trackId);
    const source = track ? new URL(audioUrl(track.id), this.#audio.ownerDocument.baseURI).href : null;
    const changedSource = source !== this.#source;
    const changedPlayback = safe.playback.playing !== this.#latest?.snapshot.playback.playing;
    if (changedSource || changedPlayback) {
      ++this.#generation;
      this.#attempt = null;
    }
    this.#latest = { snapshot: safe, offset: offsetMs };
    if (changedSource) {
      this.#source = source;
      this.#blocked = null;
      this.#audio.pause();
      if (source) this.#audio.src = source;
      else this.#audio.removeAttribute('src');
      this.#audio.load();
    }
    void this.#synchronize(false);
  }

  disable(): void {
    if (this.#destroyed) return;
    this.#enabled = false;
    this.#blocked = null;
    ++this.#generation;
    this.#attempt = null;
    this.#audio.pause();
    this.#report('Audio off. Click Enable audio to listen.');
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#enabled = false;
    ++this.#generation;
    this.#attempt = null;
    this.#latest = null;
    this.#source = null;
    this.#audio.removeEventListener('loadedmetadata', this.#metadata);
    this.#audio.removeEventListener('canplay', this.#ready);
    this.#audio.removeEventListener('ended', this.#ready);
    this.#audio.removeEventListener('error', this.#error);
    this.#audio.pause();
    this.#audio.removeAttribute('src');
    this.#audio.load();
  }

  #report(message: string): void {
    if (this.#destroyed || this.#lastStatus === message) return;
    this.#lastStatus = message;
    try { this.#onStatus(message); } catch { /* A status consumer cannot escape through media events. */ }
  }

  #block(message: string): void {
    this.#enabled = false;
    ++this.#generation;
    this.#attempt = null;
    this.#blocked = message;
    this.#audio.pause();
    this.#report(message);
  }

  #shouldPlay(): boolean {
    return !this.#destroyed && this.#enabled && !!this.#source && this.#latest?.snapshot.playback.playing === true;
  }

  #synchronize(force: boolean): Promise<void> {
    if (this.#destroyed) return Promise.resolve();
    const latest = this.#latest;
    if (!latest || !this.#source) {
      this.#audio.pause();
      this.#report(this.#enabled ? 'Waiting for a track in this room.' : 'Audio off. Click Enable audio to listen.');
      return Promise.resolve();
    }
    if (this.#audio.readyState < 1 || this.#audio.currentSrc !== this.#source) {
      if (!this.#shouldPlay()) this.#audio.pause();
      this.#report(this.#blocked || (this.#enabled ? 'Waiting for audio to load…' : 'Audio off. Click Enable audio to listen.'));
      return Promise.resolve();
    }
    const track = latest.snapshot.tracks.find(item => item.id === latest.snapshot.playback.trackId)!;
    const duration = Number.isFinite(this.#audio.duration) ? Math.min(track.duration, this.#audio.duration) : track.duration;
    const target = Math.min(duration, estimatedPosition(latest.snapshot, Date.now() + latest.offset));
    try {
      if (force || Math.abs(this.#audio.currentTime - target) > .35) this.#audio.currentTime = target;
    } catch {
      this.#block('Audio could not seek. Check the local connection and click Enable audio to retry.');
      return Promise.resolve();
    }
    if (!this.#enabled) {
      this.#audio.pause();
      this.#report(this.#blocked || 'Audio off. Click Enable audio to listen.');
      return Promise.resolve();
    }
    if (!latest.snapshot.playback.playing) {
      this.#audio.pause();
      this.#report('Audio ready. Shared playback is paused.');
      return Promise.resolve();
    }
    if (target >= duration || (this.#audio.ended && target >= duration - .35)) {
      this.#audio.pause();
      this.#report('Audio ready. Waiting for the room’s next track.');
      return Promise.resolve();
    }
    if (!this.#audio.paused) {
      this.#report('Audio ready. Following the shared room.');
      return Promise.resolve();
    }
    if (this.#attempt?.generation === this.#generation) return this.#attempt.promise;
    const generation = this.#generation;
    let playing: Promise<void>;
    try { playing = this.#audio.play(); }
    catch { this.#block('Could not play audio. Click Enable audio to retry.'); return Promise.resolve(); }
    const attempt: PlayAttempt = {
      generation,
      promise: playing.then(() => {
        if (generation !== this.#generation || !this.#shouldPlay()) {
          if (!this.#shouldPlay()) this.#audio.pause();
          return;
        }
        this.#report('Audio ready. Following the shared room.');
      }, error => {
        if (generation !== this.#generation || !this.#shouldPlay()) return;
        this.#block(error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Audio is blocked by the browser. Click Enable audio to listen.'
          : 'Could not play audio. Check the local connection and click Enable audio to retry.');
      }).then(() => { if (this.#attempt === attempt) this.#attempt = null; }),
    };
    this.#attempt = attempt;
    return attempt.promise;
  }
}
