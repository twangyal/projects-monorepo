import { backedFramePlan, type BackedFramePlan } from './backing.ts';
import type { BackedFrameCapture } from './backed-frames.ts';

export const BACKED_PROCESSOR_NAME = 'melody-backed-capture';
export async function backedWorkletUrl(): Promise<string> {
  const module = await import('./backed-capture.worklet.ts?worker&url');
  return module.default;
}
export type BackedCapture = BackedFrameCapture;
export type BackedProgress =
  | { phase: 'requesting' | 'preparing' }
  | { phase: 'counting-in'; beat: 1 | 2 | 3 | 4 }
  | { phase: 'recording'; framesCaptured: number; sampleRate: number };
export interface BackedRecorderOptions {
  context: AudioContext; backing: Float32Array; tempo: number; signal: AbortSignal;
  onProgress: (progress: BackedProgress) => void; setupDeadline?: number;
}
export interface BackedRecorderDependencies {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  moduleUrl: () => Promise<string>;
  createNode: (context: AudioContext) => AudioWorkletNode;
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (timer: unknown) => void;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
type Pending<T> = ReturnType<typeof deferred<T>>;
interface Session {
  options: BackedRecorderOptions; backing: Float32Array<ArrayBuffer>; deadline: number;
  done: Pending<BackedCapture | null>; ready: Pending<void>; armedReply: Pending<void>;
  retired: boolean; armed: boolean; channels: number | null; progressFrames: number; finishFrame: number | null;
  plan: BackedFramePlan | null; stream: MediaStream | null; microphone: MediaStreamAudioSourceNode | null;
  node: AudioWorkletNode | null; sources: AudioBufferSourceNode[]; timer: unknown;
  listeners: Array<() => void>; abort: () => void;
}
const malformed = () => new Error('The microphone capture returned invalid frames. Your prior take is unchanged.');
function fields(value: unknown, names: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === names.length && names.every(name => Object.hasOwn(value, name));
}
function safeFrame(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

/** One microphone/native setup chain; cancellation retires results before draining it. */
export class BackedRecorder {
  readonly #dependencies: BackedRecorderDependencies;
  #session: Session | null = null;
  constructor(dependencies: Partial<BackedRecorderDependencies> = {}) {
    this.#dependencies = {
      getUserMedia: constraints => {
        if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error('Microphone recording requires a supported secure browser.');
        return navigator.mediaDevices.getUserMedia(constraints);
      },
      moduleUrl: backedWorkletUrl,
      createNode: context => new AudioWorkletNode(context, BACKED_PROCESSOR_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }),
      now: () => performance.now(), setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
      clearTimeout: timer => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>), ...dependencies,
    };
  }
  async start(options: BackedRecorderOptions): Promise<BackedCapture | null> {
    if (this.#session) throw new Error('A backed recording or cancelled native setup is already active or draining.');
    const now = this.#dependencies.now(), deadline = options.setupDeadline ?? now + 30000;
    const context = options.context;
    if (!context?.audioWorklet || typeof context.audioWorklet.addModule !== 'function') {
      throw new Error('Record with backing requires AudioWorklet support. Use Record melody instead.');
    }
    if (!(options.backing instanceof Float32Array) || options.backing.length !== 441000
      || !Number.isFinite(deadline) || deadline <= now || deadline > now + 30000
      || !context || !Number.isInteger(context.sampleRate) || context.sampleRate < 8000 || context.sampleRate > 192000
      || !Number.isFinite(options.tempo) || options.tempo < 40 || options.tempo > 240
      || !options.signal || typeof options.onProgress !== 'function' || context.state === 'closed') {
      throw new Error('Choose valid backing audio and a live bounded preparation deadline.');
    }
    for (const sample of options.backing) if (!Number.isFinite(sample)) throw malformed();
    if (options.signal.aborted) return null;
    const capturedOptions = { ...options };
    const session: Session = { options: capturedOptions, backing: new Float32Array(options.backing), deadline,
      done: deferred(), ready: deferred(), armedReply: deferred(), retired: false, armed: false, channels: null,
      progressFrames: 0, finishFrame: null, plan: null, stream: null, microphone: null, node: null, sources: [],
      timer: undefined, listeners: [], abort: () => {} };
    this.#session = session;
    session.abort = () => this.#settle(session, null);
    capturedOptions.signal.addEventListener('abort', session.abort, { once: true });
    this.#timer(session, deadline, 'Microphone preparation took too long. Your prior take is unchanged.');
    try {
      this.#progress(session, { phase: 'requesting' }); this.#checkSetup(session);
      // Invoke resume during the trusted click. Both native promises must drain.
      const permission = this.#dependencies.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      let resume: Promise<void>;
      try { resume = context.resume(); } catch { resume = Promise.reject(new Error('The audio context could not resume.')); }
      const received = Promise.resolve(permission).then(stream => {
        session.stream = stream;
        if (session.retired) { this.#releaseStream(session); return; }
        const tracks = stream.getAudioTracks();
        if (tracks.length !== 1 || tracks[0].readyState !== 'live' || tracks[0].muted) throw new Error('The microphone is unavailable or muted.');
        for (const track of tracks) for (const event of ['ended', 'mute']) {
          const failed = () => this.#settle(session, null, new Error('The microphone was interrupted. Your prior take is unchanged.'));
          track.addEventListener(event, failed);
          session.listeners.push(() => track.removeEventListener(event, failed));
        }
      }).catch(() => { this.#settle(session, null, new Error('Microphone access failed. Check permission and try again.')); });
      const resumed = Promise.resolve(resume).catch(() => { this.#settle(session, null, new Error('The audio context could not resume. Try another explicit recording.')); });
      await Promise.all([received, resumed]); this.#checkSetup(session);
      if (context.state !== 'running') throw new Error('The audio context is not running.');
      this.#progress(session, { phase: 'preparing' }); this.#checkSetup(session);
      const moduleUrl = await this.#dependencies.moduleUrl(); this.#checkSetup(session);
      await context.audioWorklet.addModule(moduleUrl); this.#checkSetup(session);
      if (context.state !== 'running') throw new Error('The audio context was interrupted.');
      const changed = () => { if (context.state !== 'running') this.#settle(session, null, new Error('The audio context was interrupted. Your prior take is unchanged.')); };
      context.addEventListener('statechange', changed);
      session.listeners.push(() => context.removeEventListener('statechange', changed));
      session.node = this.#dependencies.createNode(context);
      session.node.port.onmessage = event => this.#message(session, event.data);
      session.node.onprocessorerror = () => this.#settle(session, null, new Error('Microphone audio processing failed. Your prior take is unchanged.'));
      session.microphone = context.createMediaStreamSource(session.stream!);
      session.microphone.connect(session.node); session.node.connect(context.destination);
      await session.ready.promise; this.#checkSetup(session);
      session.plan = backedFramePlan(context.sampleRate, capturedOptions.tempo, context.currentTime);
      this.#prepareSources(session);
      session.node.port.postMessage({ type: 'arm', startFrame: session.plan.startFrame, limitFrame: session.plan.limitFrame });
      await session.armedReply.promise; this.#checkSetup(session);
      if (Math.floor(context.currentTime * context.sampleRate) >= session.plan.countInFrame) {
        throw new Error('Audio preparation missed the count-in start. Retry explicitly.');
      }
      this.#timer(session, this.#dependencies.now() + 30000, 'Microphone capture took too long. Your prior take is unchanged.');
      this.#progress(session, { phase: 'counting-in', beat: 1 });
      if (session.retired) return await session.done.promise;
      this.#checkCapture(session);
      const plan = session.plan;
      for (let index = 0; index < session.sources.length; index++) {
        this.#checkCapture(session);
        if (Math.floor(context.currentTime * context.sampleRate) >= plan.countInFrame) throw new Error('Audio preparation missed the count-in start. Retry explicitly.');
        const source = session.sources[index];
        source.start((index === 0 ? plan.startFrame : plan.clickFrames[index - 1]) / context.sampleRate);
        source.stop(plan.limitFrame / context.sampleRate);
      }
      return await session.done.promise;
    } catch (error) {
      if (!session.retired) this.#settle(session, null, error instanceof Error ? error : new Error('Backed recording failed. Your prior take is unchanged.'));
      return await session.done.promise;
    } finally {
      this.#cleanup(session);
      if (this.#session === session) this.#session = null;
    }
  }
  finish(): void {
    const session = this.#session;
    if (!session || session.retired || session.finishFrame !== null) return;
    if (!session.plan || !session.armed) { this.#settle(session, null); return; }
    try {
      this.#checkCapture(session);
      const frame = Math.min(session.plan.limitFrame, Math.floor(session.options.context.currentTime * session.plan.sampleRate));
      if (!safeFrame(frame)) throw malformed();
      if (frame <= session.plan.startFrame) { this.#settle(session, null); return; }
      session.finishFrame = frame;
      session.node!.port.postMessage({ type: 'finish', stopFrame: frame });
    } catch (error) { this.#settle(session, null, error instanceof Error ? error : malformed()); }
  }
  cancel(): void { if (this.#session) this.#settle(this.#session, null); }
  #timer(session: Session, deadline: number, message: string): void {
    if (session.timer !== undefined) this.#dependencies.clearTimeout(session.timer);
    session.deadline = deadline;
    session.timer = this.#dependencies.setTimeout(() => this.#settle(session, null, new Error(message)), Math.max(0, deadline - this.#dependencies.now()));
  }
  #checkSetup(session: Session): void {
    if (session.retired) throw new Error('Capture retired.');
    if (session.options.signal.aborted) { this.#settle(session, null); throw new Error('Capture retired.'); }
    if (this.#dependencies.now() >= session.deadline) {
      const error = new Error('Microphone preparation took too long. Your prior take is unchanged.');
      this.#settle(session, null, error); throw error;
    }
  }
  #checkCapture(session: Session): void {
    this.#checkSetup(session);
    if (session.options.context.state !== 'running') throw new Error('The audio context was interrupted.');
  }
  #progress(session: Session, progress: BackedProgress): void {
    if (session.retired) return;
    try { session.options.onProgress(progress); }
    catch { this.#settle(session, null, new Error('Recording status failed. Your prior take is unchanged.')); }
  }
  #prepareSources(session: Session): void {
    const context = session.options.context;
    const buffer = context.createBuffer(1, 441000, 22050); buffer.copyToChannel(session.backing, 0);
    const backing = context.createBufferSource(); session.sources.push(backing); backing.buffer = buffer; backing.connect(context.destination);
    for (let beat = 0; beat < 4; beat++) {
      const samples = new Float32Array(Math.round(.025 * 22050)), frequency = beat === 0 ? 1500 : 1000;
      for (let index = 0; index < samples.length; index++) {
        const seconds = index / 22050;
        const envelope = Math.max(0, Math.min(1, seconds / .005, (.025 - seconds) / .02));
        samples[index] = .15 * envelope * Math.sin(2 * Math.PI * frequency * seconds);
      }
      const click = context.createBuffer(1, samples.length, 22050); click.copyToChannel(samples, 0);
      const source = context.createBufferSource(); session.sources.push(source); source.buffer = click; source.connect(context.destination);
    }
  }
  #message(session: Session, value: unknown): void {
    if (session.retired) return;
    try {
      this.#checkCapture(session);
      if (!value || typeof value !== 'object') throw malformed();
      const message = value as Record<string, unknown>;
      if (message.type === 'ready') {
        if (!fields(message, ['type', 'sampleRate', 'channels']) || session.channels !== null
          || message.sampleRate !== session.options.context.sampleRate || !Number.isInteger(message.channels)
          || (message.channels as number) < 1 || (message.channels as number) > 32) throw malformed();
        session.channels = message.channels as number; session.ready.resolve();
      } else if (message.type === 'armed') {
        if (!fields(message, ['type', 'startFrame', 'limitFrame']) || !session.plan || session.armed
          || message.startFrame !== session.plan.startFrame || message.limitFrame !== session.plan.limitFrame) throw malformed();
        session.armed = true; session.armedReply.resolve();
      } else if (message.type === 'progress') {
        if (!fields(message, ['type', 'phase', 'framesCaptured']) || !session.plan || !session.armed
          || !safeFrame(message.framesCaptured) || message.framesCaptured < session.progressFrames || message.framesCaptured > session.plan.maxFrames
          || !['counting-in', 'recording'].includes(message.phase as string)) throw malformed();
        session.progressFrames = message.framesCaptured;
        if (session.finishFrame !== null) return;
        if (message.phase === 'recording') this.#progress(session, { phase: 'recording', framesCaptured: message.framesCaptured, sampleRate: session.plan.sampleRate });
        else {
          const frame = Math.floor(session.options.context.currentTime * session.plan.sampleRate);
          const beat = Math.max(1, Math.min(4, session.plan.clickFrames.filter(onset => onset <= frame).length)) as 1 | 2 | 3 | 4;
          this.#progress(session, { phase: 'counting-in', beat });
        }
      } else if (message.type === 'complete') {
        if (!fields(message, ['type', 'sampleRate', 'channels', 'startFrame', 'endFrame', 'samples']) || !session.plan || !session.armed
          || message.sampleRate !== session.plan.sampleRate || message.channels !== session.channels || message.startFrame !== session.plan.startFrame
          || !safeFrame(message.endFrame) || message.endFrame > session.plan.limitFrame || !(message.samples instanceof Float32Array)
          || !(message.samples.buffer instanceof ArrayBuffer) || message.samples.length < 1 || message.samples.length > session.plan.maxFrames
          || message.startFrame + message.samples.length !== message.endFrame) throw malformed();
        for (const sample of message.samples) if (!Number.isFinite(sample)) throw malformed();
        const wanted = session.finishFrame ?? session.plan.limitFrame;
        if (message.endFrame < wanted) throw malformed();
        const samples = new Float32Array(message.samples.subarray(0, wanted - session.plan.startFrame));
        this.#checkCapture(session);
        this.#settle(session, { samples, sampleRate: session.plan.sampleRate, channels: session.channels!, startFrame: session.plan.startFrame, endFrame: wanted });
      } else if (message.type === 'error') throw new Error('The microphone capture failed. Your prior take is unchanged.');
      else throw malformed();
    } catch (error) { this.#settle(session, null, error instanceof Error ? error : malformed()); }
  }
  #releaseStream(session: Session): void {
    const stream = session.stream; session.stream = null;
    if (stream) for (const track of stream.getTracks()) { try { track.stop(); } catch { /* Release every owned track. */ } }
  }
  #cleanup(session: Session): void {
    if (session.timer !== undefined) { this.#dependencies.clearTimeout(session.timer); session.timer = undefined; }
    session.options.signal.removeEventListener('abort', session.abort);
    for (const remove of session.listeners.splice(0)) remove();
    if (session.node) {
      session.node.port.onmessage = null; session.node.onprocessorerror = null;
      try { session.node.port.postMessage({ type: 'cancel' }); } catch { /* Already retired. */ }
      session.node.port.close(); try { session.node.disconnect(); } catch { /* Already disconnected. */ }
      session.node = null;
    }
    if (session.microphone) { try { session.microphone.disconnect(); } catch { /* Already disconnected. */ } session.microphone = null; }
    for (const source of session.sources.splice(0)) { source.onended = null; try { source.stop(); } catch { /* Already ended. */ } try { source.disconnect(); } catch { /* Already disconnected. */ } }
    this.#releaseStream(session);
  }
  #settle(session: Session, value: BackedCapture | null, error?: Error): void {
    if (session.retired) return;
    session.retired = true;
    this.#cleanup(session);
    session.ready.reject(error ?? new Error('Capture cancelled.')); session.armedReply.reject(error ?? new Error('Capture cancelled.'));
    if (error) session.done.reject(error); else session.done.resolve(value);
  }
}
