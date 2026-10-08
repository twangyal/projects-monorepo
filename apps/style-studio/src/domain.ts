import {
  CATEGORIES, PALETTES, FITS, STYLES, FORMALITIES, ID_PATTERN, LIMITS,
  type Category, type Label, type Tags, type Piece, type PieceIds, type OutfitPieces,
  type PreferenceExample, type SavedLook, type Project, type PhotoAsset,
} from './types.ts';
import { featuresFromTags, averageFeatures, validateFeatures } from './features.ts';
import { validatePhotoAsset } from './photo-header.ts';

function fail(message: string): never { throw new Error(message); }
function object(value: unknown, required: readonly string[], label: string, optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object.`);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || ![...required, ...optional].includes(key))
      || required.some(key => !Object.hasOwn(value, key))) fail(`${label} contains missing or unknown fields.`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) fail(`${label} must contain ordinary data fields.`);
  }
  return value as Record<string, unknown>;
}
function list(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label} must contain at most ${maximum} records.`);
  if (Reflect.ownKeys(value).length !== value.length + 1) fail(`${label} must be a dense array without extra fields.`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) fail(`${label} must contain ordinary array values.`);
  }
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(`${label} must be a 32-character lowercase hexadecimal ID.`);
  return value;
}
function photoReference(value: unknown): string | null { return value === null ? null : identifier(value, 'Photo reference'); }
function text(value: unknown, maximum: number, label: string, preserve = false, empty = false): string {
  if (typeof value !== 'string') fail(`${label} must be text.`);
  const result = preserve ? value : value.trim();
  if ((!empty && !result.trim()) || result.length > maximum) fail(`${label} must contain ${empty ? '0' : '1'}–${maximum} characters.`);
  for (const char of result) {
    const code = char.codePointAt(0)!;
    if ((code >= 0xd800 && code <= 0xdfff) || code === 127
        || (code < 32 && !(preserve && '\n\r\t'.includes(char)))) fail(`${label} contains invalid Unicode or unsupported control characters.`);
  }
  return result;
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !options.includes(value as T)) fail(`${label} is not supported.`);
  return value as T;
}
function validateTags(value: unknown): Tags {
  const tags = object(value, ['palette', 'fit', 'style', 'formality'], 'Tags');
  return {
    palette: choice(tags.palette, PALETTES, 'Palette'), fit: choice(tags.fit, FITS, 'Fit'),
    style: choice(tags.style, STYLES, 'Style'), formality: choice(tags.formality, FORMALITIES, 'Formality'),
  };
}
function validatePiece(value: unknown): Piece {
  const piece = object(value, ['id', 'name', 'category', 'tags', 'photoId'], 'Piece');
  return { id: identifier(piece.id, 'Piece ID'), name: text(piece.name, 80, 'Piece name'),
    category: choice(piece.category, CATEGORIES, 'Category'), tags: validateTags(piece.tags), photoId: photoReference(piece.photoId) };
}
function validateExample(value: unknown): PreferenceExample {
  const example = object(value, ['id', 'caption', 'label', 'origin', 'features', 'photoId', 'sourceLookId'], 'Example');
  const origin = choice(example.origin, ['tagged', 'outfit'], 'Example origin');
  const sourceLookId = origin === 'outfit' ? identifier(example.sourceLookId, 'Source look ID') : null;
  if (origin === 'tagged' && example.sourceLookId !== null) fail('Tagged examples cannot have a source look.');
  if (origin === 'outfit' && example.photoId !== null) fail('Outfit examples cannot have a photo reference.');
  // Bound and reject holes/accessors before passing the leaf feature validator.
  list(example.features, 14, 'Features');
  return { id: identifier(example.id, 'Example ID'), caption: text(example.caption, 160, 'Example caption', true),
    label: choice(example.label, ['like', 'pass'], 'Label'), origin,
    features: validateFeatures(example.features, origin), photoId: photoReference(example.photoId), sourceLookId };
}
function validateLook(value: unknown): SavedLook {
  const look = object(value, ['id', 'name', 'notes', 'pieces'], 'Saved look');
  const pieces = list(look.pieces, 3, 'Outfit pieces').map(validatePiece);
  if (pieces.length !== 3 || pieces.some((piece, index) => piece.category !== CATEGORIES[index])
      || new Set(pieces.map(piece => piece.id)).size !== 3) fail('A saved look needs distinct top, bottom and shoes snapshots in that order.');
  return { id: identifier(look.id, 'Look ID'), name: text(look.name, 80, 'Look name'),
    notes: text(look.notes, 500, 'Look notes', true, true), pieces: pieces as unknown as OutfitPieces };
}
function bounded(serialized: string): string {
  if (serialized.length > LIMITS.projectBytes || new TextEncoder().encode(serialized).byteLength > LIMITS.projectBytes) fail('Profile exceeds the 8 MiB serialized limit.');
  return serialized;
}

export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function createProject(title = 'My style'): Project {
  return validateProject({ schemaVersion: 1, title, pieces: [], examples: [], looks: [], photos: [] });
}
export function validateProject(value: unknown): Project {
  const project = object(value, ['schemaVersion', 'title', 'pieces', 'examples', 'looks', 'photos'], 'Profile');
  if (project.schemaVersion !== 1) fail('Unsupported profile schema version; use version 1.');
  const result: Project = { schemaVersion: 1, title: text(project.title, 80, 'Profile title'),
    pieces: list(project.pieces, LIMITS.pieces, 'Wardrobe').map(validatePiece),
    examples: list(project.examples, LIMITS.examples, 'Examples').map(validateExample),
    looks: list(project.looks, LIMITS.looks, 'Saved looks').map(validateLook),
    photos: list(project.photos, LIMITS.photos, 'Photos').map(validatePhotoAsset) };
  for (const category of CATEGORIES) if (result.pieces.filter(piece => piece.category === category).length > LIMITS.piecesPerCategory) fail(`Keep at most ${LIMITS.piecesPerCategory} ${category} pieces.`);
  const ids = new Set<string>();
  for (const entity of [...result.pieces, ...result.examples, ...result.looks, ...result.photos]) {
    if (ids.has(entity.id)) fail('Profile entity IDs must be unique.');
    ids.add(entity.id);
  }
  const sources = new Set<string>();
  for (const example of result.examples) if (example.sourceLookId !== null) {
    if (sources.has(example.sourceLookId)) fail('Each saved look may have only one rating example.');
    sources.add(example.sourceLookId);
  }
  const photos = new Set(result.photos.map(photo => photo.id));
  for (const photoId of usedPhotos(result)) if (!photos.has(photoId)) fail('A referenced photo is missing from this profile.');
  bounded(JSON.stringify(result));
  return result;
}

/** JSON.parse does not reject duplicate keys. Scan before parsing, with bounded
 * nesting and decoded-key comparisons, so escaped aliases are also rejected. */
function checkJson(text: string): void {
  let cursor = 0;
  const malformed = () => fail('Supply valid JSON for a Style Studio profile.');
  const whitespace = () => { while (cursor < text.length && /[\t\r\n ]/.test(text[cursor])) cursor++; };
  const string = (): string => {
    if (text[cursor] !== '"') malformed();
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (char === '\\') cursor++;
      else if (char === '"') {
        try { return JSON.parse(text.slice(start, cursor)) as string; } catch { malformed(); }
      }
    }
    return malformed();
  };
  const value = (depth: number): void => {
    if (depth > 32) fail('Profile JSON is nested too deeply.');
    whitespace();
    const char = text[cursor];
    if (char === '{') {
      cursor++; whitespace(); const keys = new Set<string>();
      if (text[cursor] === '}') { cursor++; return; }
      while (cursor < text.length) {
        whitespace(); const key = string();
        if (keys.has(key)) fail('Duplicate JSON object keys are not supported.'); keys.add(key);
        whitespace(); if (text[cursor++] !== ':') malformed(); value(depth + 1); whitespace();
        const end = text[cursor++]; if (end === '}') return; if (end !== ',') malformed();
      }
      malformed();
    } else if (char === '[') {
      cursor++; whitespace(); if (text[cursor] === ']') { cursor++; return; }
      while (cursor < text.length) { value(depth + 1); whitespace(); const end = text[cursor++]; if (end === ']') return; if (end !== ',') malformed(); }
      malformed();
    } else if (char === '"') string();
    else {
      const start = cursor;
      while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor++;
      if (start === cursor) malformed();
      try { JSON.parse(text.slice(start, cursor)); } catch { malformed(); }
    }
  };
  value(0); whitespace(); if (cursor !== text.length) malformed();
}
export function parseProject(text: string): Project {
  if (typeof text !== 'string') fail('Profile import must be JSON text.');
  bounded(text); checkJson(text);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { fail('Supply valid JSON for a Style Studio profile.'); }
  return validateProject(parsed);
}
export function serializeProject(project: Project): string { return bounded(JSON.stringify(validateProject(project))); }

function usedPhotos(project: Project): Set<string> {
  return new Set([...project.pieces, ...project.examples, ...project.looks.flatMap(look => [...look.pieces])]
    .map(entity => entity.photoId).filter((id): id is string => id !== null));
}
function finish(project: Project): Project {
  const used = usedPhotos(project);
  project.photos = project.photos.filter(photo => used.has(photo.id));
  return validateProject(project);
}
export function collectUnusedPhotos(project: Project): Project { return finish(validateProject(project)); }
function find<T extends { id: string }>(values: T[], id: string, label: string): T {
  identifier(id, `${label} ID`);
  return values.find(value => value.id === id) ?? fail(`The selected ${label} no longer exists.`);
}
function publishPhoto(project: Project, reference: string | null, photo?: PhotoAsset): void {
  if (photo === undefined) return;
  const validated = validatePhotoAsset(photo);
  if (validated.id !== reference) fail('The new photo must be referenced by the same edit.');
  if (project.photos.some(asset => asset.id === validated.id)) fail('A photo with this ID already exists.');
  project.photos.push(validated);
}
export function setTitle(project: Project, title: string): Project {
  const next = validateProject(project); next.title = text(title, 80, 'Profile title'); return finish(next);
}
export function addPiece(project: Project, input: { name: string; category: Category; tags: Tags; photoId: string | null }, photo?: PhotoAsset): Project {
  object(input, ['name', 'category', 'tags', 'photoId'], 'New piece');
  const next = validateProject(project), piece = validatePiece({ ...input, id: newId() });
  publishPhoto(next, piece.photoId, photo); next.pieces.push(piece); return finish(next);
}
export function updatePiece(project: Project, id: string, patch: Partial<Pick<Piece, 'name' | 'category' | 'tags' | 'photoId'>>, photo?: PhotoAsset): Project {
  object(patch, [], 'Piece edit', ['name', 'category', 'tags', 'photoId']);
  const next = validateProject(project), old = find(next.pieces, id, 'piece'), piece = validatePiece({ ...old, ...patch });
  publishPhoto(next, piece.photoId, photo); next.pieces[next.pieces.indexOf(old)] = piece; return finish(next);
}
export function deletePiece(project: Project, id: string): Project {
  const next = validateProject(project); find(next.pieces, id, 'piece'); next.pieces = next.pieces.filter(piece => piece.id !== id); return finish(next);
}
export function addTaggedExample(project: Project, input: { caption: string; label: Label; tags: Tags; photoId: string | null }, photo?: PhotoAsset): Project {
  object(input, ['caption', 'label', 'tags', 'photoId'], 'New example');
  const next = validateProject(project), example = validateExample({
    id: newId(), caption: input.caption, label: input.label, origin: 'tagged',
    features: featuresFromTags(validateTags(input.tags)), photoId: input.photoId, sourceLookId: null,
  });
  publishPhoto(next, example.photoId, photo); next.examples.push(example); return finish(next);
}
export function setExampleLabel(project: Project, id: string, label: Label): Project {
  const next = validateProject(project); find(next.examples, id, 'example').label = choice(label, ['like', 'pass'], 'Label'); return finish(next);
}
export function deleteExample(project: Project, id: string): Project {
  const next = validateProject(project); find(next.examples, id, 'example'); next.examples = next.examples.filter(example => example.id !== id); return finish(next);
}
export function saveLook(project: Project, pieceIds: PieceIds, name: string, notes = ''): Project {
  const next = validateProject(project), ids = list(pieceIds, 3, 'Outfit selection');
  if (ids.length !== 3) fail('Select a top, bottom and shoes.');
  const pieces = ids.map(id => find(next.pieces, identifier(id, 'Piece ID'), 'piece'));
  next.looks.push(validateLook({ id: newId(), name, notes, pieces })); return finish(next);
}
export function updateLook(project: Project, id: string, patch: { name?: string; notes?: string }): Project {
  object(patch, [], 'Look edit', ['name', 'notes']);
  const next = validateProject(project), old = find(next.looks, id, 'look');
  next.looks[next.looks.indexOf(old)] = validateLook({ ...old, ...patch }); return finish(next);
}
export function deleteLook(project: Project, id: string): Project {
  const next = validateProject(project); find(next.looks, id, 'look'); next.looks = next.looks.filter(look => look.id !== id); return finish(next);
}
export function rateLook(project: Project, id: string, label: Label): Project {
  const next = validateProject(project), look = find(next.looks, id, 'look');
  const existing = next.examples.find(example => example.sourceLookId === id);
  const example = validateExample({ id: existing?.id ?? newId(), caption: look.name, label,
    origin: 'outfit', features: averageFeatures(look.pieces), photoId: null, sourceLookId: look.id });
  if (existing) next.examples[next.examples.indexOf(existing)] = example;
  else next.examples.push(example);
  return finish(next);
}
