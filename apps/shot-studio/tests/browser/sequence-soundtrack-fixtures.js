import { createHash } from 'node:crypto';

// Original input bytes and literal expected clocks authored before new producer reads.
export const soundtrackSha = bytes => createHash('sha256').update(bytes).digest('hex');
export function originalSoundSequence() {
  return { schemaVersion: 3, kind: 'shot-studio-sequence', title: 'Original soundtrack sequence Ω', sources: [{ id: 'original-film', label: 'Original complete film', film: {
    schemaVersion: 3, title: 'Retained film with silent tail', light: 1, actors: [
      { name: 'Red time landmark', color: '#ff0000', performanceMode: 'blocking', cues: [{ time: 0, x: -1, z: 0, action: 'idle', visible: true }, { time: 2, x: -1, z: 0, action: 'wave', visible: true }, { time: 3, x: -1, z: 0, action: 'idle', visible: false }, { time: 6, x: -1, z: 0, action: 'idle', visible: true }] },
      { name: 'Green fixed control', color: '#00ff00', performanceMode: 'blocking', cues: [{ time: 0, x: 2, z: 0, action: 'idle', visible: true }] },
    ], shots: [
      { name: 'Retained one second prefix', duration: 1, eye: [0, 2.2, 8], target: [0, 1.15, 0], fov: 50, cameraMode: 'static' },
      { name: 'Original body', duration: 5, eye: [0, 2.2, 8], target: [0, 1.15, 0], fov: 50, cameraMode: 'static' },
    ],
  } }], clips: [
    { id: 'first-excerpt', sourceId: 'original-film', shotIndex: 1, label: 'First three seconds', inTime: 0, outTime: 3 },
    { id: 'second-excerpt', sourceId: 'original-film', shotIndex: 1, label: 'Repeated three seconds', inTime: 0, outTime: 3 },
  ] };
}
export function originalWave({ sampleRate = 48000, channels = 2, seconds = 4, padding = 0, marker = 0 } = {}) {
  const frameCount = sampleRate * seconds, dataBytes = frameCount * channels * 2;
  const buffer = Buffer.alloc(44 + dataBytes + (padding ? 8 + padding + (padding % 2) : 0));
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(channels, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * channels * 2, 28); buffer.writeUInt16LE(channels * 2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40);
  for (let f = 0; f < frameCount; f++) for (let c = 0; c < channels; c++) {
    const active = seconds === 1 || f >= sampleRate / 2 && f < sampleRate * 2.5;
    const frequency = channels === 1 ? 330 : c ? 880 : 440, amplitude = channels === 1 ? 4096 : c ? 16384 : 8192;
    buffer.writeInt16LE(active ? Math.round(amplitude * Math.sin(2 * Math.PI * frequency * f / sampleRate)) : 0, 44 + (f * channels + c) * 2);
  }
  if (padding) { buffer.write('JUNK', 44 + dataBytes); buffer.writeUInt32LE(padding, 48 + dataBytes); buffer[52 + dataBytes] = marker; }
  return buffer;
}
export function literalDescriptor(wav, sampleRate = 48000, channels = 2, frameCount = 192000) { return { sha256: soundtrackSha(wav), bytes: wav.length, sampleRate, channels, frameCount }; }
export function literalDocument(wav = null, overrides = {}) {
  return { schemaVersion: 1, kind: 'shot-studio-sequence-document', sequence: originalSoundSequence(), soundtrack: wav ? { label: 'Original stereo tones Ω', asset: literalDescriptor(wav), inFrame: 0, outFrame: 192000, startTime: 0, gain: 1, ...overrides } : null };
}
export function literalArchive(document, wav = Buffer.alloc(0)) {
  const metadata = Buffer.from(JSON.stringify(document), 'utf8'), header = Buffer.alloc(16); header.write('SHOTSEQ1'); header.writeUInt32LE(metadata.length, 8); header.writeUInt32LE(wav.length, 12); return Buffer.concat([header, metadata, wav]);
}
export function readLiteralArchive(input) {
  const bytes = Buffer.from(input); if (bytes.length < 16 || bytes.subarray(0, 8).toString() !== 'SHOTSEQ1') throw Error('Not the independently specified complete archive');
  const metadataLength = bytes.readUInt32LE(8), audioLength = bytes.readUInt32LE(12); if (16 + metadataLength + audioLength !== bytes.length) throw Error('Archive extent mismatch');
  return { document: JSON.parse(bytes.subarray(16, 16 + metadataLength).toString('utf8')), wav: bytes.subarray(16 + metadataLength), metadataLength, audioLength };
}
export const ORIGINAL_PLAN = Object.freeze({ sampleRate: 48000, channels: 2, frameCount: 192000, inFrame: 12000, outFrame: 156000, startTime: 0.75, gain: 0.5, sequenceDuration: 6, audibleStart: 0.75, audibleEnd: 3.75, audible: true });
