import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLibraryEntry, validateLibraryHead, validateProjectRow, validateLibraryKeys,
  createProjectRow, projectEntry, validateLibraryId } from '../src/library-model.ts';
import type { Project } from '../src/model.ts';

// Original literal geometry and identities; no producer factory computes expectations.
const ID = '10400000-0000-4000-8000-000000000001';
const REV = '10400000-0000-4000-8000-000000000002';
const HEAD_REV = '10400000-0000-4000-8000-000000000003';
function project(): Project {
  return { schemaVersion: 2, title: 'Original copper motion', background: '#102030', frameCount: 24,
    layers: [{ id: 'original-copper', name: 'Copper', kind: 'drawing',
      cels: [{ frame: 0, strokes: [{ color: '#b87333', width: 3,
        points: [{ x: -7, y: 11 }, { x: 23, y: 41 }] }] }, { frame: 13, strokes: [] }],
      keys: [{ x: 91, y: 47, scale: 1.25, rotation: -17, opacity: .625, frame: 0, easing: 'linear' }] }] };
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
function entry() { return { id: ID, revision: REV, title: project().title,
  frameCount: 24, layerCount: 1, projectBytes: bytes(project()) }; }
function head() { return { schemaVersion: 1 as const, revision: HEAD_REV, activeId: ID, entries: [entry()] }; }
function row() { return { schemaVersion: 1 as const, id: ID, revision: REV, project: project() }; }

test('literal entry/head/row preserve exact metadata and detached nested geometry', () => {
  assert.deepEqual(validateLibraryEntry(entry()), entry());
  assert.deepEqual(validateLibraryHead(head()), head());
  const original = row(); const result = validateProjectRow(original, entry());
  assert.deepEqual(result, original);
  result.project.layers[0].keys[0].x = 100;
  assert.equal(original.project.layers[0].keys[0].x, 91);
  const captured = validateLibraryHead(head()); captured.entries[0].title = 'Different';
  assert.equal(head().entries[0].title, 'Original copper motion');
});

test('derived row and entry match independently counted canonical UTF8 bytes', () => {
  assert.deepEqual(createProjectRow(project(), ID, REV), row());
  assert.deepEqual(projectEntry(row()), entry());
  assert.equal(validateLibraryId(ID), ID);
});

test('UUIDv4 identity admission rejects aliases and wrong variants or versions', () => {
  for (const value of ['104ABC00-0000-4000-8000-000000000001', ` ${ID}`, `${ID}\n`, '',
    ID.replace('-4000-', '-3000-'), ID.replace('-8000-', '-7000-'), 1, null]) {
    assert.throws(() => validateLibraryId(value as string));
  }
});

test('empty library is authoritative and eight creation-order entries admit, ninth refuses', () => {
  const empty = { schemaVersion: 1, revision: HEAD_REV, activeId: null, entries: [] };
  assert.deepEqual(validateLibraryHead(empty), empty);
  const entries = Array.from({ length: 8 }, (_, i) => ({ ...entry(),
    id: `10400000-0000-4000-8000-${String(i + 10).padStart(12, '0')}` }));
  assert.deepEqual(validateLibraryHead({ ...head(), activeId: entries[7].id, entries }).entries, entries);
  assert.throws(() => validateLibraryHead({ ...head(), entries: [...entries, entry()] }));
  for (const change of [{ activeId: null }, { activeId: REV }, { entries: [] },
    { entries: [entry(), entry()] }, { schemaVersion: 2 }]) {
    assert.throws(() => validateLibraryHead({ ...head(), ...change }));
  }
});

test('key membership distinguishes missing catalog, orphan rows and exact unordered keyset', () => {
  assert.doesNotThrow(() => validateLibraryKeys(null, []));
  assert.throws(() => validateLibraryKeys(null, [ID]));
  assert.doesNotThrow(() => validateLibraryKeys(head(), [ID]));
  for (const keys of [[], [ID, REV], [REV], [ID, ID], [undefined], new Array(1)]) {
    assert.throws(() => validateLibraryKeys(head(), keys));
  }
  const other = { ...entry(), id: REV };
  assert.doesNotThrow(() => validateLibraryKeys({ ...head(), entries: [entry(), other] }, [REV, ID]));
});

test('metadata is exact including title, byte count, layer count and row identity', () => {
  for (const change of [{ id: REV }, { revision: HEAD_REV }, { title: 'Different' },
    { frameCount: 25 }, { layerCount: 0 }, { projectBytes: entry().projectBytes + 1 }]) {
    assert.throws(() => validateProjectRow(row(), { ...entry(), ...change }));
  }
});

test('metadata bounds preserve legacy UTF16 text policy without normalizing it', () => {
  assert.equal(validateLibraryEntry({ ...entry(), title: ' x ' }).title, ' x ');
  assert.equal(validateLibraryEntry({ ...entry(), title: '\ud800' }).title, '\ud800');
  assert.equal(validateLibraryEntry({ ...entry(), title: '😀'.repeat(40) }).title.length, 80);
  assert.doesNotThrow(() => validateLibraryEntry({ ...entry(), projectBytes: 6_291_624, frameCount: 96, layerCount: 8 }));
  for (const change of [{ title: '😀'.repeat(41) }, { title: '' }, { title: ' ' }, { title: 'x\0' },
    { frameCount: 11 }, { frameCount: 97 }, { frameCount: 12.5 }, { layerCount: 9 },
    { projectBytes: 0 }, { projectBytes: 6_291_625 }, { projectBytes: Infinity }]) {
    assert.throws(() => validateLibraryEntry({ ...entry(), ...change }));
  }
});

test('unknown fields, accessors, symbols and exotic prototypes reject without invoking getters', () => {
  let invoked = false;
  const accessor = { ...entry() };
  Object.defineProperty(accessor, 'title', { enumerable: true, get() { invoked = true; return 'Getter'; } });
  for (const value of [{ ...entry(), extra: true }, accessor,
    Object.assign(Object.create({ inherited: true }), entry()), { ...entry(), [Symbol('hidden')]: 1 }]) {
    assert.throws(() => validateLibraryEntry(value));
  }
  assert.equal(invoked, false);
  const hidden = { ...head() }; Object.defineProperty(hidden, 'hidden', { value: 1 });
  assert.throws(() => validateLibraryHead(hidden));
  const sparse = new Array(1); assert.throws(() => validateLibraryHead({ ...head(), entries: sparse }));
  const extraArray = [entry()]; Object.assign(extraArray, { extra: true });
  assert.throws(() => validateLibraryHead({ ...head(), entries: extraArray }));
});

test('project rows require canonical schema2 rather than silently migrating private storage', () => {
  const legacy = { schemaVersion: 1, title: 'Original legacy', background: '#ffffff', frameCount: 12,
    layers: [{ id: 'legacy', name: 'Legacy', kind: 'drawing', strokes: [],
      keys: [{ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, frame: 0, easing: 'hold' }] }] };
  assert.throws(() => validateProjectRow({ ...row(), project: legacy }));
  for (const value of [undefined, null, { ...row(), schemaVersion: 2 }, { ...row(), extra: 1 },
    { ...row(), project: { ...project(), schemaVersion: 3 } }]) {
    assert.throws(() => validateProjectRow(value));
  }
});
