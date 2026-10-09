import { validateEnvelope } from './sound-envelope.ts';
import { validateFilter } from './sound-filter.ts';
import { validateEcho } from './sound-echo.ts';
import { MAX_COMPOSITION_BEATS } from './limits.ts';
import type { Composition, Note, Track } from './types.ts';

const MAX_JSON_BYTES = 1_048_576;

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, maxLength: number, trim = true): string {
  if (typeof value !== 'string') throw new Error(`${path} must be text.`);
  const result = trim ? value.trim() : value;
  if (!result.trim() || result.length > maxLength) {
    throw new Error(`${path} must contain 1–${maxLength} characters.`);
  }
  return result;
}

function number(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${path} must be ${integer ? 'an integer' : 'a finite number'} between ${min} and ${max}.`);
  }
  return value;
}

export function createComposition(): Composition {
  return { version: 1, title: 'Untitled composition', tempo: 120, tracks: [createTrack('Melody')] };
}

export function createTrack(name = 'New track'): Track {
  return { id: crypto.randomUUID(), name: text(name, 'Track name', 80), instrument: 'sine', volume: 0.8, muted: false, notes: [] };
}

export function createNote(pitch = 60, start = 0): Note {
  return {
    id: crypto.randomUUID(),
    pitch: number(pitch, 'Pitch', 36, 96, true),
    start: number(start, 'Start beat', 0, MAX_COMPOSITION_BEATS - 1),
    duration: 1,
    velocity: 0.8,
  };
}

export function createDemoComposition(): Composition {
  const melody = createTrack('Melody');
  melody.instrument = 'triangle';
  melody.notes = [60, 64, 67, 72, 67, 64, 62, 60].map((pitch, index) => createNote(pitch, index));
  const bass = createTrack('Bass');
  bass.volume = 0.45;
  bass.notes = [48, 53, 55, 48].map((pitch, index) => ({ ...createNote(pitch, index * 2), duration: 2 }));
  return { version: 1, title: 'First light', tempo: 108, tracks: [melody, bass] };
}

export function validateComposition(value: unknown): Composition {
  const project = record(value, 'Composition');
  if (project.version !== 1) throw new Error('Unsupported composition version; expected version 1.');
  const title = text(project.title, 'Title', 80);
  const tempo = number(project.tempo, 'Tempo', 40, 240);
  if (!Array.isArray(project.tracks) || project.tracks.length < 1 || project.tracks.length > 8) {
    throw new Error('Composition must have 1–8 tracks.');
  }
  const ids = new Set<string>();
  const id = (value: unknown, path: string): string => {
    const result = text(value, path, 100, false);
    if (ids.has(result)) throw new Error(`${path} duplicates an existing ID.`);
    ids.add(result);
    return result;
  };
  const tracks = Array.from(project.tracks, (value, index): Track => {
    const path = `Track ${index + 1}`;
    const track = record(value, path);
    const trackId = id(track.id, `${path} ID`);
    const name = text(track.name, `${path} name`, 80);
    if (track.instrument !== 'sine' && track.instrument !== 'triangle' && track.instrument !== 'sawtooth') {
      throw new Error(`${path} instrument must be sine, triangle or sawtooth.`);
    }
    const instrument = track.instrument;
    const volume = number(track.volume, `${path} volume`, 0, 1);
    if (typeof track.muted !== 'boolean') throw new Error(`${path} muted must be true or false.`);
    if (!Array.isArray(track.notes) || track.notes.length > 256) throw new Error(`${path} must have at most 256 notes.`);
    const notes = Array.from(track.notes, (value, index): Note => {
      const notePath = `${path} note ${index + 1}`;
      const note = record(value, notePath);
      const noteId = id(note.id, `${notePath} ID`);
      const pitch = number(note.pitch, `${notePath} pitch`, 36, 96, true);
      const start = number(note.start, `${notePath} start`, 0, MAX_COMPOSITION_BEATS);
      const duration = number(note.duration, `${notePath} duration`, 0.25, 16);
      if (start + duration > MAX_COMPOSITION_BEATS) throw new Error(`${notePath} must end by beat ${MAX_COMPOSITION_BEATS}.`);
      const velocity = number(note.velocity, `${notePath} velocity`, 0, 1);
      return { id: noteId, pitch, start, duration, velocity };
    });
    return { id: trackId, name, instrument, volume, muted: track.muted, notes, ...(Object.hasOwn(track, 'envelope') ? { envelope: validateEnvelope(track.envelope) } : {}), ...(Object.hasOwn(track, 'filter') ? { filter: validateFilter(track.filter) } : {}), ...(Object.hasOwn(track, 'echo') ? { echo: validateEcho(track.echo) } : {}) };
  });
  return { version: 1, title, tempo, tracks };
}

export function parseComposition(json: string): Composition {
  if (typeof json !== 'string') throw new Error('Project JSON must be text.');
  if (json.length > MAX_JSON_BYTES || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES) {
    throw new Error('Project JSON exceeds the 1 MiB size limit.');
  }
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Project contains invalid JSON.');
  }
  return validateComposition(value);
}

export function serializeComposition(project: Composition): string {
  return JSON.stringify(validateComposition(project), null, 2);
}

export function compositionDurationBeats(project: Composition): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const note of track.notes) end = Math.max(end, note.start + note.duration);
  }
  return end;
}
