import { LIMITS } from './types.ts';
import type { Settings, ImageAsset, Project, Raster, SourceInfo, EditState } from './types.ts';
import { strictJson } from './json.ts';

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Expected an ordinary record');
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || !names.every(k => typeof k === 'string' && keys.includes(k))) throw new Error('Unknown or missing fields');
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !('value' in d) || !d.enumerable) throw new Error('Expected data fields');
  }
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error('Integer outside supported range');
  return value;
}
function literal(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max*2 || !value.isWellFormed()
      || !value.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)
      || Array.from(value).length > max) throw new Error('Invalid literal label');
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('Invalid canonical UUID');
  return value;
}
export function validateSettings(value: unknown): Settings {
  const r = record(value, ['mode','border','colorA','colorB','cellSize']);
  if (r.mode !== 'solid' && r.mode !== 'checker') throw new Error('Unsupported surround pattern');
  for (const color of [r.colorA, r.colorB]) if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/.test(color)) throw new Error('Expected lowercase hex color');
  return { mode: r.mode, border: integer(r.border, 0, LIMITS.border), colorA: r.colorA as string,
    colorB: r.colorB as string, cellSize: integer(r.cellSize, LIMITS.cellMin, LIMITS.cellMax) };
}
function validateSource(value: unknown, width: number, height: number): SourceInfo {
  const s = record(value, ['fileName','format','width','height']);
  const sw = integer(s.width,1,LIMITS.sourceSide); const sh = integer(s.height,1,LIMITS.sourceSide);
  if (sw*sh > LIMITS.sourcePixels) throw new Error('Source exceeds pixel bounds');
  if (s.format !== 'png' && s.format !== 'procedural') throw new Error('Unsupported source format');
  if (s.format === 'procedural') {
    if (sw !== 128 || sh !== 128 || width !== 128 || height !== 128) throw new Error('Invalid procedural dimensions');
  } else {
    const scale = Math.min(1, LIMITS.imageSide/Math.max(sw,sh));
    if (width !== Math.max(1,Math.round(sw*scale)) || height !== Math.max(1,Math.round(sh*scale))) throw new Error('Inconsistent normalized dimensions');
  }
  return { fileName: literal(s.fileName, LIMITS.fileNameCharacters), format: s.format, width: sw, height: sh };
}
function validateBase64(value: unknown, bytes: number): string {
  if (typeof value !== 'string' || value.length !== 4*Math.ceil(bytes/3)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid raw RGBA encoding');
  const remainder = bytes%3;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  if (remainder === 0 && value.endsWith('=')) throw new Error('Invalid padding');
  if (remainder === 1 && (!value.endsWith('==') || (alphabet.indexOf(value[value.length-3]) & 15))) throw new Error('Noncanonical padding bits');
  if (remainder === 2 && (value.endsWith('==') || !value.endsWith('=') || (alphabet.indexOf(value[value.length-2]) & 3))) throw new Error('Noncanonical padding bits');
  return value;
}
export function validateImageAsset(value: unknown): ImageAsset {
  const r = record(value, ['id','width','height','rgba','source']);
  const width = integer(r.width,1,LIMITS.imageSide); const height = integer(r.height,1,LIMITS.imageSide);
  return { id: id(r.id), width, height, rgba: validateBase64(r.rgba,width*height*4), source: validateSource(r.source,width,height) };
}
export function validateProject(value: unknown): Project {
  const r = record(value, ['schemaVersion','id','title','image','settings']);
  if (r.schemaVersion !== 1) throw new Error('Unsupported project version');
  return { schemaVersion: 1, id: id(r.id), title: literal(r.title,LIMITS.titleCharacters), image: validateImageAsset(r.image), settings: validateSettings(r.settings) };
}
export function validateRaster(value: Raster, side = LIMITS.outputSide): Raster {
  const r = record(value, ['width','height','rgba']);
  const width = integer(r.width,1,side); const height = integer(r.height,1,side);
  if (!(r.rgba instanceof Uint8ClampedArray) || r.rgba.length !== width*height*4) throw new Error('Invalid raster payload');
  return { width, height, rgba: r.rgba };
}
export function createImageAsset(raster: Raster, source: SourceInfo): ImageAsset {
  const r = validateRaster(raster,LIMITS.imageSide);
  let binary = '';
  for (let at=0;at<r.rgba.length;at+=8192) binary += String.fromCharCode(...r.rgba.subarray(at,at+8192));
  return validateImageAsset({ id: crypto.randomUUID(), width: r.width, height: r.height, rgba: btoa(binary), source });
}
export function decodePixels(asset: ImageAsset): Raster {
  const a = validateImageAsset(asset); const binary = atob(a.rgba);
  const rgba = new Uint8ClampedArray(binary.length);
  for (let i=0;i<binary.length;i++) rgba[i] = binary.charCodeAt(i);
  return { width: a.width, height: a.height, rgba };
}
export function createProject(image: ImageAsset, title = 'Color context study'): Project {
  return validateProject({ schemaVersion:1, id: crypto.randomUUID(), title, image,
    settings: { mode:'solid',border:48,colorA:'#808080',colorB:'#808080',cellSize:16 } });
}
export function updateProject(project: Project, edit: EditState): Project {
  const p = validateProject(project); const e = record(edit,['title','settings']);
  return validateProject({ ...p, title: e.title, settings: e.settings });
}
export function serializeProject(project: Project): string {
  const text = JSON.stringify(validateProject(project));
  if (new TextEncoder().encode(text).length > LIMITS.projectBytes) throw new Error('Project exceeds byte limit');
  return text;
}
export function parseProjectJson(text: string): Project {
  return validateProject(strictJson(text,LIMITS.projectBytes,LIMITS.jsonDepth));
}
