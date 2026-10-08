/** Dry microphone data in one contiguous absolute audio-graph frame interval. */
export interface BackedFrameCapture {
  samples: Float32Array<ArrayBuffer>;
  sampleRate: number;
  channels: number;
  startFrame: number;
  endFrame: number;
}

function safeFrame(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
function invalid(): never {
  throw new Error('Microphone frames are missing, changed or outside the supported recording bounds.');
}

/** No synthesis, clocks or project state: the caller supplies real graph blocks. */
export class BackedFrames {
  readonly #sampleRate: number;
  readonly #maximum: number;
  #buffer: Float32Array<ArrayBuffer> | null;
  #channels: number | null = null;
  #lastEnd: number | null = null;
  #start: number | null = null;
  #limit: number | null = null;
  #cutoff: number | null = null;
  #captured = 0;
  #terminal = false;

  constructor(sampleRate: number) {
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) invalid();
    this.#sampleRate = sampleRate;
    this.#maximum = Math.floor(20 * sampleRate);
    this.#buffer = new Float32Array(this.#maximum);
  }
  get channels(): number | null { return this.#channels; }
  get framesCaptured(): number { return this.#captured; }
  get terminal(): boolean { return this.#terminal; }

  arm(startFrame: number, limitFrame: number): void {
    if (this.#terminal || this.#start !== null || !safeFrame(startFrame) || !safeFrame(limitFrame)
      || limitFrame <= startFrame || limitFrame - startFrame > this.#maximum
      || this.#lastEnd !== null && startFrame < this.#lastEnd) invalid();
    this.#start = startFrame;
    this.#limit = limitFrame;
  }

  push(blockStartFrame: number, channels: readonly Float32Array[]): BackedFrameCapture | null {
    if (this.#terminal) return null;
    if (!safeFrame(blockStartFrame) || !Array.isArray(channels) || Object.getPrototypeOf(channels) !== Array.prototype
      || channels.length < 1 || channels.length > 32 || Reflect.ownKeys(channels).length !== channels.length + 1) invalid();
    let length = 0;
    // Validate the complete block before changing topology, cursor or retained samples.
    for (let channel = 0; channel < channels.length; channel++) {
      const descriptor = Object.getOwnPropertyDescriptor(channels, String(channel));
      if (!descriptor || !('value' in descriptor)) invalid();
      const input: unknown = descriptor.value;
      if (!(input instanceof Float32Array) || Object.getPrototypeOf(input) !== Float32Array.prototype
        || ['length', 'byteLength', 'byteOffset', 'buffer'].some(key => Object.hasOwn(input, key))
        || !(input.buffer instanceof ArrayBuffer) || input.length < 1 || input.length > this.#maximum) invalid();
      if (channel === 0) length = input.length;
      else if (input.length !== length) invalid();
      for (let index = 0; index < input.length; index++) if (!Number.isFinite(input[index])) invalid();
    }
    const blockEnd = blockStartFrame + length;
    // Readiness may skip graph quanta before scheduling exists; never overlap or
    // move backward. Once armed, count-in and capture share one contiguous clock.
    if (!safeFrame(blockEnd) || this.#lastEnd !== null
        && (this.#start === null ? blockStartFrame < this.#lastEnd : blockStartFrame !== this.#lastEnd)
      || this.#channels !== null && channels.length !== this.#channels
      || this.#start !== null && this.#lastEnd === null && blockStartFrame > this.#start) invalid();

    const cutoff = this.#cutoff ?? this.#limit;
    const from = this.#start === null ? 0 : Math.max(blockStartFrame, this.#start);
    const to = cutoff === null ? 0 : Math.min(blockEnd, cutoff);
    if (to > from && (this.#start === null || from !== this.#start + this.#captured)) invalid();
    if (to > from) {
      const buffer = this.#buffer!;
      for (let frame = from; frame < to; frame++) {
        let mono = 0;
        for (let channel = 0; channel < channels.length; channel++) mono += channels[channel][frame - blockStartFrame];
        buffer[this.#captured + frame - from] = mono / channels.length;
      }
      this.#captured += to - from;
    }
    this.#channels = channels.length;
    this.#lastEnd = blockEnd;
    return cutoff !== null && blockEnd >= cutoff ? this.#complete() : null;
  }

  finish(stopFrame: number): BackedFrameCapture | null {
    if (this.#terminal || this.#cutoff !== null) return null;
    if (!safeFrame(stopFrame)) invalid();
    if (this.#start === null || stopFrame <= this.#start) {
      this.cancel();
      return null;
    }
    this.#cutoff = Math.min(this.#limit!, stopFrame);
    const wanted = this.#cutoff - this.#start;
    if (this.#captured < wanted) return null;
    this.#captured = wanted;
    return this.#complete();
  }

  cancel(): void {
    this.#terminal = true;
    this.#buffer = null;
    this.#captured = 0;
  }

  #complete(): BackedFrameCapture | null {
    if (!this.#captured) { this.cancel(); return null; }
    const buffer = this.#buffer!;
    const samples = this.#captured === buffer.length ? buffer : buffer.slice(0, this.#captured);
    this.#buffer = null;
    this.#terminal = true;
    return { samples, sampleRate: this.#sampleRate, channels: this.#channels!,
      startFrame: this.#start!, endFrame: this.#start! + this.#captured };
  }
}
