import type { Composition } from './types.ts';
import { validateComposition } from './model.ts';
export type RollSnap = 0 | 0.25 | 0.125;
export type RollEdit =
  | { kind: 'move'; noteId: string; deltaBeats: number; deltaPitch: number; snap: RollSnap }
  | { kind: 'resize'; noteId: string; deltaBeats: number; snap: RollSnap }
  | { kind: 'add'; id: string; pitch: number; start: number; duration: number; velocity: number; snap: RollSnap };

function fail(message: string): never { throw new Error(message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Roll edit must be a plain data record.');
  const kind = Object.getOwnPropertyDescriptor(value, 'kind');
  if (!kind?.enumerable || !('value' in kind)) fail('Choose Add, Move or Resize without accessor fields.');
  const keys = kind.value === 'move' ? ['kind', 'noteId', 'deltaBeats', 'deltaPitch', 'snap']
    : kind.value === 'resize' ? ['kind', 'noteId', 'deltaBeats', 'snap']
      : kind.value === 'add' ? ['kind', 'id', 'pitch', 'start', 'duration', 'velocity', 'snap'] : [];
  const own = Reflect.ownKeys(value);
  if (!keys.length || own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) fail('Roll edit has unsupported or missing fields.');
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !('value' in field)) fail('Roll edits must contain data fields without accessors.');
  }
  return value as Record<string, unknown>;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number.`);
  return value;
}
function integer(value: unknown, label: string): number {
  const result = finite(value, label);
  if (!Number.isInteger(result)) fail(`${label} must be an integer.`);
  return result;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) fail('Choose an existing track or note ID of 1–100 characters.');
  return value;
}
function snapOption(value: unknown): RollSnap {
  if (value !== 0 && value !== .25 && value !== .125) fail('Snap must be Off, quarter beat or eighth beat.');
  return value;
}
function snapped(value: number, snap: RollSnap): number {
  if (snap === 0 || value === 0) return value;
  const result = Math.sign(value) * Math.floor(Math.abs(value) / snap + .5) * snap;
  if (!Number.isFinite(result)) fail('This edit is too large to represent.');
  return result;
}
export function proposeRollEdit(composition: Composition, trackId: string, edit: RollEdit): Composition {
  const candidate = validateComposition(composition), selectedId = id(trackId), options = record(edit);
  const track = candidate.tracks.find(track => track.id === selectedId);
  if (!track) fail('Select an existing piano roll track.');
  const snap = snapOption(options.snap);
  if (options.kind === 'add') {
    track.notes.push({ id: id(options.id), pitch: integer(options.pitch, 'Pitch'),
      start: snapped(finite(options.start, 'Start beat'), snap), duration: snapped(finite(options.duration, 'Duration'), snap),
      velocity: finite(options.velocity, 'Velocity') });
  } else {
    const noteId = id(options.noteId), note = track.notes.find(note => note.id === noteId);
    if (!note) fail('Select an existing note in this piano roll track.');
    const delta = snapped(finite(options.deltaBeats, 'Beat delta'), snap);
    if (options.kind === 'move') {
      const pitchDelta = integer(options.deltaPitch, 'Pitch delta');
      if (delta !== 0) note.start += delta;
      if (pitchDelta !== 0) note.pitch += pitchDelta;
    } else if (delta !== 0) note.duration += delta;
  }
  return validateComposition(candidate);
}
