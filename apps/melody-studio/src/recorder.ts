export interface RecorderDevice {
  readonly state: RecordingState;
  readonly mimeType: string;
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  start(): void;
  stop(): void;
}

export interface RecorderDependencies {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createMediaRecorder: (stream: MediaStream) => RecorderDevice;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}

export type RecorderState = 'idle' | 'requesting' | 'recording' | 'stopping';

interface Session {
  generation: number;
  stream: MediaStream;
  recorder: RecorderDevice;
  chunks: Blob[];
  result: Promise<Blob | null>;
  resolve: (blob: Blob | null) => void;
  reject: (error: Error) => void;
  timer: unknown;
  timed: boolean;
  released: boolean;
  finished: boolean;
  started: boolean;
  onError: ((error: Error) => void) | undefined;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error('Microphone recording failed.');
}

function releaseStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/** Browser recording with an explicit cancellation boundary around microphone permission. */
export class MelodyRecorder {
  #state: RecorderState = 'idle';
  #generation = 0;
  #session: Session | null = null;
  #failure: Error | null = null;
  readonly #dependencies: RecorderDependencies;

  constructor(dependencies: Partial<RecorderDependencies> = {}) {
    this.#dependencies = {
      getUserMedia: constraints => {
        if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
          throw new Error('Microphone recording requires a supported browser and a secure connection.');
        }
        return navigator.mediaDevices.getUserMedia(constraints);
      },
      createMediaRecorder: stream => {
        if (typeof globalThis.MediaRecorder !== 'function') {
          throw new Error('Audio recording is not supported by this browser.');
        }
        return new MediaRecorder(stream);
      },
      setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>),
      ...dependencies,
    };
  }

  get state(): RecorderState { return this.#state; }

  /** onLimit receives automatic completions, including an unexpected input-stream stop. */
  async start(onLimit: (blob: Blob) => void, onError?: (error: Error) => void): Promise<void> {
    if (this.#state !== 'idle') throw new Error('A microphone recording is already in progress.');
    const generation = ++this.#generation;
    this.#failure = null;
    this.#state = 'requesting';
    let stream: MediaStream;
    try {
      stream = await this.#dependencies.getUserMedia({ audio: true });
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#state = 'idle';
      throw asError(error);
    }
    if (generation !== this.#generation) {
      releaseStream(stream);
      return;
    }

    let session: Session | null = null;
    try {
      const recorder = this.#dependencies.createMediaRecorder(stream);
      let resolve!: Session['resolve'];
      let reject!: Session['reject'];
      const result = new Promise<Blob | null>((yes, no) => { resolve = yes; reject = no; });
      // Recorder failures can occur before a caller requests stop. Keep the rejection
      // handled internally; stop() still exposes the original rejection to its caller.
      void result.catch(() => {});
      session = {
        generation, stream, recorder, chunks: [], result, resolve, reject, onError,
        timer: undefined, timed: false, released: false, finished: false,
        started: false,
      };
      const active = session;
      this.#session = active;
      recorder.ondataavailable = event => {
        if (!active.finished && event.data.size > 0) active.chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (!active.finished) {
          const automatic = this.#session === active && this.#state === 'recording';
          const blob = new Blob(active.chunks, { type: recorder.mimeType || 'audio/webm' });
          if (automatic && blob.size === 0) {
            this.#fail(active, new Error('The microphone stopped before any audio was captured.'));
            return;
          }
          this.#finish(active, blob);
          if (automatic) {
            void Promise.resolve().then(() => {
              if (generation === this.#generation) return onLimit(blob);
            }).catch(() => {});
          }
        }
      };
      recorder.onerror = event => {
        this.#fail(active, asError(event.error));
      };
      this.#state = 'recording';
      recorder.start();
      if (!active.finished) {
        active.timer = this.#dependencies.setTimeout(() => {
          if (this.#session !== active || active.finished) return;
          // Cancellation and a newer start both invalidate deferred cap delivery.
          void this.stop().then(blob => {
            if (blob && generation === this.#generation) onLimit(blob);
          }).catch(() => {});
        }, 20_000);
        active.timed = true;
        active.started = true;
      } else if (this.#failure) {
        throw this.#failure;
      }
    } catch (error) {
      const failure = asError(error);
      if (session) this.#fail(session, failure);
      else {
        releaseStream(stream);
        this.#state = 'idle';
        this.#failure = failure;
      }
      throw failure;
    }
  }

  stop(): Promise<Blob | null> {
    if (this.#state === 'requesting') {
      this.cancel();
      return Promise.resolve(null);
    }
    const session = this.#session;
    if (!session) return this.#failure ? Promise.reject(this.#failure) : Promise.resolve(null);
    if (this.#state === 'stopping') return session.result;
    this.#state = 'stopping';
    this.#clearTimer(session);
    try {
      session.recorder.stop();
    } catch (error) {
      this.#fail(session, asError(error));
    } finally {
      this.#release(session);
    }
    return session.result;
  }

  cancel(): void {
    ++this.#generation;
    this.#failure = null;
    const session = this.#session;
    if (session) {
      this.#finish(session, null);
      this.#stopDevice(session);
    }
    this.#state = 'idle';
  }

  #clearTimer(session: Session): void {
    if (session.timed) {
      this.#dependencies.clearTimeout(session.timer);
      session.timed = false;
    }
  }

  #release(session: Session): void {
    if (!session.released) {
      session.released = true;
      releaseStream(session.stream);
    }
  }

  #stopDevice(session: Session): void {
    if (session.recorder.state !== 'inactive') {
      try { session.recorder.stop(); } catch { /* Tracks have already been released. */ }
    }
  }

  #finish(session: Session, blob: Blob | null, error?: Error): void {
    if (session.finished) return;
    session.finished = true;
    this.#clearTimer(session);
    this.#release(session);
    session.recorder.ondataavailable = null;
    session.recorder.onstop = null;
    session.recorder.onerror = null;
    session.chunks = [];
    if (this.#session === session) {
      this.#session = null;
      this.#state = 'idle';
      this.#failure = error ?? null;
    }
    if (error) session.reject(error);
    else session.resolve(blob);
  }

  #fail(session: Session, error: Error): void {
    if (session.finished) return;
    this.#finish(session, null, error);
    this.#stopDevice(session);
    if (session.started && session.onError) {
      // Defer notifications so cancellation or another start can invalidate an
      // obsolete failure. A consumer callback cannot escape through recorder events.
      void Promise.resolve().then(() => {
        if (session.generation === this.#generation) return session.onError?.(error);
      }).catch(() => {});
    }
  }
}
