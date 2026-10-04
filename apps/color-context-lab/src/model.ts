import { LIMITS, type EditState, type ImageAsset, type Project, type Raster, type Settings, type SourceInfo } from './types.ts';

const encoder = new TextEncoder();
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function requireValue(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function object(value: unknown, keys: string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Use a plain data object.');
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, 'Unsupported data object prototype.');
  const own = Reflect.ownKeys(value);
  requireValue(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)), 'Unexpected or missing data fields.');
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue(descriptor.enumerable && 'value' in descriptor, 'Use ordinary data fields, not accessors.');
  }
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  requireValue(typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max, `Use a whole number from ${min} through ${max}.`);
  return value === 0 ? 0 : value;
}
function unicode(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    requireValue(point < 0xd800 || point > 0xdfff, 'Text must contain valid Unicode.');
  }
}
function literal(value: unknown, max: number): string {
  requireValue(typeof value === 'string' && value.length <= max * 2, 'Text exceeds its character limit.');
  unicode(value);
  for (const character of value) {
    const point = character.codePointAt(0)!;
    requireValue(point >= 32 && (point < 127 || point > 159) && point !== 0x2028 && point !== 0x2029, 'Use single-line text without control characters.');
  }
  requireValue(value.trim().length > 0 && [...value].length <= max, 'Supply nonblank text within its character limit.');
  return value;
}
function uuid(value: unknown): string {
  requireValue(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/.test(value), 'Use a canonical lowercase UUID.');
  return value;
}
function sourceInfo(value: unknown): SourceInfo {
  const fields = object(value, ['fileName', 'format', 'width', 'height']);
  requireValue(fields.format === 'png' || fields.format === 'procedural', 'Source format must be PNG or procedural.');
  const width = integer(fields.width, 1, LIMITS.sourceSide), height = integer(fields.height, 1, LIMITS.sourceSide);
  requireValue(width * height <= LIMITS.sourcePixels, 'Source image exceeds 16 million pixels.');
  if (fields.format === 'procedural') requireValue(width === 128 && height === 128, 'Procedural source dimensions must be 128 by 128.');
  return { fileName: literal(fields.fileName, LIMITS.fileNameCharacters), format: fields.format, width, height };
}
function geometry(width: number, height: number, source: SourceInfo): void {
  const scale = Math.min(1, LIMITS.imageSide / Math.max(source.width, source.height));
  requireValue(width === Math.max(1, Math.round(source.width * scale)) && height === Math.max(1, Math.round(source.height * scale)), 'Normalized dimensions must match the source dimensions and 720-pixel normalization rule.');
}
function base64(value: unknown, bytes: number): string {
  const length = 4 * Math.ceil(bytes / 3), padding = (3 - bytes % 3) % 3;
  requireValue(typeof value === 'string' && value.length === length, 'Raw RGBA base64 length must exactly match image dimensions.');
  requireValue(!/[^A-Za-z0-9+/=]/.test(value), 'Use canonical standard base64 without whitespace or URLs.');
  const bodyLength = length - padding;
  requireValue(value.indexOf('=') === (padding ? bodyLength : -1) && value.slice(bodyLength) === '='.repeat(padding), 'Raw RGBA base64 padding is invalid.');
  const last = ALPHABET.indexOf(value[bodyLength - 1]);
  requireValue(!padding || last >= 0 && last % (padding === 2 ? 16 : 4) === 0, 'Raw RGBA base64 has noncanonical unused bits.');
  return value;
}

export function validateSettings(value: unknown): Settings {
  const fields = object(value, ['mode', 'border', 'colorA', 'colorB', 'cellSize']);
  requireValue(fields.mode === 'solid' || fields.mode === 'checker', 'Choose a solid or checker surround.');
  for (const name of ['colorA', 'colorB']) requireValue(typeof fields[name] === 'string' && /^#[0-9a-f]{6}(?![\s\S])/.test(fields[name]), 'Colors must be lowercase six-digit hexadecimal values.');
  return { mode: fields.mode, border: integer(fields.border, 0, LIMITS.border), colorA: fields.colorA as string,
    colorB: fields.colorB as string, cellSize: integer(fields.cellSize, LIMITS.cellMin, LIMITS.cellMax) };
}
export function validateImageAsset(value: unknown): ImageAsset {
  const fields = object(value, ['id', 'width', 'height', 'rgba', 'source']);
  const width = integer(fields.width, 1, LIMITS.imageSide), height = integer(fields.height, 1, LIMITS.imageSide);
  const source = sourceInfo(fields.source); geometry(width, height, source);
  return { id: uuid(fields.id), width, height, rgba: base64(fields.rgba, width * height * 4), source };
}
export function validateProject(value: unknown): Project {
  const fields = object(value, ['schemaVersion', 'id', 'title', 'image', 'settings']);
  requireValue(fields.schemaVersion === 1, 'Unsupported project schema version.');
  const project: Project = { schemaVersion: 1, id: uuid(fields.id), title: literal(fields.title, LIMITS.titleCharacters),
    image: validateImageAsset(fields.image), settings: validateSettings(fields.settings) };
  requireValue(encoder.encode(JSON.stringify(project)).length <= LIMITS.projectBytes, 'Project exceeds the 4 MiB backup limit.');
  return project;
}
export function createImageAsset(raster: Raster, source: SourceInfo): ImageAsset {
  const fields = object(raster, ['width', 'height', 'rgba']);
  const width = integer(fields.width, 1, LIMITS.imageSide), height = integer(fields.height, 1, LIMITS.imageSide);
  const admittedSource = sourceInfo(source); geometry(width, height, admittedSource);
  const rgba = fields.rgba;
  requireValue(rgba instanceof Uint8ClampedArray && Object.getPrototypeOf(rgba) === Uint8ClampedArray.prototype, 'Use an ordinary Uint8ClampedArray of RGBA8 pixels.');
  // Intrinsic getters avoid executing properties attached to a caller's view.
  const prototype = Object.getPrototypeOf(Uint8ClampedArray.prototype) as object;
  const buffer = Object.getOwnPropertyDescriptor(prototype, 'buffer')!.get!.call(rgba) as ArrayBufferLike;
  const offset = Object.getOwnPropertyDescriptor(prototype, 'byteOffset')!.get!.call(rgba) as number;
  const length = Object.getOwnPropertyDescriptor(prototype, 'byteLength')!.get!.call(rgba) as number;
  requireValue(buffer instanceof ArrayBuffer && length === width * height * 4, 'Use exact unshared, attached RGBA8 bytes matching image dimensions.');
  const bytes = new Uint8Array(buffer, offset, length), pieces: string[] = [];
  for (let start = 0; start < length; start += 8192) pieces.push(String.fromCharCode(...bytes.subarray(start, start + 8192)));
  return { id: crypto.randomUUID(), width, height, rgba: btoa(pieces.join('')), source: admittedSource };
}
export function decodePixels(asset: ImageAsset): Raster {
  const image = validateImageAsset(asset), binary = atob(image.rgba);
  const rgba = new Uint8ClampedArray(image.width * image.height * 4);
  for (let i = 0; i < binary.length; i++) rgba[i] = binary.charCodeAt(i);
  return { width: image.width, height: image.height, rgba };
}
export function createProject(image: ImageAsset, title = 'Color context study'): Project {
  const asset = validateImageAsset(image), name = literal(title, LIMITS.titleCharacters);
  return { schemaVersion: 1, id: crypto.randomUUID(), title: name, image: asset,
    settings: { mode: 'solid', border: 48, colorA: '#808080', colorB: '#808080', cellSize: 16 } };
}
export function updateProject(project: Project, edit: EditState): Project {
  const current = validateProject(project), fields = object(edit, ['title', 'settings']);
  return validateProject({ ...current, title: fields.title, settings: fields.settings });
}
export function serializeProject(project: Project): string { return JSON.stringify(validateProject(project)); }

export function parseProjectJson(text: string): Project {
  requireValue(typeof text === 'string' && text.length <= LIMITS.projectBytes && encoder.encode(text).length <= LIMITS.projectBytes, 'Project JSON exceeds the 4 MiB limit.');
  let cursor = 0;
  const invalid = () => new Error('Project must be bounded valid JSON without duplicate keys.');
  function whitespace(): void { while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor])) cursor++; }
  function string(): string {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') {
        let value: string;
        try { value = JSON.parse(text.slice(start, cursor)) as string; } catch { throw invalid(); }
        unicode(value); return value;
      }
    }
    throw invalid();
  }
  function value(depth: number): unknown {
    if (depth > LIMITS.jsonDepth) throw invalid();
    whitespace(); const character = text[cursor];
    if (character === '"') return string();
    if (character === '{') {
      cursor++; whitespace(); const result: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (text[cursor] === '}') { cursor++; return result; }
      while (cursor < text.length) {
        whitespace(); if (text[cursor] !== '"') throw invalid();
        const key = string(); if (keys.has(key)) throw invalid(); keys.add(key);
        whitespace(); if (text[cursor++] !== ':') throw invalid();
        result[key] = value(depth + 1); whitespace();
        const next = text[cursor++]; if (next === '}') return result; if (next !== ',') throw invalid();
      }
      throw invalid();
    }
    if (character === '[') {
      cursor++; whitespace(); const result: unknown[] = [];
      if (text[cursor] === ']') { cursor++; return result; }
      while (cursor < text.length) {
        result.push(value(depth + 1)); whitespace();
        const next = text[cursor++]; if (next === ']') return result; if (next !== ',') throw invalid();
      }
      throw invalid();
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(token, cursor)) { cursor += token.length; return result; }
    }
    const pattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y; pattern.lastIndex = cursor;
    const match = pattern.exec(text); if (!match) throw invalid(); cursor = pattern.lastIndex;
    const number = Number(match[0]); if (!Number.isFinite(number)) throw invalid(); return number;
  }
  const result = value(1); whitespace(); if (cursor !== text.length) throw invalid();
  return validateProject(result);
}
