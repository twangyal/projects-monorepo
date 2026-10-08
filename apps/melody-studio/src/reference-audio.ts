import { MAX_COMPOSITION_BEATS } from './limits.ts';
import type { Composition } from './types.ts';
import type { MelodyDocument, ReferenceAsset, ReferenceKind, ReferenceWindow } from './reference-types.ts';
import { REFERENCE_LIMITS } from './reference-types.ts';
import { validateAsset, validateDocument } from './reference-project.ts';

const RATE = REFERENCE_LIMITS.sampleRate;
const MAX_SOLO_FRAMES = Math.ceil((MAX_COMPOSITION_BEATS * 60 / 40 + 2) * RATE);
// A cancelled native render cannot be forcibly closed. Retain admission until
// it actually settles, including while the caller's result is already revoked.
let normalizing = false;

function fields(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`Invalid ${label}.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new Error(`Invalid ${label} fields.`);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`Invalid ${label} fields.`);
    result[key] = descriptor.value;
  }
  return result;
}

function frameCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > REFERENCE_LIMITS.frames) {
    throw new Error('Reference frame count must be between 1 and 441000.');
  }
}

function checkedWindow(value: ReferenceWindow, frames: number): ReferenceWindow {
  const window = fields(value, ['startFrame', 'endFrame'], 'reference window');
  const { startFrame, endFrame } = window;
  if (typeof startFrame !== 'number' || typeof endFrame !== 'number'
    || !Number.isInteger(startFrame) || !Number.isInteger(endFrame)
    || startFrame < 0 || startFrame >= endFrame || endFrame > frames) {
    throw new Error('Choose a nonempty comparison window within the reference.');
  }
  return { startFrame: startFrame === 0 ? 0 : startFrame, endFrame };
}

function pcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
    if (!Number.isFinite(samples[index])) throw new Error('Reference audio must contain only finite samples.');
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

/** Store a lossy, original-speed listen-back copy; analysis keeps its own input. */
export async function normalizeReference(
  samples: Float32Array,
  decodedSampleRate: number,
  meta: { kind: ReferenceKind; captureTempo: number; decodedChannels: number; decodedFrames: number },
  signal: AbortSignal,
): Promise<ReferenceAsset> {
  if (!(samples instanceof Float32Array)) throw new Error('Reference input must be mono Float32 samples.');
  if (!Number.isInteger(decodedSampleRate) || decodedSampleRate < 8000 || decodedSampleRate > 192000) {
    throw new Error('Decoded sample rate must be between 8000 and 192000 Hz.');
  }
  const admitted = fields(meta, ['kind', 'captureTempo', 'decodedChannels', 'decodedFrames'], 'reference metadata');
  const { kind, captureTempo, decodedChannels, decodedFrames } = admitted;
  if (kind !== 'microphone' && kind !== 'audio-file' && kind !== 'demo') throw new Error('Invalid reference capture kind.');
  if (typeof captureTempo !== 'number' || !Number.isFinite(captureTempo) || captureTempo < 40 || captureTempo > 240) {
    throw new Error('Reference capture tempo must be between 40 and 240 BPM.');
  }
  if (typeof decodedChannels !== 'number' || !Number.isInteger(decodedChannels)
    || decodedChannels < 1 || decodedChannels > REFERENCE_LIMITS.decodedChannels) {
    throw new Error('Decoded audio must have between 1 and 32 channels.');
  }
  if (typeof decodedFrames !== 'number' || !Number.isInteger(decodedFrames)
    || decodedFrames < 1 || decodedFrames / decodedSampleRate > 20.1) {
    throw new Error('Decoded reference audio must be no longer than 20.1 seconds.');
  }
  const analyzedFrames = Math.min(decodedFrames, Math.floor(decodedSampleRate * REFERENCE_LIMITS.seconds));
  const frames = Math.floor(analyzedFrames * RATE / decodedSampleRate);
  frameCount(frames);
  if (samples.length !== analyzedFrames) throw new Error('Reference samples must match the first analyzed source frames.');
  for (const sample of samples) if (!Number.isFinite(sample)) throw new Error('Reference audio must contain only finite samples.');
  if (!(signal instanceof AbortSignal)) throw new Error('A reference capture cancellation signal is required.');
  if (signal.aborted) throw new DOMException('Reference capture cancelled.', 'AbortError');
  if (normalizing) throw new Error('Previous reference processing is still draining. Wait and retry, or reload if it does not finish.');
  const input = samples.slice();
  normalizing = true;
  let revoked: Error | null = null;
  const abort = () => { revoked ??= new DOMException('Reference capture cancelled.', 'AbortError'); };
  const timeout = () => { revoked ??= new Error('Reference normalization timed out. Wait and retry, or reload if it does not finish.'); };
  const deadline = performance.now() + REFERENCE_LIMITS.operationMs;
  const timer = setTimeout(timeout, REFERENCE_LIMITS.operationMs);
  signal.addEventListener('abort', abort, { once: true });
  let source: AudioBufferSourceNode | null = null;
  function checkOwner(): void {
    if (signal.aborted) abort();
    if (performance.now() >= deadline) timeout();
    if (revoked) throw revoked;
  }
  try {
    checkOwner();
    let normalized = input;
    if (decodedSampleRate !== RATE) {
      try {
        if (typeof globalThis.OfflineAudioContext !== 'function') throw new Error('Native conversion unavailable.');
        const context = new OfflineAudioContext(1, frames, RATE);
        const buffer = context.createBuffer(1, analyzedFrames, decodedSampleRate);
        buffer.copyToChannel(input, 0);
        source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        checkOwner();
        source.start(0);
        // Do not race this promise against abort/timeout: its settlement is the
        // UI's signal that the single native decode/normalization chain drained.
        const rendered = await context.startRendering();
        checkOwner();
        if (rendered.length !== frames || rendered.sampleRate !== RATE || rendered.numberOfChannels !== 1) {
          throw new Error('Invalid native audio shape.');
        }
        normalized = rendered.getChannelData(0);
        if (!(normalized instanceof Float32Array) || normalized.length !== frames) {
          throw new Error('Invalid native audio samples.');
        }
      } catch {
        checkOwner();
        throw new Error('Native reference conversion failed. Try another audio file or supported browser.');
      }
    }
    const pcm = pcm16(normalized);
    checkOwner();
    return validateAsset({ id: crypto.randomUUID(), kind, captureTempo, decodedSampleRate,
      decodedChannels, decodedFrames, analyzedFrames, frameCount: frames, pcm });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    if (source) {
      try { source.stop(); } catch { /* A drained or unstarted node can already be stopped. */ }
      try { source.disconnect(); } catch { /* Cleanup does not replace a conversion result/error. */ }
    }
    normalizing = false;
  }
}

export function referenceWindow(startSeconds: number, endSeconds: number, frames: number): ReferenceWindow {
  frameCount(frames);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) {
    throw new Error('Enter finite comparison start and end seconds.');
  }
  return checkedWindow({ startFrame: Math.round(startSeconds * RATE), endFrame: Math.round(endSeconds * RATE) }, frames);
}

export function referenceSamples(asset: ReferenceAsset, window: ReferenceWindow): Float32Array {
  const checked = validateAsset(asset);
  const { startFrame, endFrame } = checkedWindow(window, checked.frameCount);
  const result = new Float32Array(endFrame - startFrame);
  const view = new DataView(checked.pcm.buffer, checked.pcm.byteOffset, checked.pcm.byteLength);
  for (let index = startFrame; index < endFrame; index++) {
    const value = view.getInt16(index * 2, true);
    result[index - startFrame] = value / (value < 0 ? 32768 : 32767);
  }
  return result;
}

export function comparisonComposition(document: MelodyDocument, trackId: string, asset: ReferenceAsset): Composition {
  const checked = validateDocument(document);
  const reference = validateAsset(asset);
  if (!checked.references.some(binding => binding.trackId === trackId && binding.assetId === reference.id)) {
    throw new Error('The selected track does not have this reference take.');
  }
  const track = checked.composition.tracks.find(item => item.id === trackId);
  if (!track) throw new Error('The selected track no longer exists.');
  return { ...checked.composition, tempo: reference.captureTempo, tracks: [track] };
}

export function cropComparison(samples: Float32Array, window: ReferenceWindow): Float32Array {
  if (!(samples instanceof Float32Array) || samples.length > MAX_SOLO_FRAMES) {
    throw new Error('Comparison audio exceeds the bounded solo composition render.');
  }
  const { startFrame, endFrame } = checkedWindow(window, REFERENCE_LIMITS.frames);
  for (const sample of samples) if (!Number.isFinite(sample)) throw new Error('Comparison audio must contain only finite samples.');
  const result = new Float32Array(endFrame - startFrame);
  if (startFrame < samples.length) result.set(samples.subarray(startFrame, Math.min(endFrame, samples.length)));
  return result;
}
