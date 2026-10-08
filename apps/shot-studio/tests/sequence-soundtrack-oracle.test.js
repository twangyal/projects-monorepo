import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePcm16Wav, admitSequenceAudio, assertAdmittedWavAsset, sequenceAudioDescriptor, planSoundtrack } from '../src/sequence-audio.js';
import { createSequenceDocument, validateSequenceDocument, validateSequenceBundle, replaceSequence, attachSequenceSoundtrack, setSequenceSoundtrack, removeSequenceSoundtrack, SequenceDocumentHistory } from '../src/sequence-document.js';
import { encodeSequenceArchive, decodeSequenceArchive, importLegacySequence } from '../src/sequence-archive.js';
import { originalWave, originalSoundSequence, literalDescriptor, literalDocument, literalArchive, readLiteralArchive, soundtrackSha, ORIGINAL_PLAN } from './browser/sequence-soundtrack-fixtures.js';

const blob = bytes => new Blob([bytes], { type: 'audio/wav' });
const empty = () => ({ document: literalDocument(), asset: null });
async function attached() { const bytes = originalWave(), asset = await admitSequenceAudio(blob(bytes)); return { bytes, asset, bundle: attachSequenceSoundtrack(empty(), asset, 'Original stereo tones Ω') }; }
function riff(chunks) { const body = Buffer.concat(chunks), header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(body.length + 4, 4); header.write('WAVE', 8); return Buffer.concat([header, body]); }
function chunk(name, bytes) { const header = Buffer.alloc(8); header.write(name); header.writeUInt32LE(bytes.length, 4); return Buffer.concat([header, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])]); }

test('independent original stereo48k and mono44.1k PCM extents are exact with no decoder or resampling', () => {
  const stereo = originalWave(), mono = originalWave({ sampleRate: 44100, channels: 1, seconds: 1 });
  assert.deepEqual(parsePcm16Wav(stereo), { sampleRate: 48000, channels: 2, frameCount: 192000, dataOffset: 44, dataBytes: 768000 });
  assert.deepEqual(parsePcm16Wav(mono), { sampleRate: 44100, channels: 1, frameCount: 44100, dataOffset: 44, dataBytes: 88200 });
  assert.equal(stereo.readInt16LE(44 + 24000 * 4), 0); assert.equal(stereo.readInt16LE(44 + 24001 * 4), Math.round(8192 * Math.sin(2 * Math.PI * 440 / 48000)));
  assert.equal(stereo.readInt16LE(44 + 24001 * 4 + 2), Math.round(16384 * Math.sin(2 * Math.PI * 880 / 48000)));
});

test('RIFF ancillary padding and fmt18zero extension retain exact offsets while malformed framing fails', () => {
  const wav = originalWave(), fmt = wav.subarray(20, 36), data = wav.subarray(44);
  const bytes = riff([chunk('JUNK', Buffer.from([7, 8, 9])), chunk('fmt ', Buffer.concat([fmt, Buffer.alloc(2)])), chunk('data', data)]);
  assert.deepEqual(parsePcm16Wav(bytes), { sampleRate: 48000, channels: 2, frameCount: 192000, dataOffset: 58, dataBytes: 768000 });
  for (const bad of [Buffer.concat([wav, Buffer.from([0])]), wav.subarray(0, -1), riff([chunk('fmt ', fmt), chunk('fmt ', fmt), chunk('data', data)]), riff([chunk('fmt ', fmt), chunk('data', data), chunk('data', data)]), riff([chunk('fmt ', fmt), chunk('data', data.subarray(1))])]) assert.throws(() => parsePcm16Wav(bad));
  for (const [offset, value] of [[20, 3], [22, 3], [24, 32000], [28, 1], [32, 1], [34, 8]]) { const bad = Buffer.from(wav); if (offset === 24 || offset === 28) bad.writeUInt32LE(value, offset); else bad.writeUInt16LE(value, offset); assert.throws(() => parsePcm16Wav(bad)); }
  for (const magic of ['RIFX', 'RF64']) { const bad = Buffer.from(wav); bad.write(magic); assert.throws(() => parsePcm16Wav(bad)); }
  const missingPad = bytes.subarray(0, 23); assert.throws(() => parsePcm16Wav(missingPad));
});

test('original byte SHA and private asset brand prevent descriptor forgery, retaining immutable Blob bytes', async () => {
  const { bytes, asset } = await attached(); assert.equal(assertAdmittedWavAsset(asset), asset); assert.equal(Object.isFrozen(asset), true);
  assert.deepEqual(sequenceAudioDescriptor(asset), literalDescriptor(bytes)); assert.deepEqual(Buffer.from(await asset.blob.arrayBuffer()), bytes);
  assert.throws(() => assertAdmittedWavAsset({ ...asset })); assert.throws(() => sequenceAudioDescriptor({ ...asset }));
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(admitSequenceAudio(blob(bytes), { signal: cancelled.signal }));
});

test('literal soundtrack frame span and sequence clock crop use no clip retiming or normalization', async () => {
  const { asset, bytes } = await attached(); const soundtrack = literalDocument(bytes, { inFrame: 12000, outFrame: 156000, startTime: 0.75, gain: 0.5 }).soundtrack;
  assert.deepEqual(planSoundtrack(soundtrack, asset, 6), ORIGINAL_PLAN); assert.equal(Object.isFrozen(planSoundtrack(soundtrack, asset, 6)), true);
  assert.deepEqual(planSoundtrack(soundtrack, asset, 2), { ...ORIGINAL_PLAN, sequenceDuration: 2, audibleEnd: 2 });
  assert.deepEqual(planSoundtrack(soundtrack, asset, 0), { ...ORIGINAL_PLAN, sequenceDuration: 0, audibleStart: 0, audibleEnd: 0, audible: false });
  assert.deepEqual(planSoundtrack({ ...soundtrack, gain: 0 }, asset, 6), { ...ORIGINAL_PLAN, gain: 0, audible: false });
  assert.deepEqual(planSoundtrack({ ...soundtrack, startTime: 60 }, asset, 6), { ...ORIGINAL_PLAN, startTime: 60, audibleStart: 6, audibleEnd: 6, audible: false });
  for (const patch of [{ inFrame: 0.1 }, { outFrame: 192001 }, { inFrame: 0, outFrame: 4799 }, { startTime: -1 }, { startTime: 60.01 }, { gain: 1.01 }, { gain: NaN }]) assert.throws(() => planSoundtrack({ ...soundtrack, ...patch }, asset, 6));
});

test('document operations detach complete films and preserve legacy film Unicode while bounding new labels', async () => {
  const { bundle, asset, bytes } = await attached(); assert.deepEqual(bundle.document, literalDocument(bytes)); assert.equal(bundle.asset, asset);
  const validated = validateSequenceBundle(bundle); validated.document.sequence.sources[0].film.title = 'mutated detached copy'; assert.equal(bundle.document.sequence.sources[0].film.title, 'Retained film with silent tail');
  const legacy = originalSoundSequence(); legacy.sources[0].film.title = 'Literal legacy \ud800'; const wrapped = createSequenceDocument(legacy); assert.equal(wrapped.sequence.sources[0].film.title, legacy.sources[0].film.title);
  const changed = setSequenceSoundtrack(bundle, { label: 'Original stereo tones Ω', inFrame: 12000, outFrame: 156000, startTime: 0.75, gain: 0.5 });
  assert.deepEqual(changed.document.sequence, originalSoundSequence()); assert.equal(changed.asset, asset);
  assert.deepEqual(removeSequenceSoundtrack(changed), empty()); assert.deepEqual(replaceSequence(changed, { ...originalSoundSequence(), title: 'New sequence title' }).document.soundtrack, changed.document.soundtrack);
  for (const label of ['', ' ', 'a\0b', '\ud800', 'a'.repeat(81), '🌿'.repeat(41)]) assert.throws(() => setSequenceSoundtrack(bundle, { inFrame: 0, outFrame: 192000, startTime: 0, gain: 1, label }));
  assert.equal(setSequenceSoundtrack(bundle, { inFrame: 0, outFrame: 192000, startTime: 0, gain: 1, label: '🌿'.repeat(40) }).document.soundtrack.label.length, 80);
});

test('strict complete bundle refuses mismatched descriptors, absent/extra assets and partial metadata atomically', async () => {
  const { bundle, asset } = await attached(); const before = JSON.stringify(bundle.document);
  for (const field of ['sha256', 'bytes', 'sampleRate', 'channels', 'frameCount']) {
    const document = structuredClone(bundle.document); document.soundtrack.asset[field] = field === 'sha256' ? '0'.repeat(64) : document.soundtrack.asset[field] + 1; assert.throws(() => validateSequenceBundle({ document, asset }));
  }
  assert.throws(() => validateSequenceBundle({ document: bundle.document, asset: null })); assert.throws(() => validateSequenceBundle({ document: literalDocument(), asset })); assert.throws(() => validateSequenceBundle({ ...bundle, asset: { ...asset } }));
  assert.throws(() => validateSequenceDocument({ ...bundle.document, surprise: true })); assert.equal(JSON.stringify(bundle.document), before);
});

test('independently framed complete archive decodes literal metadata and byte-exact PCM and re-encodes no descriptor-only loss', async () => {
  const wav = originalWave(), doc = literalDocument(wav, { inFrame: 12000, outFrame: 156000, startTime: 0.75, gain: 0.5 }); const original = literalArchive(doc, wav);
  const bundle = await decodeSequenceArchive(new Blob([original])); assert.deepEqual(bundle.document, doc); assert.deepEqual(Buffer.from(await bundle.asset.blob.arrayBuffer()), wav);
  const encoded = await encodeSequenceArchive(bundle); const decoded = readLiteralArchive(await encoded.arrayBuffer()); assert.deepEqual(decoded.document, doc); assert.deepEqual(decoded.wav, wav); assert.equal(decoded.audioLength, 768044);
  const plain = importLegacySequence(JSON.stringify(originalSoundSequence())); assert.deepEqual(plain, empty());
  const silent = await decodeSequenceArchive(new Blob([literalArchive(literalDocument())])); assert.deepEqual(silent, empty());
});

test('archive wrong length/trailing bytes/tampered audio/UTF8 and mismatched empty assets refuse before publication', async () => {
  const wav = originalWave(), bytes = literalArchive(literalDocument(wav), wav);
  const corrupt = Buffer.from(bytes); corrupt[corrupt.length - 1] ^= 1;
  const length = Buffer.from(bytes); length.writeUInt32LE(length.readUInt32LE(12) - 1, 12);
  const utf8 = Buffer.from(bytes); utf8[16] = 255;
  for (const input of [Buffer.concat([bytes, Buffer.from([0])]), bytes.subarray(0, -1), corrupt, length, utf8, literalArchive(literalDocument(), wav), literalArchive(literalDocument(wav))]) await assert.rejects(decodeSequenceArchive(new Blob([input])));
  const controller = new AbortController(); controller.abort(); await assert.rejects(decodeSequenceArchive(new Blob([bytes]), { signal: controller.signal }));
});

test('whole-bundle history preserves audio identity, exact undo/redo, no-op redo and explicit clear', async () => {
  const { bundle, asset } = await attached(); const history = new SequenceDocumentHistory(empty()); history.commit(bundle); const changed = setSequenceSoundtrack(bundle, { label: 'Trimmed original', inFrame: 12000, outFrame: 156000, startTime: 0.75, gain: 0.5 }); history.commit(changed);
  assert.equal(history.current.asset, asset); assert.deepEqual(history.undo().document, bundle.document); assert.equal(history.canRedo, true); history.commit(bundle); assert.equal(history.canRedo, true); assert.deepEqual(history.redo().document, changed.document);
  const clone = history.current; clone.document.soundtrack.label = 'External mutation'; assert.equal(history.current.document.soundtrack.label, 'Trimmed original'); history.clear(); assert.equal(history.canUndo, false); assert.equal(history.canRedo, false); assert.deepEqual(history.current.document, changed.document);
});

test('actual12MiB container cap and64MiB unique audio history budget reject atomically then reclaim truncated redo', async () => {
  const baseBytes = 88244, padding = 12 * 1024 * 1024 - baseBytes - 8; const assets = [];
  for (let marker = 1; marker <= 6; marker++) { const bytes = originalWave({ sampleRate: 44100, channels: 1, seconds: 1, padding, marker }); assert.equal(bytes.length, 12 * 1024 * 1024); assets.push(await admitSequenceAudio(blob(bytes))); }
  const tooLarge = originalWave({ sampleRate: 44100, channels: 1, seconds: 1, padding: padding + 2 }); await assert.rejects(admitSequenceAudio(blob(tooLarge)));
  const history = new SequenceDocumentHistory(empty()); for (let i = 0; i < 5; i++) history.commit(attachSequenceSoundtrack(empty(), assets[i], `Original ${i}`));
  const before = history.current; assert.throws(() => history.commit(attachSequenceSoundtrack(empty(), assets[5], 'Sixth unique asset'))); assert.deepEqual(history.current.document, before.document); assert.equal(history.current.asset, before.asset);
  for (let i = 0; i < 4; i++) history.undo(); assert.equal(history.canRedo, true); history.commit(attachSequenceSoundtrack(empty(), assets[5], 'Reclaimed redo')); assert.equal(history.canRedo, false); assert.equal(history.current.asset, assets[5]);
  assert.equal(soundtrackSha(Buffer.from(await assets[0].blob.arrayBuffer())), assets[0].sha256);
});
