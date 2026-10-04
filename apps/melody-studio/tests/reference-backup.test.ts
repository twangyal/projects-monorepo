import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeProjectBackup, decodeProjectBackup } from '../src/reference-backup.ts';
import type { ReferenceBundle } from '../src/reference-types.ts';

const id = '123e4567-e89b-42d3-a456-426614174000';
const bytes = new Uint8Array([0, 128, 0, 0, 255, 127, 2, 0]);
function fixture(): ReferenceBundle {
  return { document: { schemaVersion: 1, composition: { version: 1, title: 'Original', tempo: 120,
    tracks: [{ id: 'track', name: 'Voice', instrument: 'sine', volume: 0.8, muted: false, notes: [] }] },
    references: [{ trackId: 'track', assetId: id }] }, assets: [{ id, kind: 'audio-file', captureTempo: 120,
    decodedSampleRate: 22050, decodedChannels: 1, decodedFrames: 4, analyzedFrames: 4, frameCount: 4,
    pcm: new Uint8Array(bytes) }] };
}
function literal() {
  const value = fixture();
  const asset = value.assets[0];
  return { format: 'melody-studio-project', version: 1, document: value.document,
    assets: [{ id: asset.id, kind: asset.kind, captureTempo: asset.captureTempo,
      decodedSampleRate: asset.decodedSampleRate, decodedChannels: asset.decodedChannels,
      decodedFrames: asset.decodedFrames, analyzedFrames: asset.analyzedFrames, frameCount: asset.frameCount,
      sha256: createHash('sha256').update(bytes).digest('hex'), pcmBase64: Buffer.from(bytes).toString('base64') }] };
}
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('independently authored complete backup decodes exact PCM and canonical bytes', async () => {
  const authored = text(literal());
  assert.deepEqual(await decodeProjectBackup(authored), fixture());
  assert.deepEqual(await encodeProjectBackup(fixture()), authored);
});

test('legacy UTF16 values survive complete roundtrip and exact binding IDs', async () => {
  const value = fixture();
  const legacy = value.document.composition;
  legacy.title = 'Title\0\ud800'; legacy.tracks[0].name = 'Name\udfff'; legacy.tracks[0].id = 'track\0\ud800';
  const restored = await decodeProjectBackup(text(legacy));
  assert.deepEqual(restored.document.composition, legacy);
  assert.deepEqual(restored.assets, []);
  assert.deepEqual(await decodeProjectBackup(await encodeProjectBackup(restored)), restored);
  value.document.references[0].trackId = legacy.tracks[0].id;
  assert.deepEqual(await decodeProjectBackup(await encodeProjectBackup(value)), value);
});

test('duplicate semantic keys, depth, nonfinite values and malformed UTF8 reject', async () => {
  for (const data of [new TextEncoder().encode('{"version":1,"\\u0076ersion":1}'),
    new TextEncoder().encode('['.repeat(17) + '0' + ']'.repeat(17)),
    new TextEncoder().encode('{"tempo":1e999}'), new Uint8Array([0xff]),
    new TextEncoder().encode('{"x":"unterminated}')]) {
    await assert.rejects(decodeProjectBackup(data));
  }
});

test('strict asset fields, canonical base64 padding and checksum mismatch reject', async () => {
  const variants = [
    (v: ReturnType<typeof literal>) => { v.assets[0].sha256 = '0'.repeat(64); },
    (v: ReturnType<typeof literal>) => { v.assets[0].pcmBase64 = 'AACAAP9/AgB='; },
    (v: ReturnType<typeof literal>) => { v.assets[0].pcmBase64 = 'AAA='; },
    (v: ReturnType<typeof literal>) => { v.assets[0].frameCount = 5; },
    (v: ReturnType<typeof literal>) => { v.assets[0].id = id.toUpperCase(); },
    (v: ReturnType<typeof literal>) => { v.assets.push(v.assets[0]); },
    (v: ReturnType<typeof literal>) => { v.assets = []; },
  ];
  for (const mutate of variants) { const value = literal(); mutate(value); await assert.rejects(decodeProjectBackup(text(value))); }
  await assert.rejects(decodeProjectBackup(text({ ...literal(), extra: true })));
  await assert.rejects(decodeProjectBackup(text({ ...literal(), version: 2 })));
});

test('input cap and exact subarray byte offsets are admitted before parsing', async () => {
  await assert.rejects(decodeProjectBackup(new Uint8Array(12 * 1024 * 1024 + 1)));
  const original = text(literal());
  const larger = new Uint8Array(original.length + 4); larger.set(original, 2);
  assert.deepEqual(await decodeProjectBackup(larger.subarray(2, 2 + original.length)), fixture());
});

test('encoding snapshots caller data before asynchronous hashing', async () => {
  const value = fixture();
  const pending = encodeProjectBackup(value);
  value.assets[0].pcm.fill(99); value.document.composition.title = 'Changed';
  assert.deepEqual(await decodeProjectBackup(await pending), fixture());
});

test('maximum eight 20-second assets roundtrip original bytes, notes and independent digests', async () => {
  const value = fixture(); value.assets = []; value.document.composition.tracks = []; value.document.references = [];
  for (let i = 0; i < 8; i++) {
    const assetId = `123e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`;
    const pcm = new Uint8Array(882000);
    for (let j = 0; j < pcm.length; j++) pcm[j] = (j * 31 + i) & 255;
    value.assets.push({ id: assetId, kind: 'demo', captureTempo: 120, decodedSampleRate: 22050,
      decodedChannels: 1, decodedFrames: 441000, analyzedFrames: 441000, frameCount: 441000, pcm });
    value.document.composition.tracks.push({ id: `track-${i}`, name: `Original ${i}`, instrument: 'sine', volume: 0.8, muted: false,
      notes: [{ id: `note-${i}`, pitch: 60 + i, start: 0.125, duration: 1 / 3, velocity: 0.7 }] });
    value.document.references.push({ trackId: `track-${i}`, assetId });
  }
  const encoded = await encodeProjectBackup(value);
  assert.ok(encoded.length < 12 * 1024 * 1024);
  const literalDecoded = JSON.parse(Buffer.from(encoded).toString('utf8')) as { assets: { pcmBase64: string; sha256: string }[] };
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(Buffer.from(literalDecoded.assets[i].pcmBase64, 'base64'), Buffer.from(value.assets[i].pcm));
    assert.equal(literalDecoded.assets[i].sha256, createHash('sha256').update(value.assets[i].pcm).digest('hex'));
  }
  assert.deepEqual(await decodeProjectBackup(encoded), value);
});
