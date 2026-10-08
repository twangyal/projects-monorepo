import { validateComposition } from './model.ts';
import type { Composition } from './types.ts';
import { REFERENCE_LIMITS as limits } from './reference-types.ts';
import type { MelodyDocument, ReferenceAsset, ReferenceBundle, TrackReference } from './reference-types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const ASSET_KEYS = ['id', 'kind', 'captureTempo', 'decodedSampleRate', 'decodedChannels', 'decodedFrames', 'analyzedFrames', 'frameCount', 'pcm'] as const;

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${label} must be a plain object.`);
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(key => typeof key !== 'string' || !keys.includes(key))) throw new Error(`${label} has missing or unknown fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label} cannot contain accessors.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw new Error(`${label} must be an array of at most ${maximum} entries.`);
  if (Reflect.ownKeys(value).length !== value.length + 1) throw new Error(`${label} must be dense and have no extra fields.`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) throw new Error(`${label} must be dense and cannot contain accessors.`);
  }
  return value;
}

function finite(value: unknown, minimum: number, maximum: number, label: string, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) throw new Error(`${label} is outside its supported range.`);
  return value;
}
function assetId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Reference asset ID must be a lowercase UUID v4.');
  return value;
}

/** Check object boundaries before the legacy validator can read any getter. */
function composition(value: unknown, normalize: boolean): Composition {
  const raw = record(value, ['version', 'title', 'tempo', 'tracks'], 'Composition');
  const tracks = array(raw.tracks, 8, 'Tracks');
  for (const item of tracks) {
    const hasEnvelope = item !== null && typeof item === 'object' && Object.hasOwn(item, 'envelope');
    const hasFilter = item !== null && typeof item === 'object' && Object.hasOwn(item, 'filter');
    const track = record(item, ['id', 'name', 'instrument', 'volume', 'muted', 'notes', ...(hasEnvelope ? ['envelope'] : []), ...(hasFilter ? ['filter'] : [])], 'Track');
    for (const note of array(track.notes, 256, 'Notes')) record(note, ['id', 'pitch', 'start', 'duration', 'velocity'], 'Note');
  }
  const result = validateComposition(value);
  if (!normalize && (result.title !== raw.title || result.tracks.some((track, index) => track.name !== (tracks[index] as Record<string, unknown>).name))) throw new Error('Composition names must already be normalized; no text was changed.');
  return result;
}

export function notesOnly(value: Composition): MelodyDocument {
  return validateDocument({ schemaVersion: 1, composition: composition(value, true), references: [] });
}

export function validateDocument(value: unknown): MelodyDocument {
  const raw = record(value, ['schemaVersion', 'composition', 'references'], 'Reference document');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported reference document version; expected version 1.');
  const project = composition(raw.composition, false);
  const bindings = new Map<string, TrackReference>();
  const tracks = new Set(project.tracks.map(track => track.id));
  for (const item of array(raw.references, limits.currentAssets, 'Track references')) {
    const reference = record(item, ['trackId', 'assetId'], 'Track reference');
    if (typeof reference.trackId !== 'string' || !tracks.has(reference.trackId) || bindings.has(reference.trackId)) throw new Error('Each reference must name one existing track, without duplicate bindings.');
    bindings.set(reference.trackId, { trackId: reference.trackId, assetId: assetId(reference.assetId) });
  }
  const references = project.tracks.flatMap(track => {
    const reference = bindings.get(track.id);
    return reference ? [reference] : [];
  });
  const document: MelodyDocument = { schemaVersion: 1, composition: project, references };
  const json = JSON.stringify(document);
  if (json.length > limits.documentBytes || new TextEncoder().encode(json).length > limits.documentBytes) throw new Error('Reference document exceeds the 2 MiB size limit.');
  return document;
}

export function validateAsset(value: unknown): ReferenceAsset {
  const raw = record(value, ASSET_KEYS, 'Reference asset');
  const id = assetId(raw.id);
  if (raw.kind !== 'microphone' && raw.kind !== 'audio-file' && raw.kind !== 'demo') throw new Error('Reference kind must be microphone, audio-file or demo.');
  const captureTempo = finite(raw.captureTempo, 40, 240, 'Capture tempo', false);
  const decodedSampleRate = finite(raw.decodedSampleRate, 8000, 192000, 'Decoded sample rate');
  const decodedChannels = finite(raw.decodedChannels, 1, limits.decodedChannels, 'Decoded channel count');
  const decodedFrames = finite(raw.decodedFrames, 1, Math.floor(decodedSampleRate * 20.1), 'Decoded frame count');
  const analyzedFrames = finite(raw.analyzedFrames, 1, decodedSampleRate * limits.seconds, 'Analyzed frame count');
  if (analyzedFrames !== Math.min(decodedFrames, Math.floor(decodedSampleRate * limits.seconds))) throw new Error('Analyzed frames must describe the first 20 seconds or the complete shorter take.');
  const frameCount = finite(raw.frameCount, 1, limits.frames, 'Reference frame count');
  if (frameCount !== Math.floor(analyzedFrames * limits.sampleRate / decodedSampleRate)) throw new Error('Reference frame count does not match the decoded duration.');
  const pcm = raw.pcm;
  if (!(pcm instanceof Uint8Array) || Object.getPrototypeOf(pcm) !== Uint8Array.prototype) throw new Error('Reference PCM must be plain Uint8Array bytes.');
  // Do not invoke own overrides of the native typed-array accessors or iterator.
  for (const key of ['buffer', 'byteLength', 'byteOffset', 'length']) if (Object.hasOwn(pcm, key)) throw new Error('Reference PCM cannot override its native buffer fields.');
  if (!(pcm.buffer instanceof ArrayBuffer) || pcm.byteLength !== frameCount * 2 || pcm.byteLength > limits.assetBytes) throw new Error('Reference PCM must have exactly two unshared bytes per frame.');
  const copied = new Uint8Array(pcm.byteLength);
  copied.set(pcm);
  return { id, kind: raw.kind, captureTempo, decodedSampleRate, decodedChannels, decodedFrames, analyzedFrames, frameCount, pcm: copied };
}

function incomingAssets(value: unknown, document: MelodyDocument): Map<string, ReferenceAsset> {
  const candidates = array(value, limits.currentAssets, 'Reference assets');
  const wanted = new Set(document.references.map(reference => reference.assetId));
  const ids = new Set<string>();
  // Admit the entire small ID graph before copying any audio bytes.
  for (const item of candidates) {
    const raw = record(item, ASSET_KEYS, 'Reference asset');
    const id = assetId(raw.id);
    if (!wanted.has(id) || ids.has(id)) throw new Error('Reference assets must be distinct and referenced by this document.');
    ids.add(id);
  }
  return new Map(candidates.map(item => {
    const result = validateAsset(item);
    return [result.id, result];
  }));
}

export function validateBundle(value: unknown): ReferenceBundle {
  const raw = record(value, ['document', 'assets'], 'Complete reference project');
  const document = validateDocument(raw.document);
  const assets = incomingAssets(raw.assets, document);
  for (const reference of document.references) if (!assets.has(reference.assetId)) throw new Error('A referenced audio asset is missing; open a complete project backup.');
  return { document, assets: Array.from(assets.values()).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) };
}

export function withComposition(document: MelodyDocument, value: Composition): MelodyDocument {
  const previous = validateDocument(document);
  const next = composition(value, false);
  const surviving = new Set(next.tracks.map(track => track.id));
  return validateDocument({ schemaVersion: 1, composition: next, references: previous.references.filter(reference => surviving.has(reference.trackId)) });
}

function sameAsset(left: ReferenceAsset, right: ReferenceAsset): boolean {
  for (const key of ASSET_KEYS) if (key !== 'pcm' && left[key] !== right[key]) return false;
  if (left.pcm.length !== right.pcm.length) return false;
  for (let index = 0; index < left.pcm.length; index++) if (left.pcm[index] !== right.pcm[index]) return false;
  return true;
}
function copyAsset(asset: ReferenceAsset): ReferenceAsset {
  return { ...asset, pcm: asset.pcm.slice() };
}

/** Documents share a private asset registry; callers receive defensive copies only. */
export class ReferenceHistory {
  #states: MelodyDocument[];
  #position = 0;
  #assets: Map<string, ReferenceAsset>;

  constructor(initial: ReferenceBundle) {
    const validated = validateBundle(initial);
    this.#states = [validated.document];
    this.#assets = new Map(validated.assets.map(asset => [asset.id, asset]));
  }
  get current(): MelodyDocument { return structuredClone(this.#states[this.#position]); }
  get canUndo(): boolean { return this.#position > 0; }
  get canRedo(): boolean { return this.#position + 1 < this.#states.length; }
  get assetBytes(): number {
    let bytes = 0;
    for (const asset of this.#assets.values()) bytes += asset.pcm.byteLength;
    return bytes;
  }
  asset(id: string): ReferenceAsset {
    const result = this.#assets.get(id);
    if (!result) throw new Error('Reference asset is unavailable in this history.');
    return copyAsset(result);
  }
  snapshot(): ReferenceBundle {
    const document = this.current;
    const ids = Array.from(new Set(document.references.map(reference => reference.assetId))).sort();
    return { document, assets: ids.map(id => this.asset(id)) };
  }

  /** Validate and project both branch truncation and ordinary oldest eviction first. */
  commit(next: MelodyDocument, incoming: readonly ReferenceAsset[] = []): boolean {
    const document = validateDocument(next);
    const admitted = incomingAssets(incoming, document);
    const available = new Map(this.#assets);
    for (const [id, asset] of admitted) {
      const existing = available.get(id);
      if (existing && !sameAsset(existing, asset)) throw new Error('A reference asset ID conflicts with audio already in this history.');
      if (!existing) available.set(id, asset);
    }
    for (const reference of document.references) if (!available.has(reference.assetId)) throw new Error('A referenced audio asset is missing; open a complete project backup.');
    if (JSON.stringify(document) === JSON.stringify(this.#states[this.#position])) return false;

    const states = [...this.#states.slice(0, this.#position + 1), document];
    if (states.length > limits.historyStates) states.shift();
    const retained = this.#reachable(states, available);
    // Nothing owned by this instance changes until all validation and admission succeed.
    this.#states = states;
    this.#position = states.length - 1;
    this.#assets = retained;
    return true;
  }
  undo(): MelodyDocument | null {
    if (!this.canUndo) return null;
    this.#position--;
    return this.current;
  }
  redo(): MelodyDocument | null {
    if (!this.canRedo) return null;
    this.#position++;
    return this.current;
  }
  clear(): void {
    const states = [this.#states[this.#position]];
    const retained = this.#reachable(states, this.#assets);
    this.#states = states;
    this.#position = 0;
    this.#assets = retained;
  }
  #reachable(states: readonly MelodyDocument[], available: Map<string, ReferenceAsset>): Map<string, ReferenceAsset> {
    const retained = new Map<string, ReferenceAsset>();
    let bytes = 0;
    for (const document of states) {
      for (const reference of document.references) {
        if (retained.has(reference.assetId)) continue;
        const asset = available.get(reference.assetId);
        if (!asset) throw new Error('A referenced audio asset is missing from history.');
        bytes += asset.pcm.byteLength;
        if (bytes > limits.historyAssetBytes) throw new Error('Audio history would exceed 64 MiB. Download a project backup, then use Clear undo history before adding another take.');
        retained.set(asset.id, asset);
      }
    }
    return retained;
  }
}
