import type { Composition } from './types.ts';
import { compositionDurationBeats, validateComposition } from './model.ts';

const TICKS_PER_BEAT = 480;
// General MIDI approximations: flute, square lead and saw lead.
const PROGRAMS = { sine: 73, triangle: 80, sawtooth: 81 };

interface Event { tick: number; order: number; bytes: number[] }

function variableLength(value: number): number[] {
  const bytes = [value & 127];
  while ((value = Math.floor(value / 128)) > 0) bytes.unshift((value & 127) | 128);
  return bytes;
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function meta(type: number, bytes: number[]): number[] {
  return [255, type, ...variableLength(bytes.length), ...bytes];
}

function track(events: Event[], endTick: number): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes: number[] = [];
  let previous = 0;
  for (const event of events) {
    bytes.push(...variableLength(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  bytes.push(...variableLength(Math.max(0, endTick - previous)), 255, 47, 0);
  return [77, 84, 114, 107, ...uint32(bytes.length), ...bytes];
}

export function encodeMidi(project: Composition): Uint8Array {
  const valid = validateComposition(project);
  const end = Math.round(compositionDurationBeats(valid) * TICKS_PER_BEAT);
  const tempo = Math.round(60_000_000 / valid.tempo);
  const encoder = new TextEncoder();
  const chunks = [track([
    { tick: 0, order: 0, bytes: meta(3, [...encoder.encode(valid.title)]) },
    { tick: 0, order: 1, bytes: meta(81, [(tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255]) },
  ], end)];
  valid.tracks.forEach((part, channel) => {
    const events: Event[] = [
      { tick: 0, order: 0, bytes: meta(3, [...encoder.encode(part.name)]) },
      { tick: 0, order: 1, bytes: [192 | channel, PROGRAMS[part.instrument]] },
      { tick: 0, order: 2, bytes: [176 | channel, 7, Math.round(part.volume * 127)] },
    ];
    if (!part.muted) {
      for (const note of part.notes) {
        if (note.velocity === 0) continue;
        events.push(
          { tick: Math.round(note.start * TICKS_PER_BEAT), order: 4, bytes: [144 | channel, note.pitch, Math.max(1, Math.round(note.velocity * 127))] },
          { tick: Math.round((note.start + note.duration) * TICKS_PER_BEAT), order: 3, bytes: [128 | channel, note.pitch, 0] },
        );
      }
    }
    chunks.push(track(events, end));
  });
  const header = [77, 84, 104, 100, 0, 0, 0, 6, 0, 1, 0, chunks.length, TICKS_PER_BEAT >>> 8, TICKS_PER_BEAT & 255];
  return new Uint8Array([...header, ...chunks.flat()]);
}
