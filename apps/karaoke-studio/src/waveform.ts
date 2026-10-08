export interface WaveformPeaks {
  frameCount: number;
  sampleRate: 44100;
  binFrames: 441;
  minima: Int16Array;
  maxima: Int16Array;
}

export interface WaveformWorkerRequest {
  projectId: string;
  duration: number;
}

export type WaveformWorkerReply =
  | { type: 'progress'; framesRead: number; totalFrames: number }
  | { type: 'ready'; peaks: WaveformPeaks }
  | { type: 'error'; message: string };

export const MAX_WAVEFORM_BYTES = 52_924_096;
const MAX_FRAMES = 13_230_000;

/** All messages originate here, rather than in untrusted media or responses. */
export class WaveformError extends Error {}

function fail(message: string): never { throw new WaveformError(message); }

export class Pcm16PeakReducer {
  readonly #total: number;
  readonly #minima: Int16Array;
  readonly #maxima: Int16Array;
  readonly #carry = new Uint8Array(4);
  #carryBytes = 0;
  #bytesRead = 0;
  #framesRead = 0;
  #closed = false;

  constructor(frameCount: number) {
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > MAX_FRAMES) {
      fail('Waveform frame count exceeds the supported limit.');
    }
    this.#total = frameCount;
    this.#minima = new Int16Array(Math.ceil(frameCount / 441)).fill(32767);
    this.#maxima = new Int16Array(this.#minima.length).fill(-32768);
  }
  get framesRead(): number { return this.#framesRead; }
  get totalFrames(): number { return this.#total; }

  #frame(data: Uint8Array, offset: number): void {
    const left = ((data[offset] | data[offset + 1] << 8) << 16) >> 16;
    const right = ((data[offset + 2] | data[offset + 3] << 8) << 16) >> 16;
    const bin = Math.floor(this.#framesRead / 441);
    this.#minima[bin] = Math.min(this.#minima[bin], left, right);
    this.#maxima[bin] = Math.max(this.#maxima[bin], left, right);
    this.#framesRead++;
  }

  push(chunk: Uint8Array): void {
    if (this.#closed) fail('Waveform reducer is finished or failed.');
    try {
      if (!(chunk instanceof Uint8Array)) fail('Waveform samples must be bytes.');
      if (this.#bytesRead + chunk.length > this.#total * 4) fail('Waveform data exceeds its declared length.');
      this.#bytesRead += chunk.length;
      let offset = 0;
      if (this.#carryBytes) {
        const count = Math.min(4 - this.#carryBytes, chunk.length);
        this.#carry.set(chunk.subarray(0, count), this.#carryBytes);
        this.#carryBytes += count;
        offset = count;
        if (this.#carryBytes === 4) { this.#frame(this.#carry, 0); this.#carryBytes = 0; }
      }
      while (offset + 4 <= chunk.length) { this.#frame(chunk, offset); offset += 4; }
      if (offset < chunk.length) {
        this.#carryBytes = chunk.length - offset;
        this.#carry.set(chunk.subarray(offset));
      }
    } catch (error) { this.#closed = true; throw error; }
  }

  finish(): WaveformPeaks {
    if (this.#closed) fail('Waveform reducer is finished or failed.');
    this.#closed = true;
    if (this.#bytesRead !== this.#total * 4 || this.#carryBytes || this.#framesRead !== this.#total) {
      fail('Waveform data is truncated or does not contain complete stereo frames.');
    }
    return { frameCount: this.#total, sampleRate: 44100, binFrames: 441, minima: this.#minima, maxima: this.#maxima };
  }
}

type Stage = 'riff' | 'header' | 'format' | 'data' | 'skip' | 'pad' | 'done';

export class NormalizedWavPeaks {
  readonly #expectedDuration: number;
  readonly #small = new Uint8Array(18);
  #filled = 0;
  #needed = 12;
  #stage: Stage = 'riff';
  #received = 0;
  #position = 0;
  #containerBytes = 0;
  #overhead = 0;
  #chunkCount = 0;
  #remaining = 0;
  #padding = false;
  #formatSeen = false;
  #dataSeen = false;
  #reducer: Pcm16PeakReducer | null = null;
  #closed = false;

  constructor(expectedDuration: number) {
    if (typeof expectedDuration !== 'number' || !Number.isFinite(expectedDuration) || expectedDuration < 1 || expectedDuration > 300) {
      fail('Expected waveform duration must be 1–300 seconds.');
    }
    this.#expectedDuration = expectedDuration;
  }
  get framesRead(): number { return this.#reducer?.framesRead ?? 0; }
  get totalFrames(): number { return this.#reducer?.totalFrames ?? 0; }

  #addOverhead(count: number): void {
    this.#overhead += count;
    if (this.#overhead > 4096) fail('WAV metadata and header overhead exceed the supported limit.');
  }

  #nextChunk(): void {
    if (this.#padding) { this.#stage = 'pad'; return; }
    this.#stage = this.#position === this.#containerBytes ? 'done' : 'header';
    this.#filled = 0;
    this.#needed = 8;
  }

  #riff(): void {
    if (String.fromCharCode(...this.#small.subarray(0, 4)) !== 'RIFF'
      || String.fromCharCode(...this.#small.subarray(8, 12)) !== 'WAVE') {
      fail('Waveform source must be little-endian RIFF/WAVE PCM audio.');
    }
    this.#containerBytes = new DataView(this.#small.buffer).getUint32(4, true) + 8;
    if (this.#containerBytes < 12 || this.#containerBytes > MAX_WAVEFORM_BYTES) {
      fail('WAV container exceeds the supported byte limit.');
    }
    if (this.#received > this.#containerBytes) fail('WAV contains trailing bytes beyond its declared container.');
    this.#stage = 'header'; this.#filled = 0; this.#needed = 8;
  }

  #header(): void {
    const name = String.fromCharCode(...this.#small.subarray(0, 4));
    const size = new DataView(this.#small.buffer).getUint32(4, true);
    this.#padding = (size & 1) !== 0;
    this.#remaining = size;
    this.#chunkCount++;
    if (this.#chunkCount > 512) fail('WAV contains too many chunks.');
    if (this.#position + size + Number(this.#padding) > this.#containerBytes) {
      fail('WAV chunk crosses the declared container length.');
    }
    if (name === 'data') {
      if (!this.#formatSeen || this.#dataSeen) fail('WAV must contain one format chunk before exactly one data chunk.');
      if (size % 4 !== 0) fail('WAV data must contain complete stereo PCM16 frames.');
      const frameCount = size / 4;
      if (frameCount < 44100 || frameCount > MAX_FRAMES) fail('Normalized WAV duration must be 1–300 seconds.');
      const expectedFrames = this.#expectedDuration * 44100;
      const roundoff = Number.EPSILON * Math.max(frameCount, expectedFrames) * 4;
      if (Math.abs(frameCount - expectedFrames) > 1 + roundoff) {
        fail('WAV duration does not match this project. Retry or keep editing with playback.');
      }
      this.#reducer = new Pcm16PeakReducer(frameCount);
      this.#dataSeen = true;
      this.#stage = 'data';
    } else {
      if (this.#overhead + size + Number(this.#padding) > 4096) fail('WAV metadata overhead exceeds the supported limit.');
      if (name === 'fmt ') {
        if (this.#formatSeen || this.#dataSeen || (size !== 16 && size !== 18)) fail('Unsupported or duplicate WAV format chunk.');
        this.#stage = 'format'; this.#filled = 0; this.#needed = size;
      } else this.#stage = 'skip';
    }
    if (size === 0) this.#nextChunk();
  }

  #format(): void {
    const view = new DataView(this.#small.buffer);
    if (view.getUint16(0, true) !== 1 || view.getUint16(2, true) !== 2
      || view.getUint32(4, true) !== 44100 || view.getUint32(8, true) !== 176400
      || view.getUint16(12, true) !== 4 || view.getUint16(14, true) !== 16
      || (this.#needed === 18 && view.getUint16(16, true) !== 0)) {
      fail('Unsupported WAV format. Original audio must be stereo PCM16 at 44.1 kHz.');
    }
    this.#formatSeen = true;
    this.#remaining = 0;
    this.#nextChunk();
  }

  push(chunk: Uint8Array): void {
    if (this.#closed) fail('WAV parser is finished or failed.');
    try {
      if (!(chunk instanceof Uint8Array)) fail('WAV stream must contain bytes.');
      this.#received += chunk.length;
      if (this.#received > MAX_WAVEFORM_BYTES) fail('WAV stream exceeds the supported byte limit.');
      if (this.#containerBytes && this.#received > this.#containerBytes) fail('WAV contains trailing bytes beyond its declared length.');
      let offset = 0;
      while (offset < chunk.length) {
        if (this.#stage === 'done') fail('WAV contains trailing bytes.');
        if (this.#stage === 'riff' || this.#stage === 'header' || this.#stage === 'format') {
          const count = Math.min(this.#needed - this.#filled, chunk.length - offset);
          this.#addOverhead(count);
          this.#small.set(chunk.subarray(offset, offset + count), this.#filled);
          this.#filled += count; this.#position += count; offset += count;
          if (this.#filled === this.#needed) {
            if (this.#stage === 'riff') this.#riff();
            else if (this.#stage === 'header') this.#header();
            else this.#format();
          }
        } else if (this.#stage === 'pad') {
          this.#addOverhead(1); this.#position++; offset++;
          this.#padding = false; this.#nextChunk();
        } else {
          const count = Math.min(this.#remaining, chunk.length - offset);
          if (this.#stage === 'data') this.#reducer!.push(chunk.subarray(offset, offset + count));
          else this.#addOverhead(count);
          this.#remaining -= count; this.#position += count; offset += count;
          if (this.#remaining === 0) this.#nextChunk();
        }
      }
    } catch (error) { this.#closed = true; throw error; }
  }

  finish(): WaveformPeaks {
    if (this.#closed) fail('WAV parser is finished or failed.');
    this.#closed = true;
    if (this.#stage !== 'done' || this.#received !== this.#containerBytes) fail('WAV stream is truncated or incomplete.');
    if (!this.#formatSeen || !this.#dataSeen || !this.#reducer) fail('WAV is missing its format or data chunk.');
    return this.#reducer.finish();
  }
}
