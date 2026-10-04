import assert from 'node:assert/strict';
import test from 'node:test';
import { createProject, MAX_JSON_BYTES } from '../src/model.ts';
import { createProjectRow, projectEntry, validateLibraryHead, validateLibraryKeys, validateProjectRow, MAX_PROJECT_ROW_BYTES } from '../src/library-model.ts';
import { LibraryReadFailure, ProjectLibrary, SavedProjectConflict } from '../src/library-storage.ts';
const id = '00000000-0000-4000-8000-000000000001';
const revision = '00000000-0000-4000-8000-000000000002';

test('canonical row, derived metadata and detached head preserve accepted UTF16', () => {
  const source = createProject(); source.title = ' Original\ud800 title ';
  const row = createProjectRow(source, id, revision);
  const entry = projectEntry(row);
  assert.equal(entry.title, source.title);
  assert.equal(entry.projectBytes, new TextEncoder().encode(JSON.stringify(source)).length);
  const head = validateLibraryHead({ schemaVersion: 1, revision, activeId: id, entries: [entry] });
  validateLibraryKeys(head, [id]);
  assert.deepEqual(validateProjectRow(row, head.entries[0]), row);
  source.layers.length = 0; head.entries[0].title = 'changed';
  assert.equal(row.project.layers.length, 1); assert.equal(entry.title, ' Original\ud800 title ');
  assert.equal(MAX_PROJECT_ROW_BYTES, MAX_JSON_BYTES + 256);
});

test('permanent empty head and absence both require no orphaned keys', () => {
  const empty = validateLibraryHead({ schemaVersion: 1, revision, activeId: null, entries: [] });
  validateLibraryKeys(empty, []); validateLibraryKeys(null, []);
  assert.throws(() => validateLibraryKeys(null, [id]));
  assert.throws(() => validateLibraryKeys(empty, [id]));
});

test('row metadata disagreement and exact shapes refuse atomically', () => {
  const row = createProjectRow(createProject(), id, revision), entry = projectEntry(row);
  const before = JSON.stringify(row);
  for (const patch of [{ title: 'different' }, { projectBytes: entry.projectBytes + 1 }, { revision: id }]) {
    assert.throws(() => validateProjectRow(row, { ...entry, ...patch }));
  }
  assert.throws(() => validateProjectRow({ ...row, extra: true }));
  assert.throws(() => validateProjectRow({ ...row, project: { ...row.project, schemaVersion: 1 } }));
  assert.equal(JSON.stringify(row), before);
});

test('eight metadata entries admit; nine, duplicate, missing and inherited data refuse', () => {
  const entries = Array.from({ length: 8 }, (_, index) => projectEntry(createProjectRow(createProject(),
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, revision)));
  const head = { schemaVersion: 1, revision, activeId: entries[0].id, entries };
  assert.equal(validateLibraryHead(head).entries.length, 8);
  assert.throws(() => validateLibraryHead({ ...head, entries: [...entries, entries[0]] }));
  assert.throws(() => validateLibraryHead({ ...head, activeId: null }));
  assert.throws(() => validateLibraryHead({ ...head, entries: new Array(8) }));
  assert.throws(() => validateLibraryHead(Object.create(head)));
  assert.throws(() => validateLibraryHead({ ...head, extra: true }));
});

test('storage refuses foreign receipt and closed work without granting authority', async () => {
  const library = new ProjectLibrary();
  assert.throws(() => library.acceptRead({ kind: 'motion-library-receipt' }));
  assert.throws(() => library.acceptProject({ kind: 'motion-project-receipt' }));
  library.close();
  await assert.rejects(library.read());
  await assert.rejects(library.create(createProject()));
  assert.equal(new SavedProjectConflict().name, 'SavedProjectConflict');
});


test('proved recovery error retains unsafe native shape without implying write authority', () => {
  const value: { title: string; self?: unknown; optional: undefined } = { title: 'Original', optional: undefined };
  value.self = value;
  const error = new LibraryReadFailure('legacy', { present: true, value });
  assert.equal(error.name, 'LibraryReadFailure'); assert.equal(error.target, 'legacy');
  assert.equal(error.raw.present, true);
  if (error.raw.present) {
    const raw = error.raw.value as typeof value;
    assert.notEqual(raw, value); assert.equal(raw.self, raw);
    assert.ok(Object.hasOwn(raw, 'optional')); assert.equal(raw.optional, undefined);
    value.title = 'changed'; assert.equal(raw.title, 'Original');
  }
  const orphan = new LibraryReadFailure('head', { present: false });
  assert.equal(orphan.target, 'head'); assert.deepEqual(orphan.raw, { present: false });
});
