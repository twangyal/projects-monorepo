import { MAX_JSON_BYTES, validateProject, type Project } from './model.ts';

export const MAX_LIBRARY_PROJECTS = 8;
export const MAX_LIBRARY_HEAD_BYTES = 8192;
export const MAX_PROJECT_ROW_BYTES = MAX_JSON_BYTES + 256;
export type LibraryEntry = { id: string; revision: string; title: string; frameCount: number; layerCount: number; projectBytes: number };
export type LibraryHead = { schemaVersion: 1; revision: string; activeId: string | null; entries: LibraryEntry[] };
export type ProjectRow = { schemaVersion: 1; id: string; revision: string; project: Project };

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Library values must be plain data objects.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw new Error('Library fields are missing or unsupported.');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== 'string' || !fields.includes(key) || !descriptor.enumerable || !('value' in descriptor)) throw new Error('Library fields must be ordinary own data.');
  }
  return value as Record<string, unknown>;
}
function dense(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_LIBRARY_PROJECTS
      || Reflect.ownKeys(value).length !== value.length + 1) throw new Error('Library arrays must be dense and contain at most eight items.');
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('Library arrays must contain own data values.');
  }
  return value;
}
function integer(value: unknown, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < low || value > high) throw new Error('Library numeric metadata is outside supported bounds.');
  return value;
}
function bytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
export function validateLibraryId(id: unknown): string {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Library IDs and revisions must be lowercase UUIDv4.');
  return id;
}
export function validateLibraryEntry(value: unknown): LibraryEntry {
  const input = object(value, ['id', 'revision', 'title', 'frameCount', 'layerCount', 'projectBytes']);
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80 || input.title.includes('\0')) throw new Error('Project title must contain 1–80 units of text.');
  return { id: validateLibraryId(input.id), revision: validateLibraryId(input.revision), title: input.title,
    frameCount: integer(input.frameCount, 12, 96), layerCount: integer(input.layerCount, 0, 8), projectBytes: integer(input.projectBytes, 1, MAX_JSON_BYTES) };
}
export function validateLibraryHead(value: unknown): LibraryHead {
  const input = object(value, ['schemaVersion', 'revision', 'activeId', 'entries']);
  if (input.schemaVersion !== 1) throw new Error('Unsupported library schema.');
  const entries = dense(input.entries).map(validateLibraryEntry);
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Project IDs must be unique.');
  const activeId = input.activeId === null ? null : validateLibraryId(input.activeId);
  if (entries.length ? !entries.some(entry => entry.id === activeId) : activeId !== null) throw new Error('The active project must match the saved library.');
  const head: LibraryHead = { schemaVersion: 1, revision: validateLibraryId(input.revision), activeId, entries };
  if (bytes(head) > MAX_LIBRARY_HEAD_BYTES) throw new Error('Library metadata exceeds 8 KiB.');
  return head;
}
export function createProjectRow(project: Project, id: string, revision: string): ProjectRow {
  const row: ProjectRow = { schemaVersion: 1, id: validateLibraryId(id), revision: validateLibraryId(revision), project: validateProject(project) };
  if (bytes(row) > MAX_PROJECT_ROW_BYTES) throw new Error('Saved project wrapper exceeds its byte limit.');
  return row;
}
export function projectEntry(row: ProjectRow): LibraryEntry {
  const admitted = createProjectRow(row.project, row.id, row.revision);
  return { id: admitted.id, revision: admitted.revision, title: admitted.project.title,
    frameCount: admitted.project.frameCount, layerCount: admitted.project.layers.length, projectBytes: bytes(admitted.project) };
}
export function validateProjectRow(value: unknown, entry?: LibraryEntry): ProjectRow {
  const input = object(value, ['schemaVersion', 'id', 'revision', 'project']);
  if (input.schemaVersion !== 1 || !input.project || typeof input.project !== 'object'
      || Object.getOwnPropertyDescriptor(input.project, 'schemaVersion')?.value !== 2) throw new Error('Saved library rows require canonical schema-2 projects.');
  const row = createProjectRow(input.project as Project, validateLibraryId(input.id), validateLibraryId(input.revision));
  if (entry && JSON.stringify(projectEntry(row)) !== JSON.stringify(validateLibraryEntry(entry))) throw new Error('Project row disagrees with library metadata.');
  return row;
}
export function validateLibraryKeys(head: LibraryHead | null, keys: unknown[]): void {
  const ids = dense(keys).map(validateLibraryId);
  if (!head) { if (ids.length) throw new Error('Orphaned project rows are protected; no legacy fallback is available.'); return; }
  const admitted = validateLibraryHead(head);
  if (new Set(ids).size !== ids.length || ids.length !== admitted.entries.length || ids.some(id => !admitted.entries.some(entry => entry.id === id))) throw new Error('Saved project membership disagrees with the library.');
}
