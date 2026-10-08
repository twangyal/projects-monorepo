import { parseComposition } from './model.ts';
import { notesOnly, validateAsset, validateBundle } from './reference-project.ts';
import { REFERENCE_LIMITS, type ReferenceAsset, type ReferenceBundle } from './reference-types.ts';

const invalid = () => new Error('Project backup is invalid or incomplete. Keep the original file and choose a complete Melody backup.');
const fields = ['id', 'kind', 'captureTempo', 'decodedSampleRate', 'decodedChannels', 'decodedFrames', 'analyzedFrames', 'frameCount'] as const;

/** Internal shared persistence seam: immutable metadata, with PCM excluded. */
export function referenceMetadata(asset: ReferenceAsset) {
  return Object.fromEntries(fields.map(key => [key, asset[key]]));
}
export async function hashReferencePcm(pcm: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(pcm).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function exactFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key] || !('value' in descriptors[key]))) throw invalid();
  return value as Record<string, unknown>;
}

export function admitReferenceMetadata(asset: Record<string, unknown>): void {
  const integer = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
  if (typeof asset.id !== 'string' || asset.id.length !== 36 || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(asset.id)
    || typeof asset.kind !== 'string' || !['microphone', 'audio-file', 'demo'].includes(asset.kind)
    || typeof asset.captureTempo !== 'number' || !Number.isFinite(asset.captureTempo) || asset.captureTempo < 40 || asset.captureTempo > 240
    || !integer(asset.decodedSampleRate, 8000, 192000) || !integer(asset.decodedChannels, 1, 32)
    || !integer(asset.decodedFrames, 1, 192000 * 20.1) || !integer(asset.analyzedFrames, 1, 192000 * 20)
    || !integer(asset.frameCount, 1, REFERENCE_LIMITS.frames)) throw invalid();
  const rate = asset.decodedSampleRate as number, frames = asset.decodedFrames as number, analyzed = asset.analyzedFrames as number;
  if (frames / rate > 20.1 || analyzed !== Math.min(frames, Math.floor(rate * 20)) || asset.frameCount !== Math.floor(analyzed * 22050 / rate)) throw invalid();
}

// Scan grammar and decoded object keys before JSON.parse can build its tree.
function preflight(source: string): void {
  let i = 0;
  const whitespace = () => { while (/[\t\n\r ]/.test(source[i] ?? '') && i < source.length) i++; };
  const string = (key: boolean): string => {
    const start = i++;
    while (i < source.length) {
      const code = source.charCodeAt(i++);
      if (code === 34) {
        if (!key) return '';
        return JSON.parse(source.slice(start, i)) as string;
      }
      if (code < 32) throw invalid();
      if (code === 92) {
        const escape = source[i++];
        if (escape === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(source.slice(i, i + 4))) throw invalid(); i += 4; }
        else if (!escape || !'"\\/bfnrt'.includes(escape)) throw invalid();
      }
    }
    throw invalid();
  };
  const value = (depth: number): void => {
    whitespace();
    const c = source[i];
    if (c === '{' || c === '[') {
      if (depth >= REFERENCE_LIMITS.jsonDepth) throw invalid();
      i++; whitespace(); const closing = c === '{' ? '}' : ']'; const keys = new Set<string>();
      if (source[i] === closing) { i++; return; }
      while (true) {
        whitespace();
        if (c === '{') {
          if (source[i] !== '"') throw invalid();
          const name = string(true); if (keys.has(name)) throw invalid(); keys.add(name);
          whitespace(); if (source[i++] !== ':') throw invalid();
        }
        value(depth + 1); whitespace();
        if (source[i] === closing) { i++; break; }
        if (source[i++] !== ',') throw invalid();
      }
    } else if (c === '"') string(false);
    else {
      const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(i));
      if (!token || !['true', 'false', 'null'].includes(token[0]) && !Number.isFinite(Number(token[0]))) throw invalid();
      i += token[0].length;
    }
  };
  value(0); whitespace(); if (i !== source.length) throw invalid();
}
function base64(pcm: Uint8Array): string {
  let result = '';
  for (let i = 0; i < pcm.length; i += 32766) result += btoa(String.fromCharCode(...pcm.subarray(i, i + 32766)));
  return result;
}
function unbase64(value: unknown, expected: number): Uint8Array {
  if (typeof value !== 'string' || value.length !== 4 * Math.ceil(expected / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw invalid();
  const raw = atob(value);
  if (raw.length !== expected) throw invalid();
  const result = Uint8Array.from(raw, c => c.charCodeAt(0));
  if (base64(result) !== value) throw invalid();
  return result;
}

export async function encodeProjectBackup(bundle: ReferenceBundle): Promise<Uint8Array> {
  const snapshot = validateBundle(bundle);
  const assets = [];
  for (const asset of snapshot.assets) assets.push({ ...referenceMetadata(asset), sha256: await hashReferencePcm(asset.pcm), pcmBase64: base64(asset.pcm) });
  const result = new TextEncoder().encode(JSON.stringify({ format: 'melody-studio-project', version: 1, document: snapshot.document, assets }));
  if (result.byteLength > REFERENCE_LIMITS.backupBytes) throw new Error('Complete project backup exceeds 12 MiB.');
  return result;
}

export async function decodeProjectBackup(bytes: Uint8Array): Promise<ReferenceBundle> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > REFERENCE_LIMITS.backupBytes) throw new Error('Project files must be at most 12 MiB.');
  const copy = Uint8Array.from(bytes);
  let source: string, parsed: unknown;
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(copy); preflight(source); parsed = JSON.parse(source); }
  catch { throw invalid(); }
  if (parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'version') && !Object.hasOwn(parsed, 'format')) {
    return { document: notesOnly(parseComposition(source)), assets: [] };
  }
  const envelope = exactFields(parsed, ['format', 'version', 'document', 'assets']);
  if (envelope.format !== 'melody-studio-project' || envelope.version !== 1 || !Array.isArray(envelope.assets) || envelope.assets.length > REFERENCE_LIMITS.currentAssets) throw invalid();
  const assets: ReferenceAsset[] = [];
  for (const value of envelope.assets) {
    const asset = exactFields(value, [...fields, 'sha256', 'pcmBase64']);
    if (typeof asset.frameCount !== 'number' || !Number.isInteger(asset.frameCount) || asset.frameCount < 1 || asset.frameCount > REFERENCE_LIMITS.frames
      || typeof asset.sha256 !== 'string' || asset.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw invalid();
    // Validate all metadata before creating a buffer based on its frame count.
    admitReferenceMetadata(asset);
    const pcm = unbase64(asset.pcmBase64, asset.frameCount * 2);
    const detached = validateAsset({ ...Object.fromEntries(fields.map(key => [key, asset[key]])), pcm });
    if (await hashReferencePcm(detached.pcm) !== asset.sha256) throw invalid();
    assets.push(detached);
  }
  return validateBundle({ document: envelope.document, assets });
}
