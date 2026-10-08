/** Independent literal PCM/document/math oracles, authored before producer reads. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { renderComposition } from '../src/audio.ts';
import { parseComposition } from '../src/model.ts';
import { normalizeReference, referenceWindow, referenceSamples, comparisonComposition, cropComparison } from '../src/reference-audio.ts';
import { notesOnly, validateDocument, validateAsset, validateBundle, withComposition, ReferenceHistory } from '../src/reference-project.ts';
import { encodeProjectBackup, decodeProjectBackup } from '../src/reference-backup.ts';
import type { ReferenceAsset, ReferenceBundle } from '../src/reference-types.ts';
import type { Composition } from '../src/types.ts';

const RATE = 22050;
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function composition(tracks = 1): Composition {
  return { version: 1, title: 'Original independent melody', tempo: 120,
    tracks: Array.from({ length: tracks }, (_, i) => ({ id: `track-${i}`, name: `Voice ${i}`,
      instrument: 'sine' as const, volume: 1, muted: false,
      notes: [{ id: `note-${i}`, pitch: 69, start: 0, duration: .5, velocity: 1 }] })) };
}
function asset(n = 1, frames = 11): ReferenceAsset {
  return { id: uuid(n), kind: 'audio-file', captureTempo: 60, decodedSampleRate: RATE,
    decodedChannels: 1, decodedFrames: frames, analyzedFrames: frames, frameCount: frames,
    pcm: Uint8Array.from({ length: frames * 2 }, (_, i) => (i * 29 + n * 17) & 255) };
}
function bundle(assets = [asset()]): ReferenceBundle {
  const project = composition(assets.length || 1);
  return { document: { schemaVersion: 1, composition: project,
    references: assets.map((audio, i) => ({ trackId: project.tracks[i].id, assetId: audio.id })) }, assets };
}
function literalFile(value: ReferenceBundle): Record<string, unknown> {
  return { format: 'melody-studio-project', version: 1, document: value.document,
    assets: [...value.assets].sort((a, b) => a.id.localeCompare(b.id)).map(audio => ({
      id: audio.id, kind: audio.kind, captureTempo: audio.captureTempo,
      decodedSampleRate: audio.decodedSampleRate, decodedChannels: audio.decodedChannels,
      decodedFrames: audio.decodedFrames, analyzedFrames: audio.analyzedFrames,
      frameCount: audio.frameCount, sha256: hash(audio.pcm), pcmBase64: Buffer.from(audio.pcm).toString('base64'),
    })) };
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const near = (actual: number, expected: number, tolerance = 2e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('oracle: exact asymmetric quantization clips, rounds negative half toward zero and writes LE', async () => {
  const samples = Float32Array.from([0, -2, -1, -.5, -1 / 65536, -3 / 65536, 1 / 65536, 1 / 32768, .5, 1, 2]);
  const original = samples.slice();
  const audio = await normalizeReference(samples, RATE, { kind: 'demo', captureTempo: 137,
    decodedChannels: 2, decodedFrames: samples.length }, new AbortController().signal);
  assert.deepEqual(Array.from(audio.pcm), [0, 0, 0, 128, 0, 128, 0, 192, 0, 0, 255, 255,
    0, 0, 1, 0, 0, 64, 255, 127, 255, 127]);
  assert.equal(audio.frameCount, 11); assert.equal(audio.captureTempo, 137);
  assert.equal(audio.decodedChannels, 2); assert.deepEqual(samples, original);
  const values = referenceSamples(audio, { startFrame: 0, endFrame: 11 });
  [-0, -1, -1, -.5, 0, -1 / 32768, 0, 1 / 32767, 16384 / 32767, 1, 1]
    .forEach((expected, i) => near(values[i], expected, 4e-8));
  audio.pcm.fill(99); assert.deepEqual(samples, original);
});

test('oracle: decoded rate/frame/padding relationships use exact floor arithmetic', () => {
  for (const [rate, frames, analyzed, retained] of [[22050, 441001, 441000, 441000],
    [44100, 882001, 882000, 441000], [48000, 964800, 960000, 441000], [48000, 48001, 48001, 22050],
    [44100, 3, 3, 1]]) {
    const value = { ...asset(1, retained), decodedSampleRate: rate, decodedFrames: frames, analyzedFrames: analyzed };
    assert.deepEqual(validateAsset(value), value);
    assert.throws(() => validateAsset({ ...value, frameCount: retained + 1, pcm: new Uint8Array((retained + 1) * 2) }));
  }
  assert.throws(() => validateAsset({ ...asset(), decodedSampleRate: 48000, decodedFrames: 964801 }));
});

test('oracle: rounded physical frame windows are detached exact-length copies with zero padding', () => {
  assert.deepEqual(referenceWindow(1.49 / RATE, 5.5 / RATE, 8), { startFrame: 1, endFrame: 6 });
  assert.deepEqual(referenceWindow(0, 441000 / RATE, 441000), { startFrame: 0, endFrame: 441000 });
  for (const [start, end, count] of [[0, 0, 8], [1, .5, 8], [0, 9 / RATE, 8], [NaN, 1, 8], [0, Infinity, 8]]) {
    assert.throws(() => referenceWindow(start, end, count));
  }
  const input = Float32Array.from([.125, -.25, .5]);
  const cropped = cropComparison(input, { startFrame: 1, endFrame: 6 });
  assert.deepEqual(cropped, Float32Array.from([-.25, .5, 0, 0, 0]));
  cropped[0] = 99; assert.equal(input[1], -.25);
  assert.throws(() => cropComparison(new Float32Array(16978501), { startFrame: 0, endFrame: 1 }));
});

test('oracle: comparison solo uses capture BPM and keeps pre-window phase, release and zero padded tail', () => {
  const value = bundle([asset(1, RATE * 2)]);
  value.document.composition.tempo = 180;
  value.document.composition.tracks.push({ ...composition().tracks[0], id: 'unselected',
    name: 'Unselected loud part', notes: [{ id: 'other-note', pitch: 60, start: 0, duration: 2, velocity: 1 }] });
  const solo = comparisonComposition(value.document, 'track-0', value.assets[0]);
  assert.equal(solo.tempo, 60); assert.equal(solo.tracks.length, 1);
  assert.deepEqual(solo.tracks[0], value.document.composition.tracks[0]);
  const rendered = renderComposition(solo);
  const cropped = cropComparison(rendered, { startFrame: 10804, endFrame: 13230 });
  assert.equal(cropped.length, 2426);
  for (const index of [10807, 11027, 11891, 12128]) {
    const envelope = index <= 11025 ? 1 : Math.max(0, 1 - (index - 11025) / 1764);
    near(cropped[index - 10804], .4 * Math.sin(2 * Math.PI * 440 * index / RATE) * envelope);
  }
  for (const sample of cropped.subarray(12789 - 10804)) assert.equal(sample, 0);
  const changed = structuredClone(value.document); changed.composition.tempo = 40;
  assert.deepEqual(comparisonComposition(changed, 'track-0', value.assets[0]), solo);
  changed.composition.tracks[0].muted = true;
  assert.ok(renderComposition(comparisonComposition(changed, 'track-0', value.assets[0])).every(sample => sample === 0));
  assert.throws(() => comparisonComposition(value.document, 'unselected', value.assets[0]));
});

test('oracle: louder coincident notes outside the window still set full-solo peak limiting', () => {
  const value = bundle([asset(1, RATE * 4)]);
  const track = value.document.composition.tracks[0];
  track.notes = [{ id: 'quiet', pitch: 69, start: 0, duration: 1, velocity: 1 },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `loud-${i}`, pitch: 69, start: 2, duration: 1, velocity: 1 }))];
  const selected = comparisonComposition(value.document, track.id, value.assets[0]);
  assert.equal(selected.tracks[0].notes.length, 9);
  const full = renderComposition(selected);
  const cropped = cropComparison(full, { startFrame: 11025, endFrame: 11225 });
  const peak = Math.max(...full.subarray(2 * RATE + 300, 3 * RATE).map(Math.abs));
  near(peak, .95, 1e-7);
  // Eight voices make3.2 amplitude outside the selected early interval. The
  // exact discrete sine peak is cos(pi/4410); table interpolation/F32 need2e-6.
  const gain = .4 * .95 / (3.2 * Math.cos(Math.PI / 4410));
  for (const local of [2, 19, 71, 113]) near(cropped[local], gain * Math.sin(2 * Math.PI * 440 * (11025 + local) / RATE));
  assert.ok(Math.max(...cropped.map(Math.abs)) < .12);
});

test('oracle: complete document validation is strict, detached and preserves exact engine UTF-16', () => {
  const value = bundle();
  const project = value.document.composition;
  project.title = '\0Original\ud800'; project.tracks[0].name = 'Voice\udfff\0';
  project.tracks[0].id = 'track\0\ud800'; project.tracks[0].notes[0].id = 'note\udfff\0';
  value.document.references[0].trackId = project.tracks[0].id;
  const admitted = validateBundle(value);
  assert.deepEqual(admitted, value);
  admitted.assets[0].pcm[0] = 222; admitted.document.composition.title = 'Changed returned value';
  assert.notEqual(value.assets[0].pcm[0], 222); assert.equal(project.title, '\0Original\ud800');
  for (const change of [
    (v: ReferenceBundle) => Object.assign(v.document, { unknown: true }),
    (v: ReferenceBundle) => Object.assign(v.document.composition, { unknown: true }),
    (v: ReferenceBundle) => { v.document.composition.title = ' silently trimmed '; },
    (v: ReferenceBundle) => { v.document.references[0].trackId = 'missing'; },
    (v: ReferenceBundle) => { v.assets.push(asset(2)); },
    (v: ReferenceBundle) => { v.assets = []; },
    (v: ReferenceBundle) => { v.document.references.push({ ...v.document.references[0] }); },
  ]) {
    const bad = structuredClone(value); change(bad); assert.throws(() => validateBundle(bad));
  }
  let calls = 0;
  const accessor = { ...value.document };
  Object.defineProperty(accessor, 'composition', { enumerable: true, get() { calls++; return project; } });
  assert.throws(() => validateDocument(accessor)); assert.equal(calls, 0);
  assert.throws(() => validateDocument(Object.assign(Object.create({ extra: true }), value.document)));
  const sparse = structuredClone(value); delete sparse.document.references[0];
  assert.throws(() => validateBundle(sparse));
});

test('oracle: binding removal and shared duplication restore exact bytes with one undo/redo edit', () => {
  const original = bundle(); const history = new ReferenceHistory(original);
  const duplicated = composition(2); duplicated.tracks[0] = structuredClone(original.document.composition.tracks[0]);
  const next = withComposition(history.current, duplicated);
  next.references.push({ trackId: duplicated.tracks[1].id, assetId: original.assets[0].id });
  assert.equal(history.commit(next), true); assert.equal(history.assetBytes, 22);
  assert.deepEqual(history.undo(), original.document); assert.deepEqual(history.redo(), next);
  const detached = history.asset(original.assets[0].id); detached.pcm.fill(255); detached.captureTempo = 240;
  assert.deepEqual(history.asset(original.assets[0].id), original.assets[0]);
  const removedTrack = structuredClone(duplicated); removedTrack.tracks.splice(0, 1);
  const remaining = withComposition(history.current, removedTrack);
  assert.deepEqual(remaining.references, [{ trackId: 'track-1', assetId: original.assets[0].id }]);
  assert.equal(history.commit(remaining), true);
  const removedReference = structuredClone(remaining); removedReference.references = [];
  assert.equal(history.commit(removedReference), true); assert.equal(history.snapshot().assets.length, 0);
  assert.equal(history.assetBytes, 22); assert.deepEqual(history.undo(), remaining);
  history.clear(); assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
  assert.equal(history.assetBytes, 22); assert.deepEqual(history.current, remaining);
});

test('oracle: conflicting ID metadata/PCM and missing/unreferenced incoming assets reject atomically', () => {
  const original = bundle(); const history = new ReferenceHistory(original);
  const next = structuredClone(original.document); next.composition.title = 'Second committed title';
  history.commit(next); history.undo(); assert.equal(history.canRedo, true);
  const before = history.snapshot();
  const candidate = structuredClone(original.document); candidate.composition.title = 'Failed candidate';
  const conflicts = [{ ...original.assets[0], captureTempo: 61 },
    { ...original.assets[0], pcm: Uint8Array.from(original.assets[0].pcm, value => value ^ 1) }];
  for (const conflict of conflicts) assert.throws(() => history.commit(candidate, [conflict]));
  assert.throws(() => history.commit(candidate, [asset(2)]));
  const missing = structuredClone(candidate); missing.references[0].assetId = uuid(999);
  assert.throws(() => history.commit(missing));
  const invalidIncoming = new Array(9).fill(null) as ReferenceAsset[];
  let read = false;
  Object.defineProperty(invalidIncoming, 0, { get() { read = true; throw new Error('Must not inspect oversized array'); } });
  assert.throws(() => history.commit(candidate, invalidIncoming)); assert.equal(read, false);
  assert.deepEqual(history.snapshot(), before); assert.equal(history.canRedo, true);
  assert.equal(history.commit(history.current), false); assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), next);
});

test('oracle: normal history retains exactly 50 prior edits and frees only unreachable PCM', () => {
  const history = new ReferenceHistory(bundle([asset(1, 1)]));
  for (let i = 2; i <= 53; i++) {
    const incoming = asset(i, 1); const next = history.current;
    next.references[0].assetId = incoming.id; history.commit(next, [incoming]);
  }
  assert.equal(history.assetBytes, 102); assert.throws(() => history.asset(uuid(1)));
  assert.throws(() => history.asset(uuid(2))); assert.equal(history.asset(uuid(3)).id, uuid(3));
  let count = 0; while (history.undo()) count++; assert.equal(count, 50);
  assert.equal(history.current.references[0].assetId, uuid(3));
  while (history.redo()) { /* restore the current before explicit clear */ }
  const current = history.snapshot(); history.clear();
  assert.deepEqual(history.snapshot(), current); assert.equal(history.assetBytes, 2);
});

test('oracle: exact 64MiB history cap is atomic and redo is reclaimed only by a successful branch', () => {
  const initial = Array.from({ length: 8 }, (_, i) => asset(i + 1, 441000));
  const history = new ReferenceHistory(bundle(initial));
  for (let step = 0; step < 34; step++) {
    const incoming = [asset(9 + step * 2, 441000), asset(10 + step * 2, 441000)];
    const next = history.current;
    for (let j = 0; j < 2; j++) next.references[(step * 2 + j) % 8].assetId = incoming[j].id;
    assert.equal(history.commit(next, incoming), true);
  }
  assert.equal(history.assetBytes, 67032000); //76×882000, no history eviction yet.
  const last = asset(77, 38432); const exact = history.current;
  exact.references[4].assetId = last.id;
  assert.equal(history.commit(exact, [last]), true); assert.equal(history.assetBytes, 67108864);
  const before = history.snapshot(); const over = history.current; over.references[5].assetId = uuid(78);
  assert.throws(() => history.commit(over, [asset(78, 1)]));
  assert.deepEqual(history.snapshot(), before); assert.equal(history.assetBytes, 67108864);
  assert.equal(history.canRedo, false);
  history.undo(); const branchBase = history.snapshot(); assert.equal(history.canRedo, true);
  const oversized = history.current; oversized.references[4].assetId = uuid(79);
  assert.throws(() => history.commit(oversized, [asset(79, 38433)])); //oldredo removed still leaves cap+2.
  assert.deepEqual(history.snapshot(), branchBase); assert.equal(history.canRedo, true);
  assert.equal(history.assetBytes, 67108864);
  assert.equal(history.commit(history.current), false); assert.equal(history.canRedo, true);
  const smallBranch = history.current; smallBranch.references[4].assetId = uuid(80);
  assert.equal(history.commit(smallBranch, [asset(80, 1)]), true);
  assert.equal(history.canRedo, false); assert.equal(history.assetBytes, 67032002);
  assert.throws(() => history.asset(uuid(77)));
});

test('oracle: original compact complete JSON has exact key order SHA and PCM, encoding detaches before await', async () => {
  const original = bundle(); const fixture = bytes(literalFile(original));
  assert.deepEqual(await decodeProjectBackup(fixture), original);
  const input = structuredClone(original); const pending = encodeProjectBackup(input);
  input.document.composition.title = 'Concurrent caller edit'; input.assets[0].pcm.fill(0);
  assert.deepEqual(await pending, fixture);
  const decoded = await decodeProjectBackup(fixture); decoded.assets[0].pcm.fill(0);
  assert.deepEqual(await decodeProjectBackup(fixture), original);
  assert.notEqual(fixture.at(-1), 10);
});

test('oracle: escaped NUL and lone UTF16 engine strings survive legacy and complete bindings exactly', async () => {
  const legacy = composition(); legacy.title = ' \0Title\ud800 ';
  legacy.tracks[0].name = ' \udfffVoice\0 ';
  legacy.tracks[0].id = 'track\0\ud800'; legacy.tracks[0].notes[0].id = 'note\udfff\0';
  const raw = JSON.stringify(legacy); const normalized = parseComposition(raw);
  const loaded = await decodeProjectBackup(new TextEncoder().encode(raw));
  assert.deepEqual(loaded, { document: { schemaVersion: 1, composition: normalized, references: [] }, assets: [] });
  assert.deepEqual(notesOnly(normalized), loaded.document);
  const attached = { document: { ...loaded.document, references: [{ trackId: normalized.tracks[0].id, assetId: uuid(1) }] }, assets: [asset()] };
  const originalFile = bytes(literalFile(attached));
  assert.deepEqual(await decodeProjectBackup(originalFile), attached);
  assert.deepEqual(await encodeProjectBackup(attached), originalFile);
  assert.deepEqual(await decodeProjectBackup(await encodeProjectBackup(attached)), attached);
  const atLimit = Buffer.concat([Buffer.from(raw), Buffer.alloc(1048576 - Buffer.byteLength(raw), 32)]);
  assert.deepEqual(await decodeProjectBackup(atLimit), loaded);
  await assert.rejects(decodeProjectBackup(Buffer.concat([atLimit, Buffer.from(' ')])));
});

test('oracle: independent malformed duplicate/base64/hash/depth/UTF8 fixtures never decode', async () => {
  const original = literalFile(bundle([asset(1, 1)]));
  const raw = JSON.stringify(original);
  const invalidRaw = [raw.replace('"version":1', '"version":1,"ver\\u0073ion":1'),
    raw.replace('"tempo":120', '"tempo":1e400'), '['.repeat(17) + '0' + ']'.repeat(17)];
  for (const value of invalidRaw) await assert.rejects(decodeProjectBackup(new TextEncoder().encode(value)));
  await assert.rejects(decodeProjectBackup(Uint8Array.from([0x7b, 0xff, 0x7d])));
  await assert.rejects(decodeProjectBackup(new Uint8Array(12 * 1024 * 1024 + 1)));
  for (const change of [
    (value: Record<string, unknown>) => { value.unknown = true; },
    (value: Record<string, unknown>) => { value.version = 2; },
    (value: Record<string, unknown>) => { value.assets = []; },
    (value: Record<string, unknown>) => { (value.assets as Record<string, unknown>[])[0].sha256 = '0'.repeat(64); },
    (value: Record<string, unknown>) => { (value.assets as Record<string, unknown>[])[0].pcmBase64 = 'AAA=\n'; },
    (value: Record<string, unknown>) => { (value.assets as Record<string, unknown>[])[0].pcmBase64 = 'AA=='; },
    (value: Record<string, unknown>) => { (value.assets as Record<string, unknown>[])[0].id = uuid(1) + '\n'; },
    (value: Record<string, unknown>) => { (value.assets as Record<string, unknown>[]).push({ ...(value.assets as Record<string, unknown>[])[0] }); },
  ]) { const bad = structuredClone(original); change(bad); await assert.rejects(decodeProjectBackup(bytes(bad))); }
  // Nonzero unused base64 pad bits decode to the SAME two zero bytes. A
  // digest-only validator would accept this, but the alphabet must be canonical.
  const noncanonical = literalFile(bundle([{ ...asset(1, 1), pcm: Uint8Array.of(0, 0) }]));
  (noncanonical.assets as Record<string, unknown>[])[0].pcmBase64 = 'AAB=';
  await assert.rejects(decodeProjectBackup(bytes(noncanonical)));
});

test('oracle: complete maximum eight20second references decode every original PCM byte and digest', async () => {
  const original = bundle(Array.from({ length: 8 }, (_, i) => asset(i + 1, 441000)));
  const fixture = bytes(literalFile(original)); assert.ok(fixture.byteLength < 12 * 1024 * 1024);
  const decoded = await decodeProjectBackup(fixture);
  assert.deepEqual(decoded.document, original.document); assert.equal(decoded.assets.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(decoded.assets[i].frameCount, 441000);
    assert.ok(Buffer.from(decoded.assets[i].pcm).equals(Buffer.from(original.assets[i].pcm)));
    assert.equal(hash(decoded.assets[i].pcm), hash(original.assets[i].pcm));
  }
  assert.deepEqual(await encodeProjectBackup(decoded), fixture);
});
