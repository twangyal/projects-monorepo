import { BackedFrames, type BackedFrameCapture } from './backed-frames.ts';
import { BackedFrameError, type BackedFailureReason } from './backed-failure.ts';

declare const sampleRate: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

class BackedCaptureProcessor extends AudioWorkletProcessor {
  readonly #frames = new BackedFrames(sampleRate);
  #ready = false;
  #armed = false;
  #terminal = false;
  #startFrame = 0;
  #progressAt = 0;
  constructor() {
    super();
    this.port.onmessage = event => {
      if (this.#terminal) return;
      try {
        const message: unknown = event.data;
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error();
        const value = message as Record<string, unknown>, keys = Object.keys(value);
        if (value.type === 'cancel' && keys.length === 1) { this.#frames.cancel(); this.#terminal = true; this.port.onmessage = null; }
        else if (value.type === 'arm' && keys.length === 3 && Object.hasOwn(value, 'startFrame') && Object.hasOwn(value, 'limitFrame') && this.#ready) {
          this.#frames.arm(value.startFrame as number, value.limitFrame as number); this.#armed = true; this.#startFrame = value.startFrame as number;
          this.port.postMessage({ type: 'armed', startFrame: value.startFrame, limitFrame: value.limitFrame });
        } else if (value.type === 'finish' && keys.length === 2 && Object.hasOwn(value, 'stopFrame')) {
          const result = this.#frames.finish(value.stopFrame as number);
          if (result) this.#complete(result);
          else if (this.#frames.terminal) { this.#terminal = true; this.port.onmessage = null; }
        } else throw new Error();
      } catch (error) { this.#fail(error instanceof BackedFrameError ? error.reason : 'invalid-command'); }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.#terminal) return false;
    try {
      const input = inputs[0];
      if (!input || input.length === 0) {
        if (this.#ready) throw new BackedFrameError('missing-input');
        return true;
      }
      const result = this.#frames.push(currentFrame, input);
      if (!this.#ready) {
        this.#ready = true;
        this.port.postMessage({ type: 'ready', sampleRate, channels: this.#frames.channels });
      }
      if (result) this.#complete(result);
      else if (this.#armed && currentFrame >= this.#progressAt) {
        this.#progressAt = currentFrame + Math.ceil(sampleRate / 10);
        this.port.postMessage({ type: 'progress', phase: currentFrame < this.#startFrame ? 'counting-in' : 'recording', framesCaptured: this.#frames.framesCaptured });
      }
      return !this.#terminal;
    } catch (error) { this.#fail(error instanceof BackedFrameError ? error.reason : 'invalid-input'); return false; }
  }
  #complete(result: BackedFrameCapture): void {
    this.#terminal = true; this.port.onmessage = null;
    this.port.postMessage({ type: 'complete', ...result }, [result.samples.buffer]);
  }
  #fail(reason: BackedFailureReason): void {
    if (this.#terminal) return;
    this.#frames.cancel(); this.#terminal = true; this.port.onmessage = null;
    this.port.postMessage({ type: 'error', reason });
  }
}
registerProcessor('melody-backed-capture', BackedCaptureProcessor);
