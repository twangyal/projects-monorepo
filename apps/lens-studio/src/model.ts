import { LIMITS, type DepthMask, type PhotoAsset, type Plane, type Point, type Project, type Settings } from './types.ts';
import { validatePhotoAsset } from './photo-header.ts';

const SETTINGS_KEYS = ['mode', 'sourceFocal', 'targetFocal', 'shiftX', 'shiftY', 'near', 'far'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/;
const utf8 = new TextEncoder();
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function object(value: unknown, keys: string[], partial = false): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected an object with the documented fields.');
  const prototype = Object.getPrototypeOf(value);
  requireValue(prototype === Object.prototype || prototype === null, 'Unsupported object prototype.');
  const own = Reflect.ownKeys(value);
  requireValue((partial || own.length === keys.length) && own.every(key => typeof key === 'string' && keys.includes(key)), 'Unexpected or missing object fields.');
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    requireValue('value' in descriptor && descriptor.enumerable, 'Use ordinary JSON data fields.');
  }
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'Integer is outside supported bounds.');
  return value;
}
function decimal(value: unknown, min: number, max: number, places: number): number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, 'Projection value is outside supported bounds.');
  const factor = 10 ** places, rounded = Math.round(value * factor);
  requireValue(Math.abs(value * factor - rounded) <= 1e-7, 'Projection value has too many decimal places.');
  return rounded / factor || 0;
}
function unicode(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    requireValue((point >= 32 || point === 9 || point === 10 || point === 13) && (point < 127 || point > 159), 'Text contains unsupported controls.');
    requireValue(point < 0xd800 || point > 0xdfff, 'Text must contain valid Unicode.');
  }
}
function title(value: unknown): string {
  requireValue(typeof value === 'string' && value.length <= LIMITS.projectBytes, 'Use a title of 1–80 Unicode characters.');
  unicode(value);
  const result = value.trim();
  requireValue(result.length > 0 && [...result].length <= LIMITS.titleCharacters, 'Use a title of 1–80 Unicode characters.');
  return result;
}
function plane(value: unknown): asserts value is Plane {
  requireValue(value === 0 || value === 1 || value === 2, 'Choose near, subject or far.');
}
function dimensions(width: unknown, height: unknown): [number, number] {
  return [integer(width, 1, LIMITS.photoSide), integer(height, 1, LIMITS.photoSide)];
}

export function validateSettings(value: unknown): Settings {
  const fields = object(value, SETTINGS_KEYS);
  requireValue(fields.mode === 'fixed' || fields.mode === 'perspective', 'Choose a supported projection mode.');
  const settings: Settings = {
    mode: fields.mode,
    sourceFocal: decimal(fields.sourceFocal, LIMITS.focalMin, LIMITS.focalMax, LIMITS.focalDecimals),
    targetFocal: decimal(fields.targetFocal, LIMITS.focalMin, LIMITS.focalMax, LIMITS.focalDecimals),
    shiftX: decimal(fields.shiftX, LIMITS.shiftMin, LIMITS.shiftMax, LIMITS.shiftDecimals),
    shiftY: decimal(fields.shiftY, LIMITS.shiftMin, LIMITS.shiftMax, LIMITS.shiftDecimals),
    near: decimal(fields.near, LIMITS.nearMin, LIMITS.nearMax, LIMITS.depthDecimals),
    far: decimal(fields.far, LIMITS.farMin, LIMITS.farMax, LIMITS.depthDecimals),
  };
  const ratio = settings.targetFocal / settings.sourceFocal;
  requireValue(ratio >= LIMITS.ratioMin && ratio <= LIMITS.ratioMax, 'Target/source focal ratio must be between 0.25 and 4.');
  requireValue(settings.mode !== 'perspective' || settings.near + ratio >= 1 + LIMITS.planeClearance,
    'The virtual camera would cross a depth plane. Increase target focal length or near distance.');
  return settings;
}

export function decodeMask(value: DepthMask): Uint8Array {
  const mask = object(value, ['width', 'height', 'labels']);
  const [width, height] = dimensions(mask.width, mask.height), count = width * height;
  requireValue(typeof mask.labels === 'string' && mask.labels.length === Math.ceil(count / 3) * 4
    && !/[^A-Za-z0-9+/=]/.test(mask.labels), 'Depth labels must be canonical base64 with the exact pixel count.');
  let binary: string;
  try { binary = atob(mask.labels); } catch { throw new Error('Depth labels are not valid base64.'); }
  requireValue(binary.length === count && btoa(binary) === mask.labels, 'Depth labels must use canonical base64 padding.');
  const labels = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const label = binary.charCodeAt(index); plane(label); labels[index] = label;
  }
  return labels;
}
export function encodeMask(labels: Uint8Array, width: number, height: number): DepthMask {
  dimensions(width, height);
  requireValue(labels instanceof Uint8Array && labels.length === width * height, 'Depth labels must match the photo dimensions.');
  for (const label of labels) plane(label);
  const parts: string[] = [];
  for (let offset = 0; offset < labels.length; offset += 16384) parts.push(String.fromCharCode(...labels.subarray(offset, offset + 16384)));
  return { width, height, labels: btoa(parts.join('')) };
}
export function validateProject(value: unknown): Project {
  const project = object(value, ['schemaVersion', 'id', 'title', 'photo', 'settings', 'depth']);
  requireValue(project.schemaVersion === 1, 'Unsupported project schema version.');
  requireValue(typeof project.id === 'string' && UUID.test(project.id), 'Project ID must be a canonical lowercase UUID.');
  const photo = validatePhotoAsset(project.photo), settings = validateSettings(project.settings);
  const mask = object(project.depth, ['width', 'height', 'labels']);
  const depth: DepthMask = { width: mask.width as number, height: mask.height as number, labels: mask.labels as string };
  requireValue(depth.width === photo.width && depth.height === photo.height, 'Photo and depth dimensions must match.');
  decodeMask(depth);
  const result: Project = { schemaVersion: 1, id: project.id, title: title(project.title), photo, settings, depth };
  requireValue(utf8.encode(JSON.stringify(result)).length <= LIMITS.projectBytes, 'Project exceeds the 12 MiB backup limit.');
  return result;
}
export function createProject(value: PhotoAsset): Project {
  const photo = validatePhotoAsset(value);
  return validateProject({ schemaVersion: 1, id: crypto.randomUUID(), title: 'Lens study', photo,
    settings: { mode: 'fixed', sourceFocal: 50, targetFocal: 50, shiftX: 0, shiftY: 0, near: .6, far: 2 },
    depth: encodeMask(new Uint8Array(photo.width * photo.height).fill(1), photo.width, photo.height) });
}
export function updateSettings(project: Project, patch: Partial<Settings>): Project {
  const current = validateProject(project), fields = object(patch, SETTINGS_KEYS, true);
  current.settings = validateSettings({ ...current.settings, ...fields });
  return current;
}
export function fillMask(project: Project, value: Plane): Project {
  const current = validateProject(project); plane(value);
  current.depth = encodeMask(new Uint8Array(current.photo.width * current.photo.height).fill(value), current.photo.width, current.photo.height);
  return current;
}
export function resetProjection(project: Project): Project {
  const current = validateProject(project);
  current.settings = validateSettings({ ...current.settings, targetFocal: current.settings.sourceFocal, shiftX: 0, shiftY: 0 });
  return current;
}
export function paintMask(project: Project, value: Plane, radius: number, points: Point[]): Project {
  const current = validateProject(project); plane(value); integer(radius, LIMITS.brushMin, LIMITS.brushMax);
  requireValue(Array.isArray(points) && points.length >= 1 && points.length <= LIMITS.brushPoints, 'Use a brush gesture with 1–2048 points.');
  const { width, height } = current.photo;
  const path: Point[] = [];
  const lengths: number[] = [];
  let total = 0;
  for (const value of points) {
    const point = object(value, ['x', 'y']);
    requireValue(typeof point.x === 'number' && Number.isFinite(point.x) && point.x >= 0 && point.x <= width
      && typeof point.y === 'number' && Number.isFinite(point.y) && point.y >= 0 && point.y <= height, 'Paint within the source photo.');
    const next = { x: point.x, y: point.y }, previous = path.at(-1);
    if (previous) {
      const length = Math.hypot(next.x - previous.x, next.y - previous.y);
      total += length; lengths.push(length);
      requireValue(total <= LIMITS.brushLength, 'This gesture is too long. Use shorter brush strokes.');
    }
    path.push(next);
  }
  const labels = decodeMask(current.depth);
  function stamp(point: Point) {
    const left = Math.max(0, Math.ceil(point.x - radius - .5)), right = Math.min(width - 1, Math.floor(point.x + radius - .5));
    const top = Math.max(0, Math.ceil(point.y - radius - .5)), bottom = Math.min(height - 1, Math.floor(point.y + radius - .5));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      if ((x + .5 - point.x) ** 2 + (y + .5 - point.y) ** 2 <= radius ** 2) labels[y * width + x] = value;
    }
  }
  stamp(path[0]);
  let segment = 0, start = 0;
  const step = radius / 2;
  for (let distance = step; distance <= total; distance += step) {
    while (segment < lengths.length - 1 && (lengths[segment] === 0 || start + lengths[segment] < distance)) start += lengths[segment++];
    const fraction = (distance - start) / lengths[segment], a = path[segment], b = path[segment + 1];
    stamp({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
  }
  if (total > 0 && total % step !== 0) stamp(path[path.length - 1]);
  current.depth = encodeMask(labels, width, height);
  return current;
}

export function serializeProject(project: Project): string { return JSON.stringify(validateProject(project)); }
export function parseProject(text: string): Project {
  requireValue(typeof text === 'string' && text.length <= LIMITS.projectBytes && utf8.encode(text).length <= LIMITS.projectBytes, 'Project JSON exceeds the 12 MiB limit.');
  let cursor = 0;
  const invalid = () => new Error('Project must be valid bounded JSON without duplicate keys.');
  function whitespace() { while (cursor < text.length && /[\x20\t\r\n]/.test(text[cursor])) cursor++; }
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
    whitespace();
    const character = text[cursor];
    if (character === '"') return string();
    if (character === '{') {
      cursor++; whitespace();
      const result: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (text[cursor] === '}') { cursor++; return result; }
      while (cursor < text.length) {
        whitespace(); if (text[cursor] !== '"') throw invalid();
        const key = string(); if (keys.has(key)) throw invalid(); keys.add(key);
        whitespace(); if (text[cursor++] !== ':') throw invalid();
        result[key] = value(depth + 1); whitespace();
        const end = text[cursor++]; if (end === '}') return result; if (end !== ',') throw invalid();
      }
      throw invalid();
    }
    if (character === '[') {
      cursor++; whitespace(); const result: unknown[] = [];
      if (text[cursor] === ']') { cursor++; return result; }
      while (cursor < text.length) {
        result.push(value(depth + 1)); whitespace();
        const end = text[cursor++]; if (end === ']') return result; if (end !== ',') throw invalid();
      }
      throw invalid();
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, cursor)) { cursor += literal.length; return result; }
    }
    const pattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y; pattern.lastIndex = cursor;
    const token = pattern.exec(text); if (!token) throw invalid(); cursor = pattern.lastIndex;
    const number = Number(token[0]);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw invalid();
    return number;
  }
  const parsed = value(1); whitespace(); if (cursor !== text.length) throw invalid();
  return validateProject(parsed);
}
