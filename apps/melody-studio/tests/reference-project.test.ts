import test from 'node:test';
import assert from 'node:assert/strict';
import { notesOnly, validateDocument, validateAsset, validateBundle, withComposition, ReferenceHistory } from '../src/reference-project.ts';
import { REFERENCE_LIMITS as limits } from '../src/reference-types.ts';
import type { MelodyDocument, ReferenceAsset, ReferenceBundle } from '../src/reference-types.ts';
import type { Composition } from '../src/types.ts';
import { parseComposition } from '../src/model.ts';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
function composition(count = 1): Composition {
  return { version: 1, title: 'A take', tempo: 120, tracks: Array.from({ length: count }, (_, n) => ({
    id: `track-${n}`, name: `Track ${n}`, instrument: 'sine', volume: 0.8, muted: false,
    notes: [{ id: `note-${n}`, pitch: 60, start: 0, duration: 1, velocity: 0.8 }],
  })) };
}
function asset(n = 1, frames = 10): ReferenceAsset {
  const pcm = new Uint8Array(frames * 2); pcm[0] = n % 256;
  return { id: id(n), kind: 'audio-file', captureTempo: 108, decodedSampleRate: 22050,
    decodedChannels: 1, decodedFrames: frames, analyzedFrames: frames, frameCount: frames, pcm };
}
function bundle(assets = [asset()]): ReferenceBundle {
  return { document: { schemaVersion: 1, composition: composition(assets.length || 1), references: assets.map((a, i) => ({ trackId: `track-${i}`, assetId: a.id })) }, assets };
}
function changed(document: MelodyDocument, title: string): MelodyDocument {
  return { ...document, composition: { ...document.composition, title } };
}

test('notes-only conversion preserves legacy normalization and exact UTF-16 values', () => {
  const source = composition(); source.title = '  A\0\ud800B  '; source.tracks[0].id = 'track\0\udfff';
  source.tracks[0].name = 'N\ud800'; source.tracks[0].notes[0].id = 'note\0\udfff';
  const doc = notesOnly(source);
  assert.equal(doc.composition.title, 'A\0\ud800B'); assert.equal(doc.composition.tracks[0].name, 'N\ud800');
  assert.deepEqual(doc.references, []);
  const bound = { ...doc, references: [{ trackId: source.tracks[0].id, assetId: id(1) }] };
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(bound))), bound);
  doc.composition.tracks[0].notes[0].pitch = 96;
  assert.equal(source.tracks[0].notes[0].pitch, 60);
});

test('document validates exact shapes and canonical names without reading accessors', () => {
  const valid = bundle().document;
  let read = false;
  const accessor = { ...valid }; Object.defineProperty(accessor, 'composition', { get() { read = true; return composition(); }, enumerable: true });
  const extraNote = structuredClone(valid); Object.assign(extraNote.composition.tracks[0].notes[0], { extra: true });
  const whitespace = structuredClone(valid); whitespace.composition.title = ' A take ';
  const custom = Object.assign(Object.create({}), valid);
  const sparse = structuredClone(valid); sparse.composition.tracks[0].notes = new Array(1);
  const extraArray = structuredClone(valid); Object.assign(extraArray.references, { surprise: 1 });
  const symbol = { ...valid, [Symbol('extra')]: 1 };
  for (const value of [{ ...valid, extra: true }, accessor, extraNote, whitespace, custom, sparse, extraArray, symbol]) assert.throws(() => validateDocument(value));
  assert.equal(read, false); assert.deepEqual(validateDocument(valid), valid);
});

test('bindings are exact, unique, existing, and canonicalized by track order', () => {
  const source = bundle([asset(1), asset(2)]).document; source.references.reverse();
  assert.deepEqual(validateDocument(source).references.map(r => r.trackId), ['track-0', 'track-1']);
  for (const refs of [[source.references[0], source.references[0]], [{ trackId: 'missing', assetId: id(1) }], [{ trackId: 'track-0', assetId: `${id(1)}\n` }]]) assert.throws(() => validateDocument({ ...source, references: refs }));
  source.references[0].assetId = id(1);
  assert.equal(validateDocument(source).references.length, 2, 'two tracks may share one asset');
});

test('document allowance covers maximum escaped engine IDs within its 2 MiB bound', () => {
  const source = composition(8);
  for (let track = 0; track < 8; track++) source.tracks[track].notes = Array.from({ length: 256 }, (_, n) => ({
    id: `${track}:${n}:`.padEnd(100, '\0'), pitch: 60, start: 0, duration: 1, velocity: 0.8,
  }));
  assert.ok(new TextEncoder().encode(JSON.stringify(source)).length > 1024 * 1024);
  assert.equal(limits.documentBytes, 2 * 1024 * 1024);
  const result = notesOnly(source);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length <= limits.documentBytes);
  assert.deepEqual(result.composition, source);
});

test('asset admits exact decoded padding/frame rules and detaches a PCM subarray', () => {
  const raw = asset(); raw.decodedSampleRate = 48000; raw.decodedFrames = 964800;
  raw.analyzedFrames = 960000; raw.frameCount = 441000; raw.pcm = new Uint8Array(882004).subarray(2, 882002); raw.pcm[0] = 123;
  const result = validateAsset(raw);
  assert.equal(result.pcm.length, 882000); assert.equal(result.pcm.byteOffset, 0);
  result.pcm[0] = 7; assert.equal(raw.pcm[0], 123);
  assert.equal(validateAsset({ ...asset(), decodedSampleRate: 48000, decodedFrames: 23, analyzedFrames: 23 }).frameCount, 10);
});

test('asset rejects wrong metadata, noncanonical IDs and byte shapes', () => {
  const source = asset();
  for (const patch of [
    { id: id(1).replace('8000', 'A000') }, { id: `${id(1)}\n` }, { kind: 'unknown' },
    { captureTempo: NaN }, { captureTempo: 241 }, { decodedSampleRate: 22050.5 }, { decodedSampleRate: 7999 },
    { decodedChannels: 33 }, { decodedChannels: 0 }, { decodedFrames: 0 }, { decodedFrames: 443206 },
    { analyzedFrames: 9 }, { frameCount: 9 }, { pcm: new Uint8Array(21) }, { pcm: new Int16Array(10) },
    { pcm: new Uint8Array(limits.assetBytes + 2) }, { extra: 'unknown' },
  ]) assert.throws(() => validateAsset({ ...source, ...patch }));
  const pcm = new Uint8Array(20); structuredClone(pcm.buffer, { transfer: [pcm.buffer] });
  assert.throws(() => validateAsset({ ...source, pcm }));
  assert.throws(() => validateAsset({ ...source, pcm: new Uint8Array(new SharedArrayBuffer(20)) }), /PCM|buffer|shared/i);
});

test('bundle requires exactly referenced distinct assets and sorts assets by ID', () => {
  const source = bundle([asset(2), asset(1)]);
  assert.deepEqual(validateBundle(source).assets.map(a => a.id), [id(1), id(2)]);
  for (const assets of [[], [source.assets[0]], [...source.assets, asset(3)], [source.assets[0], source.assets[0]], new Array(2)]) assert.throws(() => validateBundle({ document: source.document, assets }));
  assert.throws(() => validateBundle({ ...source, extra: true }));
  const shared = bundle([asset(1), asset(2)]); shared.document.references[1].assetId = id(1); shared.assets.pop();
  assert.equal(validateBundle(shared).assets.length, 1);
});

test('withComposition retains only surviving bindings and detaches state', () => {
  const original = bundle([asset(1), asset(2)]).document;
  const next = structuredClone(original.composition); next.tracks.shift(); next.tempo = 90;
  const result = withComposition(original, next);
  assert.equal(result.composition.tempo, 90); assert.deepEqual(result.references, [original.references[1]]);
  result.references[0].assetId = id(3); assert.equal(original.references[1].assetId, id(2));
});

test('replacement, shared duplication, removal and undo restore exact audio', () => {
  const initial = bundle(); const history = new ReferenceHistory(initial);
  const replacement = bundle([asset(2)]); history.commit(replacement.document, replacement.assets);
  initial.assets[0].pcm[0] = 99; replacement.assets[0].pcm[0] = 98;
  assert.equal(history.asset(id(1)).pcm[0], 1); assert.equal(history.asset(id(2)).pcm[0], 2);
  const duplicated = history.current;
  duplicated.composition.tracks.push({ ...structuredClone(duplicated.composition.tracks[0]), id: 'copy', notes: [] });
  duplicated.references.push({ trackId: 'copy', assetId: id(2) }); history.commit(duplicated);
  assert.equal(history.assetBytes, 40);
  const removed = history.current; removed.references = []; history.commit(removed);
  assert.equal(history.snapshot().assets.length, 0);
  assert.equal(history.undo()?.references.length, 2); assert.equal(history.undo()?.references.length, 1);
  assert.equal(history.undo()?.references[0].assetId, id(1)); assert.equal(history.redo()?.references[0].assetId, id(2));
});

test('history getters detach bytes and metadata; clear keeps only current assets', () => {
  const history = new ReferenceHistory(bundle()); const next = bundle([asset(2)]); history.commit(next.document, next.assets);
  const output = history.snapshot(); output.assets[0].pcm.fill(99); output.document.references.length = 0;
  history.asset(id(2)).pcm.fill(98); history.current.composition.title = 'external mutation';
  history.undo()!.composition.title = 'another mutation'; assert.equal(history.current.composition.title, 'A take');
  history.clear(); assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
  assert.equal(history.assetBytes, 20); assert.equal(history.asset(id(1)).pcm[0], 1);
  assert.throws(() => history.asset(id(2)), /reference|asset/i);
});

test('no-op preserves redo; missing, conflicting and orphan assets reject atomically', () => {
  const history = new ReferenceHistory(bundle()); history.commit(changed(history.current, 'second')); history.undo();
  assert.equal(history.commit(history.current, [asset()]), false); assert.equal(history.canRedo, true);
  const before = history.snapshot(); const missing = bundle([asset(3)]).document;
  const collision = asset(); collision.pcm[0] = 9;
  const pairs: [MelodyDocument, ReferenceAsset[]][] = [
    [missing, []], [history.current, [collision]], [history.current, [{ ...asset(), captureTempo: 109 }]],
    [history.current, [asset(2)]], [history.current, [asset(), asset()]], [history.current, new Array(1)],
    [history.current, Array.from({ length: 9 }, (_, n) => asset(n + 1))],
  ];
  for (const [doc, incoming] of pairs) {
    assert.throws(() => history.commit(doc, incoming)); assert.deepEqual(history.snapshot(), before);
    assert.equal(history.canRedo, true); assert.equal(history.assetBytes, 20);
  }
  assert.equal(history.redo()?.composition.title, 'second');
});

test('fifty prior states retained; normal eviction frees only unreachable assets', () => {
  const history = new ReferenceHistory(bundle()); history.commit(notesOnly(composition()));
  for (let n = 2; n <= 50; n++) history.commit(changed(history.current, `edit ${n}`));
  assert.equal(history.assetBytes, 20); history.commit(changed(history.current, 'edit 51')); assert.equal(history.assetBytes, 0);
  let count = 0; while (history.undo()) count++; assert.equal(count, 50); assert.equal(history.current.references.length, 0);
});

function atAudioCap(): ReferenceHistory {
  const history = new ReferenceHistory(bundle(Array.from({ length: 8 }, (_, n) => asset(n + 1, limits.frames))));
  for (let first = 9; first <= 65; first += 8) {
    const next = bundle(Array.from({ length: 8 }, (_, n) => asset(first + n, limits.frames))); history.commit(next.document, next.assets);
  }
  const frames = (limits.historyAssetBytes - 76 * limits.assetBytes) / 2;
  const last = bundle([...Array.from({ length: 4 }, (_, n) => asset(n + 73, limits.frames)), asset(77, frames)]);
  history.commit(last.document, last.assets); return history;
}

test('actual64MiB boundary rejects overflow; branching reclaims redo before admission', () => {
  const history = atAudioCap(); assert.equal(history.assetBytes, 64 * 1024 * 1024);
  const next = bundle([asset(78, 1)]); const before = history.current;
  assert.throws(() => history.commit(next.document, next.assets), /64 MiB|history|audio/i);
  assert.deepEqual(history.current, before); assert.equal(history.canRedo, false);
  history.undo(); assert.equal(history.assetBytes, limits.historyAssetBytes);
  assert.equal(history.commit(next.document, next.assets), true); assert.equal(history.canRedo, false);
  assert.equal(history.assetBytes, 72 * limits.assetBytes + 2); assert.throws(() => history.asset(id(77)));
});

test('normal oldest-state eviction is projected before audio budget admission', () => {
  const history = atAudioCap();
  for (let n = 0; n < 41; n++) history.commit(changed(history.current, `metadata ${n}`));
  assert.equal(history.assetBytes, limits.historyAssetBytes);
  const next = bundle([asset(78, 1)]); assert.equal(history.commit(next.document, next.assets), true);
  assert.equal(history.assetBytes, limits.historyAssetBytes - 8 * limits.assetBytes + 2); assert.throws(() => history.asset(id(1)));
  let count = 0; while (history.undo()) count++; assert.equal(count, 50);
});

test('invalid asset graphs and accessor fields reject without executing getters', () => {
  const initial = bundle(); const history = new ReferenceHistory(initial);
  let reads = 0;
  const incoming = asset(2);
  Object.defineProperty(incoming, 'pcm', { enumerable: true, get() { reads++; return new Uint8Array(20); } });
  assert.throws(() => history.commit(history.current, [incoming]));
  const indexed: ReferenceAsset[] = new Array(1);
  Object.defineProperty(indexed, '0', { enumerable: true, get() { reads++; return asset(); } });
  assert.throws(() => history.commit(history.current, indexed));
  const badBytes = asset();
  Object.defineProperty(badBytes.pcm, 'byteLength', { get() { reads++; return 20; } });
  assert.throws(() => validateAsset(badBytes));
  assert.equal(reads, 0);
  assert.deepEqual(history.snapshot(), initial);
  assert.equal(history.canUndo, false);
});

test('frozen valid records are accepted and input mutations cannot change registered metadata', () => {
  const initial = bundle(); Object.freeze(initial.document.composition.tracks[0].notes[0]);
  Object.freeze(initial.document.references); Object.freeze(initial.assets[0]); Object.freeze(initial.assets);
  const history = new ReferenceHistory(initial);
  initial.document.composition.title = 'changed externally';
  initial.assets[0].pcm[0] = 75;
  assert.equal(history.current.composition.title, 'A take');
  assert.equal(history.asset(id(1)).pcm[0], 1);
  assert.equal(history.asset(id(1)).captureTempo, 108);
});


test('near-cap legacy JSON remains importable after wrapper and numeric serialization growth', () => {
  const source = composition(8);
  for (let track = 0; track < 8; track++) source.tracks[track].notes = Array.from({ length: 256 }, (_, index) => ({
    id: `${track}:${index}:`.padEnd(100, 'a'), pitch: 60, start: 0.000001, duration: 1, velocity: 0.000001,
  }));
  const legacyText = () => JSON.stringify(source).replaceAll(':0.000001', ':1e-6');
  let replacements = Math.floor((1024 * 1024 - 20 - legacyText().length) / 5);
  for (const track of source.tracks) for (const note of track.notes) {
    const padding = note.id.length - note.id.lastIndexOf(':') - 1;
    const count = Math.min(replacements, padding);
    note.id = note.id.slice(0, note.id.length - count) + '\0'.repeat(count);
    replacements -= count;
  }
  const input = legacyText();
  assert.ok(input.length <= 1024 * 1024 && input.length > 1024 * 1024 - 25);
  const legacy = parseComposition(input);
  assert.ok(JSON.stringify(legacy).length > 1024 * 1024, 'accepted short numeric input grows on canonical serialization');
  const document = notesOnly(legacy);
  assert.deepEqual(document.composition, legacy);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(document))), document);
});
