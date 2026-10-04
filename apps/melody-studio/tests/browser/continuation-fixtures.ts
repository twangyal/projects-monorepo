import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import type { Composition, Note } from '../../src/types.ts';

export const STORAGE_KEY = 'melody-studio.project.v1';

// Original test phrase: repeated rising/falling seconds, with no imported style data.
export function phraseFixture(count = 8, tempo = 120): Composition {
  const pitches = [60, 62, 64, 62];
  return {
    version: 1, title: 'Original small steps', tempo,
    tracks: [
      { id: 'phrase-track', name: 'Small steps', instrument: 'triangle', volume: 0.6, muted: false,
        notes: Array.from({ length: count }, (_, i) => ({ id: `phrase-${i}`, pitch: pitches[i % 4],
          start: (count === 8 ? 2 : 0) + i * 0.25, duration: 0.25, velocity: [0.2, 0.4, 0.6, 0.8][i % 4] })) },
      { id: 'other-track', name: 'Unrelated high accent', instrument: 'sawtooth', volume: 0.4, muted: false,
        notes: [{ id: 'unrelated-note', pitch: 84, start: 9, duration: 1, velocity: 0.7 }] },
    ],
  };
}

export async function loadFixture(page: Page, project = phraseFixture()): Promise<void> {
  await page.addInitScript(({ key, value }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, value: project });
  await page.goto('/');
}

export async function savedProject(page: Page): Promise<Composition> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
}

export async function downloadedBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('The browser did not produce a local download.');
  return readFile(path);
}

interface MidiNote { pitch: number; start: number; duration: number; velocity: number }
interface MidiTrack { name: string; program: number | null; notes: MidiNote[] }
export interface DecodedMidi { ticksPerBeat: number; microsecondsPerBeat: number; tracks: MidiTrack[] }

// Independent standard MIDI reader; deliberately never calls the product encoder.
export function decodeMidi(bytes: Uint8Array): DecodedMidi {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, size: number) => String.fromCharCode(...bytes.slice(offset, offset + size));
  if (text(0, 4) !== 'MThd' || view.getUint32(4) !== 6 || view.getUint16(8) !== 1) throw new Error('Expected format-1 MIDI.');
  const trackCount = view.getUint16(10), ticksPerBeat = view.getUint16(12);
  if (!ticksPerBeat || ticksPerBeat & 0x8000) throw new Error('Expected MIDI beat timing.');
  let offset = 14, microsecondsPerBeat = 0;
  const tracks: MidiTrack[] = [];
  for (let index = 0; index < trackCount; index++) {
    if (text(offset, 4) !== 'MTrk') throw new Error('Missing MIDI track chunk.');
    const end = offset + 8 + view.getUint32(offset + 4);
    offset += 8;
    let tick = 0, runningStatus = 0;
    const track: MidiTrack = { name: '', program: null, notes: [] };
    const active = new Map<number, { tick: number; velocity: number }>();
    const variable = () => {
      let value = 0;
      for (let byteCount = 0; byteCount < 4; byteCount++) {
        if (offset >= end) throw new Error('Truncated MIDI variable-length integer.');
        const byte = bytes[offset++];
        value = value * 128 + (byte & 127);
        if (!(byte & 128)) return value;
      }
      throw new Error('Oversized MIDI variable-length integer.');
    };
    while (offset < end) {
      tick += variable();
      let status = bytes[offset];
      if (status & 128) { offset++; if (status < 0xf0) runningStatus = status; }
      else status = runningStatus;
      if (status === 0xff) {
        const type = bytes[offset++], size = variable();
        if (offset + size > end) throw new Error('Truncated MIDI metadata.');
        if (type === 3) track.name = new TextDecoder().decode(bytes.slice(offset, offset + size));
        if (type === 0x51) {
          if (size !== 3) throw new Error('Invalid MIDI tempo.');
          microsecondsPerBeat = bytes[offset] * 65536 + bytes[offset + 1] * 256 + bytes[offset + 2];
        }
        offset += size;
        if (type === 0x2f) break;
      } else if (status >= 0x80 && status < 0xf0) {
        const kind = status & 0xf0, first = bytes[offset++];
        const second = kind === 0xc0 || kind === 0xd0 ? 0 : bytes[offset++];
        if (offset > end) throw new Error('Truncated MIDI channel event.');
        if (kind === 0xc0) track.program = first;
        if (kind === 0x90 && second > 0) active.set(first, { tick, velocity: second });
        else if (kind === 0x80 || kind === 0x90 && second === 0) {
          const onset = active.get(first);
          if (!onset) throw new Error('MIDI note-off has no preceding note-on.');
          track.notes.push({ pitch: first, start: onset.tick / ticksPerBeat,
            duration: (tick - onset.tick) / ticksPerBeat, velocity: onset.velocity });
          active.delete(first);
        }
      } else throw new Error('Unexpected MIDI event.');
    }
    if (active.size) throw new Error('Unclosed MIDI notes.');
    track.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    tracks.push(track);
    offset = end;
  }
  if (offset !== bytes.length || !microsecondsPerBeat) throw new Error('Incomplete MIDI timing or trailing bytes.');
  return { ticksPerBeat, microsecondsPerBeat, tracks };
}

export function expectedMidiNotes(notes: Note[]): MidiNote[] {
  return notes.map(note => ({ pitch: note.pitch, start: note.start, duration: note.duration,
    velocity: Math.max(1, Math.round(note.velocity * 127)) })).sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

export interface DecodedWav { sampleRate: number; samples: Int16Array }
// RIFF chunk parser independent from the product WAV implementation.
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) throw new Error('Invalid WAV container.');
  let offset = 12, sampleRate = 0, data: Int16Array | null = null;
  while (offset + 8 <= bytes.length) {
    const type = text(offset), size = view.getUint32(offset + 4, true), begin = offset + 8;
    if (begin + size > bytes.length) throw new Error('Truncated WAV chunk.');
    if (type === 'fmt ') {
      if (size < 16 || view.getUint16(begin, true) !== 1 || view.getUint16(begin + 2, true) !== 1 || view.getUint16(begin + 14, true) !== 16) throw new Error('Expected mono PCM16 WAV.');
      sampleRate = view.getUint32(begin + 4, true);
    }
    if (type === 'data') {
      if (size % 2) throw new Error('Incomplete PCM16 sample.');
      data = Int16Array.from({ length: size / 2 }, (_, i) => view.getInt16(begin + i * 2, true));
    }
    offset = begin + size + size % 2;
  }
  if (!sampleRate || !data || offset !== bytes.length) throw new Error('Missing WAV format or samples.');
  return { sampleRate, samples: data };
}

export function rmsAt(wav: DecodedWav, seconds: number, duration = 0.02): number {
  const from = Math.floor(seconds * wav.sampleRate), to = Math.min(wav.samples.length, from + Math.floor(duration * wav.sampleRate));
  let energy = 0;
  for (let i = from; i < to; i++) energy += (wav.samples[i] / 32768) ** 2;
  return to > from ? Math.sqrt(energy / (to - from)) : 0;
}

export interface AudioProbeSnapshot {
  requests: { project: Composition; wav: boolean }[];
  replies: { frames: number; peak: number }[];
  starts: { frames: number; sampleRate: number; peak: number }[];
  stopped: number;
  pendingReplies: number;
  pendingResumes: number;
}
interface AudioProbe extends Omit<AudioProbeSnapshot, 'pendingReplies' | 'pendingResumes'> {
  holdReplies: boolean;
  holdResume: boolean;
  pending: (() => void)[];
  resumes: (() => void)[];
  endCallbacks: (() => void)[];
  releaseNext(): void;
  releaseAll(): void;
  releaseResume(): void;
}
type ProbeWindow = Window & typeof globalThis & { __continuationAudioProbe: AudioProbe };

// Observe actual synthesis, actual AudioContext and actual source starts. Only
// delivery of already-completed native work is held for race regressions.
export async function installAudioProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: AudioProbe = {
      requests: [], replies: [], starts: [], stopped: 0, holdReplies: false, holdResume: false,
      pending: [], resumes: [], endCallbacks: [],
      releaseNext() { this.pending.shift()?.(); },
      releaseAll() { this.holdReplies = false; for (const deliver of this.pending.splice(0)) deliver(); },
      releaseResume() { this.holdResume = false; for (const resume of this.resumes.splice(0)) resume(); },
    };
    (window as ProbeWindow).__continuationAudioProbe = state;
    const peakOf = (values: Float32Array) => {
      let peak = 0;
      for (const value of values) peak = Math.max(peak, Math.abs(value));
      return peak;
    };
    const NativeWorker = window.Worker;
    const messageDescriptor = Object.getOwnPropertyDescriptor(NativeWorker.prototype, 'onmessage')!;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        let handler: ((this: Worker, event: MessageEvent) => unknown) | null = null;
        Object.defineProperty(this, 'onmessage', {
          configurable: true,
          get: () => handler,
          set: (callback: typeof handler) => {
            handler = callback;
            messageDescriptor.set!.call(this, (event: MessageEvent) => {
              if (event.data?.result instanceof Float32Array) {
                state.replies.push({ frames: event.data.result.length, peak: peakOf(event.data.result) });
              }
              const deliver = () => callback?.call(this, event);
              if (state.holdReplies) state.pending.push(deliver);
              else deliver();
            });
          },
        });
      }
      postMessage(message: unknown, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        const payload = message as { project?: Composition; wav?: boolean };
        if (payload?.project) state.requests.push(structuredClone({ project: payload.project, wav: payload.wav === true }));
        if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    };
    const nativeResume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      return nativeResume.call(this).then(() => state.holdResume
        ? new Promise<void>(resolve => state.resumes.push(resolve)) : undefined);
    };
    const nativeStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (when = 0, offset = 0, duration?: number) {
      if (this.buffer) state.starts.push({ frames: this.buffer.length, sampleRate: this.buffer.sampleRate,
        peak: peakOf(this.buffer.getChannelData(0)) });
      const onended = this.onended;
      if (onended) state.endCallbacks.push(() => onended.call(this, new Event('ended')));
      if (duration === undefined) nativeStart.call(this, when, offset);
      else nativeStart.call(this, when, offset, duration);
    };
    const nativeStop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (when = 0) {
      state.stopped++;
      nativeStop.call(this, when);
    };
  });
}

export function audioProbe(page: Page): Promise<AudioProbeSnapshot> {
  return page.evaluate(() => {
    const state = (window as ProbeWindow).__continuationAudioProbe;
    return { requests: state.requests, replies: state.replies, starts: state.starts, stopped: state.stopped,
      pendingReplies: state.pending.length, pendingResumes: state.resumes.length };
  });
}

export async function controlProbe(page: Page, action: 'holdReplies' | 'holdResume' | 'releaseNext' | 'releaseAll' | 'releaseResume' | 'oldEnded'): Promise<void> {
  await page.evaluate(action => {
    const state = (window as ProbeWindow).__continuationAudioProbe;
    if (action === 'holdReplies' || action === 'holdResume') state[action] = true;
    else if (action === 'oldEnded') state.endCallbacks[0]?.();
    else state[action]();
  }, action);
}
