/** Original capacity inputs, authored independently of production model/audio code. */
/* global process, Buffer, console */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

assert.equal(process.argv.length, 3, 'Usage: node scripts/create_backed_recording_fixtures.mjs NEW_DIRECTORY');
const output = resolve(process.argv[2]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = [], tracks = [], references = [];
for (let track = 0; track < 8; track++) {
  const id = `11300000-0000-4000-8000-${(track + 1).toString(16).padStart(12, '0')}`;
  const pcm = Buffer.alloc(882000);
  for (let frame = 0; frame < 441000; frame++) {
    pcm.writeInt16LE(((frame * 97 + (track + 1) * 503) % 65536) - 32768, frame * 2);
  }
  assets.push({ id, kind: 'audio-file', captureTempo: 120, decodedSampleRate: 44100,
    decodedChannels: 2, decodedFrames: 882000, analyzedFrames: 882000, frameCount: 441000,
    sha256: sha256(pcm), pcmBase64: pcm.toString('base64') });
  tracks.push({ id: `original-backed-${track}`, name: `Original part ${track + 1}`,
    instrument: track < 2 ? 'sine' : ['triangle', 'sawtooth'][track % 2],
    volume: track === 2 ? 0 : .5, muted: track >= 3,
    notes: Array.from({ length: 256 }, (_, note) => ({ id: `part-${track}-note-${note}`,
      pitch: track === 0 ? 48 : track === 1 ? 60 : 80 + track,
      start: 0, duration: 1, velocity: .8 })) });
  references.push({ trackId: tracks.at(-1).id, assetId: id });
}
const original = { format: 'melody-studio-project', version: 1,
  document: { schemaVersion: 1, composition: { version: 1,
    title: 'Original maximum backed recording', tempo: 120, tracks }, references }, assets };
const bytes = Buffer.from(JSON.stringify(original));
// The original Python-authored input was frozen before any native run.
assert.equal(bytes.length, 9562719);
assert.equal(sha256(bytes), '45befaebf0cb4f2ebafb004036d7b3e41b6782290f59144c614bb359c3cafa69');
const expectations = {
  issue: 113,
  original: { bytes: bytes.length, sha256: sha256(bytes), tracks: 8, notes: 2048,
    references: 8, framesEach: 441000, pcmBytesEach: 882000, assetSha256: assets.map(asset => asset.sha256) },
  backing: { target: 'original-backed-0', audibleTrack: 'original-backed-1', pitch: 60,
    duplicateUnisonNotes: 256, firstNoteStartSeconds: 0, releaseEndSeconds: .58,
    afterRelease: 'silence', targetOldPitch: 48, referenceAudio: 'excluded' },
  // This is the authored mono source, not a claim about MediaStream graph channels.
  input: { rate: 48000, durationSeconds: 20, channels: 1,
    segments: [{ startSeconds: .5, endSeconds: 1.5, hz: 440 },
      { startSeconds: 2, endSeconds: 3, hz: 660 }, { startSeconds: 19, endSeconds: 20, hz: 880 }],
    amplitude: .24, otherSamples: 'zero' },
  expectedNotes: [{ pitch: 69, start: 1, duration: 2 }, { pitch: 76, start: 4, duration: 2 },
    { pitch: 81, start: 38, duration: 2 }],
  limits: { graphHarnessProvesExactFramesSeparately: true, editorToneHzTolerance: 3,
    editorInteriorRmsRelativeTolerance: .03, quarterBeatBoundaryTolerance: .25,
    originalReferenceBytesMustBeExact: true, physicalLatencyAcceptance: false },
  required: ['literal original input before run', 'actual 20-second automatic capture',
    'unchanged seven other tracks/references', 'one Undo exact original then Redo exact recorded backup',
    'complete process restart byte exact', 'actual MIDI track/ticks and WAV decoded timing/pitch/silence',
    'desktop and 390px trusted controls'],
};
await mkdir(output, { recursive: false, mode: 0o700 });
await writeFile(join(output, 'original.melody.json'), bytes, { flag: 'wx', mode: 0o600 });
await writeFile(join(output, 'expectations.json'), JSON.stringify(expectations, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, bytes: bytes.length, sha256: sha256(bytes) }));
