/** 16-bit PCM WAV with one (mono) or two (interleaved stereo) channels of equal length. */
export function encodeWavChannels(channels: Float32Array[], sampleRate: number): Uint8Array {
  if (channels.length === 1) return encodeWav(channels[0]!, sampleRate);
  if (channels.length !== 2 || channels.some(channel => !(channel instanceof Float32Array)) || channels[0]!.length !== channels[1]!.length) throw new Error('Stereo WAV needs two equal-length Float32Array channels.');
  const [left, right] = channels as [Float32Array, Float32Array];
  const interleaved = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) { interleaved[i * 2] = left[i]!; interleaved[i * 2 + 1] = right[i]!; }
  const bytes = encodeWav(interleaved, sampleRate);
  const view = new DataView(bytes.buffer);
  view.setUint16(22, 2, true); // channels
  view.setUint32(28, sampleRate * 4, true); // byte rate
  view.setUint16(32, 4, true); // block align
  return bytes;
}

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 384_000) {
    throw new Error('WAV sample rate must be an integer between 1 and 384000.');
  }
  if (!(samples instanceof Float32Array)) throw new Error('WAV samples must be a Float32Array.');
  const dataSize = samples.length * 2;
  if (dataSize > 0xffff_ffff - 36) throw new Error('Audio exceeds the WAV size limit.');
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('WAV samples must be finite.');
  }
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const label = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) bytes[offset + index] = value.charCodeAt(index);
  };
  label(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(44 + index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
