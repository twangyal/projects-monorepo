// Independently authored Standard MIDI File bytes; no production MIDI code.
function vlq(value: number): number[] {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128))) bytes.unshift((value & 127) | 128);
  return bytes;
}
function chunk(name: string, bytes: number[]): Buffer {
  const header = Buffer.alloc(8); header.write(name); header.writeUInt32BE(bytes.length, 4);
  return Buffer.concat([header, Buffer.from(bytes)]);
}
export function smf(tracks: number[][], ppqn = 100): Buffer {
  const header = Buffer.alloc(14); header.write('MThd'); header.writeUInt32BE(6, 4);
  header.writeUInt16BE(tracks.length === 1 ? 0 : 1, 8); header.writeUInt16BE(tracks.length, 10); header.writeUInt16BE(ppqn, 12);
  return Buffer.concat([header, ...tracks.map(bytes => chunk('MTrk', bytes))]);
}
export const event = (delta: number, ...bytes: number[]): number[] => [...vlq(delta), ...bytes];
export const name = (text: string): number[] => { const bytes = [...Buffer.from(text)]; return event(0, 255, 3, ...vlq(bytes.length), ...bytes); };
export function phraseMidi(title = 'Literal <phrase> 🎵'): Buffer {
  return smf([
    [...name(title), ...event(0, 255, 81, 3, 7, 161, 32), ...event(800, 255, 47, 0)],
    [...name('Selected part'), ...event(0, 194, 40), ...event(0, 178, 7, 64),
      ...event(0, 146, 60, 64), ...event(50, 130, 60, 0),
      ...event(163, 146, 69, 96), ...event(100, 130, 69, 0),
      ...event(100, 146, 72, 32), ...event(100, 130, 72, 0),
      ...event(87, 146, 76, 80), ...event(100, 130, 76, 0), ...event(100, 255, 47, 0)],
    [...name('Excluded part'), ...event(250, 149, 48, 100), ...event(100, 133, 48, 0), ...event(450, 255, 47, 0)],
  ]);
}

export function unsupportedLanesMidi(): Buffer {
  return smf([
    [...name('Subset with exclusions'), ...event(0, 176, 7, 80), ...event(400, 255, 47, 0)],
    [...name('Shared notes'), ...event(0, 144, 60, 90), ...event(100, 128, 60, 0), ...event(300, 255, 47, 0)],
    [...name('Percussion'), ...event(0, 153, 40, 90), ...event(100, 137, 40, 0), ...event(300, 255, 47, 0)],
    [...name('Expressive'), ...event(0, 227, 0, 64), ...event(0, 147, 67, 90), ...event(100, 131, 67, 0), ...event(300, 255, 47, 0)],
    [...name('Supported'), ...event(0, 146, 69, 90), ...event(100, 130, 69, 0), ...event(300, 255, 47, 0)],
  ]);
}
export function globalUnsupportedMidi(): Buffer {
  return smf([[...name('Global effect'), ...event(0, 255, 33, 1, 0), ...event(0, 144, 60, 90), ...event(100, 128, 60, 0), ...event(0, 255, 47, 0)]]);
}

interface ChannelEvent { tick: number; kind: number; channel: number; data: number[] }
// A small independent event reader for the downloaded encoder's format1 SMF.
export function channelEvents(bytes: Buffer): ChannelEvent[] {
  if (bytes.toString('ascii', 0, 4) !== 'MThd' || bytes.readUInt16BE(12) !== 480) throw new Error('Expected 480 PPQN SMF');
  const events: ChannelEvent[] = []; let p = 14;
  for (let track = 0; track < bytes.readUInt16BE(10); track++) {
    if (bytes.toString('ascii', p, p + 4) !== 'MTrk') throw new Error('Missing track');
    const end = p + 8 + bytes.readUInt32BE(p + 4); p += 8; let tick = 0, running = 0;
    const variable = () => { let value = 0; for (let i = 0; i < 4; i++) { const byte = bytes[p++]; value = value * 128 + (byte & 127); if (!(byte & 128)) return value; } throw new Error('Bad VLQ'); };
    while (p < end) {
      tick += variable(); let status = bytes[p]; if (status & 128) p++; else status = running;
      if (status === 255) { p++; const size = variable(); p += size; running = 0; continue; }
      if (status < 128 || status >= 240) throw new Error('Unexpected status'); running = status;
      const kind = status & 240, count = kind === 192 || kind === 208 ? 1 : 2;
      events.push({ tick, kind, channel: status & 15, data: [...bytes.subarray(p, p + count)] }); p += count;
    }
    if (p !== end) throw new Error('Track overrun');
  }
  if (p !== bytes.length) throw new Error('Trailing MIDI bytes'); return events;
}
