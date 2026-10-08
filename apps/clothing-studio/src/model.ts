export interface Point { x: number; y: number }
export interface Stroke { id: string; color: string; width: number; points: Point[] }
export interface Garment {
  bodyWidth: number; bodyLength: number; sleeveLength: number;
  neckline: 'round' | 'v'; color: string; pattern: 'plain' | 'stripe' | 'weave'; patternColor: string;
}
export interface Placement { x: number; y: number; width: number; height: number; rotation: number; opacity: number }
export interface Photo { dataUrl: string; width: number; height: number; name: string }
export interface Project {
  schemaVersion: 1; title: string; note: string; garment: Garment;
  strokes: Stroke[]; placement: Placement; photo: Photo | null;
}

export const MAX_PROJECT_BYTES = 6 * 1024 * 1024;
export const MAX_PHOTO_DATA_URL_LENGTH = 3 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 1200;
export const MAX_STROKES = 100;
export const MAX_STROKE_POINTS = 1000;
export const MAX_TOTAL_POINTS = 12000;
export const MAX_HISTORY_STEPS = 40;
export const MAX_TITLE_LENGTH = 80;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_PHOTO_NAME_LENGTH = 120;
export const MAX_STROKE_ID_LENGTH = 100;

function safeProperties(value: object, path: string): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error(`${path} contains an unsafe property.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if ('get' in descriptor || 'set' in descriptor) throw new Error(`${path} cannot contain accessor properties.`);
    if (['function', 'symbol', 'bigint'].includes(typeof descriptor.value)) {
      throw new Error(`${path} contains an unsafe property value.`);
    }
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${path} must be a plain object without a custom prototype.`);
  }
  safeProperties(value, path);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) {
    throw new Error(`${path} must contain ${min}–${max} items.`);
  }
  safeProperties(value, path);
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new Error(`${path} cannot contain missing items.`);
  }
  return Array.from(value);
}

function text(value: unknown, path: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${path} must be text ${required ? 'containing 1' : 'from 0'}–${max} characters.`);
  }
  return value;
}

function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${path} must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`);
  }
  return value;
}

function color(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${path} must be a six-digit hex color, such as #d89476.`);
  }
  return value;
}

export function createProject(): Project {
  return {
    schemaVersion: 1, title: 'Untitled concept', note: '',
    garment: { bodyWidth: 220, bodyLength: 250, sleeveLength: 45, neckline: 'round', color: '#d89476', pattern: 'plain', patternColor: '#f7ead7' },
    strokes: [], placement: { x: 0.5, y: 0.42, width: 0.6, height: 0.5, rotation: 0, opacity: 1 },
    photo: null,
  };
}

export function validateProject(value: unknown): Project {
  const project = record(value, 'Project');
  if (project.schemaVersion !== 1) throw new Error('Unsupported project schema version; expected version 1.');
  const title = text(project.title, 'Title', MAX_TITLE_LENGTH);
  const note = text(project.note, 'Note', MAX_NOTE_LENGTH, false);
  const shape = record(project.garment, 'Garment');
  if (shape.neckline !== 'round' && shape.neckline !== 'v') throw new Error('Garment neckline must be round or v.');
  if (shape.pattern !== 'plain' && shape.pattern !== 'stripe' && shape.pattern !== 'weave') {
    throw new Error('Garment pattern must be plain, stripe or weave.');
  }
  const garment: Garment = {
    bodyWidth: number(shape.bodyWidth, 'Garment bodyWidth', 160, 260),
    bodyLength: number(shape.bodyLength, 'Garment bodyLength', 180, 300),
    sleeveLength: number(shape.sleeveLength, 'Garment sleeveLength', 25, 65),
    neckline: shape.neckline, color: color(shape.color, 'Garment color'),
    pattern: shape.pattern, patternColor: color(shape.patternColor, 'Garment patternColor'),
  };
  const position = record(project.placement, 'Placement');
  const placement: Placement = {
    x: number(position.x, 'Placement x', 0, 1), y: number(position.y, 'Placement y', 0, 1),
    width: number(position.width, 'Placement width', 0.1, 1.5), height: number(position.height, 'Placement height', 0.1, 1.5),
    rotation: number(position.rotation, 'Placement rotation', -180, 180), opacity: number(position.opacity, 'Placement opacity', 0.1, 1),
  };
  let totalPoints = 0;
  const ids = new Set<string>();
  const strokes = array(project.strokes, 'Strokes', MAX_STROKES).map((value, index): Stroke => {
    const path = `Stroke ${index + 1}`;
    const stroke = record(value, path);
    const id = text(stroke.id, `${path} ID`, MAX_STROKE_ID_LENGTH);
    if (ids.has(id)) throw new Error(`${path} ID duplicates an existing stroke ID.`);
    ids.add(id);
    const sourcePoints = array(stroke.points, `${path} points`, MAX_STROKE_POINTS, 1);
    totalPoints += sourcePoints.length;
    if (totalPoints > MAX_TOTAL_POINTS) throw new Error(`Strokes must have at most ${MAX_TOTAL_POINTS} total points.`);
    const points = sourcePoints.map((value, pointIndex): Point => {
      const pointPath = `${path} point ${pointIndex + 1}`;
      const point = record(value, pointPath);
      return { x: number(point.x, `${pointPath} x`, 0, 1), y: number(point.y, `${pointPath} y`, 0, 1) };
    });
    return { id, color: color(stroke.color, `${path} color`), width: number(stroke.width, `${path} width`, 1, 20), points };
  });
  let photo: Photo | null = null;
  if (project.photo !== null) {
    const image = record(project.photo, 'Photo');
    const dataUrl = text(image.dataUrl, 'Photo dataUrl', MAX_PHOTO_DATA_URL_LENGTH);
    const prefix = 'data:image/jpeg;base64,';
    const payload = dataUrl.slice(prefix.length);
    if (!dataUrl.startsWith(prefix) || payload.length === 0 || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
      throw new Error('Photo dataUrl must be a base64 JPEG data URI.');
    }
    photo = {
      dataUrl, width: number(image.width, 'Photo width', 1, MAX_PHOTO_EDGE, true),
      height: number(image.height, 'Photo height', 1, MAX_PHOTO_EDGE, true),
      name: text(image.name, 'Photo name', MAX_PHOTO_NAME_LENGTH),
    };
  }
  return { schemaVersion: 1, title, note, garment, strokes, placement, photo };
}

function boundedJson(text: string): string {
  if (text.length > MAX_PROJECT_BYTES || new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) {
    throw new Error('Project JSON exceeds the 6 MiB size limit.');
  }
  return text;
}

export function parseProject(text: string): Project {
  if (typeof text !== 'string') throw new Error('Project JSON must be text.');
  boundedJson(text);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('Project contains invalid JSON.'); }
  return validateProject(value);
}

export function serializeProject(project: Project): string {
  return boundedJson(JSON.stringify(validateProject(project), null, 2));
}

export class ProjectHistory {
  #current: Project;
  #past: Project[] = [];
  #future: Project[] = [];

  constructor(initial: Project) { this.#current = validateProject(initial); }
  get current(): Project { return validateProject(this.#current); }
  get canUndo(): boolean { return this.#past.length > 0; }
  get canRedo(): boolean { return this.#future.length > 0; }

  commit(next: Project): boolean {
    const snapshot = validateProject(next);
    if (JSON.stringify(snapshot) === JSON.stringify(this.#current)) return false;
    this.#past.push(this.#current);
    if (this.#past.length > MAX_HISTORY_STEPS) this.#past.shift();
    this.#current = snapshot;
    this.#future = [];
    return true;
  }

  undo(): Project {
    if (this.canUndo) {
      this.#future.push(this.#current);
      this.#current = this.#past.pop()!;
    }
    return this.current;
  }

  redo(): Project {
    if (this.canRedo) {
      this.#past.push(this.#current);
      this.#current = this.#future.pop()!;
    }
    return this.current;
  }

  reset(project: Project): void {
    const snapshot = validateProject(project);
    this.#current = snapshot;
    this.#past = [];
    this.#future = [];
  }
}
