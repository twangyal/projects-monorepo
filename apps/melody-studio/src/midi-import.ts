export const MIDI_IMPORT_LIMITS = {
  bytes: 1_048_576,
  rawTracks: 32,
  events: 32_768,
  notePairs: 8_192,
  lanes: 16,
  maxTick: 2_147_483_647,
  textBytes: 4_096,
} as const;

export type MidiImportErrorCode =
  | 'invalid-midi' | 'limit' | 'unsupported-midi'
  | 'invalid-selection' | 'stale-review';
export class MidiImportError extends Error {
  readonly code: MidiImportErrorCode;
  constructor(code: MidiImportErrorCode, message: string) {
    super(message);
    this.name = 'MidiImportError';
    this.code = code;
  }
}

export type MidiNameReason =
  | 'invalid-utf8' | 'control' | 'too-long'
  | 'edge-whitespace' | 'multiple-names';
export interface MidiName {
  value: string | null;
  status: 'missing' | 'usable' | 'needs-choice';
  reason: MidiNameReason | null;
}
export type MidiLaneIssueCode =
  | 'shared-channel' | 'percussion' | 'controller'
  | 'expression' | 'changing-state' | 'ambiguous-notes' | 'empty-lane';
export interface MidiLaneIssue {
  code: MidiLaneIssueCode;
  message: string;
}
export interface MidiSourceNote {
  onTick: number;
  offTick: number;
  pitch: number;
  velocity: number; // exact positive integer 1..127
}
export interface MidiLane {
  id: string; // exactly channel-N matching channel
  channel: number; // integer 0..15
  sourceTracks: number[]; // zero-based sorted unique raw-track indices
  name: MidiName;
  noteOnCount: number;
  notes: MidiSourceNote[];
  program: number; // initial/effective integer 0..127
  programExplicit: boolean;
  volume: number; // initial/effective integer CC7 0..127, not normalized
  volumeExplicit: boolean;
  issues: MidiLaneIssue[];
}
export interface MidiMetaSummary {
  type: number;
  count: number;
  bytes: number;
}
export interface MidiPreview {
  format: 0 | 1;
  ppqn: number;
  rawTrackCount: number;
  eventCount: number;
  noteOnCount: number;
  lastTick: number; // max EOT tick, including trailing rests
  tempoMicros: number;
  tempo: number;
  tempoExplicit: boolean;
  title: MidiName; // raw track 0 name, not an authenticated song title
  lanes: MidiLane[]; // ascending channel order; at most 16
  ignoredMeta: MidiMetaSummary[]; // ascending type, includes omitted names/text
  ignoredReleaseVelocityCount: number;
}

function invalid(message = 'The MIDI file is malformed or truncated.'): never {
  throw new MidiImportError('invalid-midi', message);
}
function limit(message: string): never { throw new MidiImportError('limit', message); }
function unsupported(message: string): never { throw new MidiImportError('unsupported-midi', message); }

class Reader {
  readonly bytes: Uint8Array;
  position = 0;
  end: number;
  constructor(bytes: Uint8Array) { this.bytes = bytes; this.end = bytes.length; }
  need(count: number): void {
    if (count < 0 || count > this.end - this.position) invalid();
  }
  byte(): number { this.need(1); return this.bytes[this.position++]; }
  uint16(): number { return this.byte() * 256 + this.byte(); }
  uint32(): number { return this.byte() * 16777216 + this.byte() * 65536 + this.byte() * 256 + this.byte(); }
  tag(expected: string): void {
    for (let index = 0; index < expected.length; index++) if (this.byte() !== expected.charCodeAt(index)) invalid('The MIDI chunk layout is invalid.');
  }
  vlq(): number {
    let value = 0;
    for (let index = 0; index < 4; index++) {
      const byte = this.byte();
      value = value * 128 + byte % 128;
      if (byte < 128) return value;
    }
    invalid('MIDI variable-length values must end within four bytes.');
  }
  data(): number {
    const value = this.byte();
    if (value >= 128) invalid('MIDI channel data bytes must be below 128.');
    return value;
  }
}

interface NameState { seen: boolean; value: string | null; invalid: boolean; multiple: boolean }
const missingName = (): NameState => ({ seen: false, value: null, invalid: false, multiple: false });
function addName(state: NameState, bytes: Uint8Array): void {
  let value: string;
  try { value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { state.invalid = true; return; }
  if (state.seen && state.value !== value) state.multiple = true;
  if (!state.seen) state.value = value;
  state.seen = true;
}
function resolvedName(state: NameState): MidiName {
  if (state.invalid) return { value: null, status: 'needs-choice', reason: 'invalid-utf8' };
  if (state.multiple) return { value: null, status: 'needs-choice', reason: 'multiple-names' };
  if (!state.seen) return { value: null, status: 'missing', reason: null };
  const value = state.value!;
  const control = Array.from(value).some(char => {
    const code = char.codePointAt(0)!;
    return code <= 31 || code >= 127 && code <= 159 || code === 0xfeff;
  });
  const reason: MidiNameReason | null = control ? 'control'
    : value.length > 80 ? 'too-long' : !value.trim() || value.trim() !== value ? 'edge-whitespace' : null;
  return { value, status: reason ? 'needs-choice' : 'usable', reason };
}
function laneName(indices: number[], names: NameState[]): MidiName {
  const merged = missingName();
  for (const index of indices) {
    const state = names[index];
    merged.invalid ||= state.invalid;
    merged.multiple ||= state.multiple;
    if (state.seen) {
      if (merged.seen && merged.value !== state.value) merged.multiple = true;
      if (!merged.seen) merged.value = state.value;
      merged.seen = true;
    }
  }
  return resolvedName(merged);
}

const FIXED_META_LENGTHS = new Map([[0, 2], [47, 0], [81, 3], [88, 4], [89, 2]]);

const ISSUE_MESSAGES: Record<MidiLaneIssueCode, string> = {
  'shared-channel': 'This channel occurs in multiple raw tracks; their global state cannot be merged safely.',
  percussion: 'Percussion channel 10 is not represented by the local instruments.',
  controller: 'This channel uses controllers other than static volume CC7.',
  expression: 'This channel uses pressure or pitch bend that cannot be represented.',
  'changing-state': 'This channel changes program or volume after its first note attack.',
  'ambiguous-notes': 'This channel has overlapping same-pitch attacks, unmatched notes or zero-length notes.',
  'empty-lane': 'This channel has no complete positive-velocity notes to import.',
};
interface LaneState {
  channel: number;
  sourceTracks: number[];
  noteOnCount: number;
  notes: MidiSourceNote[];
  program: number;
  programExplicit: boolean;
  volume: number;
  volumeExplicit: boolean;
  issues: Set<MidiLaneIssueCode>;
  started: boolean;
  active: Map<number, { tick: number; velocity: number }>;
}
function newLane(channel: number): LaneState {
  return { channel, sourceTracks: [], noteOnCount: 0, notes: [], program: 0, programExplicit: false,
    volume: 100, volumeExplicit: false, issues: new Set(channel === 9 ? ['percussion'] : []),
    started: false, active: new Map() };
}

/** Parse an entire bounded SMF before exposing selectable global channels. */
export function parseMidi(bytes: Uint8Array): MidiPreview {
  if (!(bytes instanceof Uint8Array)) invalid('MIDI input must be a byte array.');
  if (bytes.byteLength > MIDI_IMPORT_LIMITS.bytes) limit('MIDI files must be at most 1 MiB.');
  const reader = new Reader(bytes);
  reader.tag('MThd');
  if (reader.uint32() !== 6) invalid('MIDI header length must be exactly six bytes.');
  const format = reader.uint16();
  const rawTrackCount = reader.uint16();
  const ppqn = reader.uint16();
  if (rawTrackCount > MIDI_IMPORT_LIMITS.rawTracks) limit('MIDI files may contain at most 32 raw tracks.');
  if (format !== 0 && format !== 1) invalid('Only MIDI formats 0 and 1 are supported.');
  if (!rawTrackCount || format === 0 && rawTrackCount !== 1) invalid('MIDI format and raw-track count disagree.');
  if (!ppqn || ppqn >= 32768) invalid('MIDI timing must use PPQN between 1 and 32767; SMPTE timing is not supported.');
  const names = Array.from({ length: rawTrackCount }, missingName);
  const laneStates = new Map<number, LaneState>();
  const summaries = new Map<number, MidiMetaSummary>();
  let eventCount = 0, noteOnCount = 0, lastTick = 0, ignoredReleaseVelocityCount = 0;
  let suppliedTempo: number | null = null, minimumTempoTick = Infinity;
  for (let track = 0; track < rawTrackCount; track++) {
    reader.tag('MTrk');
    const size = reader.uint32();
    reader.need(size);
    reader.end = reader.position + size;
    let tick = 0, running = 0, ended = false;
    while (reader.position < reader.end) {
      if (eventCount === MIDI_IMPORT_LIMITS.events) limit('MIDI files may contain at most 32768 events.');
      eventCount++;
      tick += reader.vlq();
      if (tick > MIDI_IMPORT_LIMITS.maxTick) limit('MIDI absolute ticks exceed the supported bound.');
      let status = reader.byte();
      if (status < 128) {
        if (!running) invalid('MIDI running status has no preceding channel event.');
        reader.position--;
        status = running;
      } else if (status < 240) running = status;
      else running = 0;
      if (status === 255) {
        const type = reader.byte();
        const length = reader.vlq();
        reader.need(length);
        const fixed = FIXED_META_LENGTHS.get(type);
        if (fixed !== undefined && length !== fixed) invalid('A MIDI metadata event has an invalid fixed length.');
        if (type >= 1 && type <= 9) {
          if (length > MIDI_IMPORT_LIMITS.textBytes) limit('MIDI text events must be at most 4096 bytes.');
          if (type === 3) addName(names[track], bytes.subarray(reader.position, reader.position + length));
        } else if (fixed === undefined) unsupported('This MIDI file contains unsupported global metadata.');
        if (type === 47) {
          if (reader.position !== reader.end) invalid('MIDI end-of-track must be at the exact track end.');
          ended = true;
        } else if (type === 81) {
          const micros = bytes[reader.position] * 65536 + bytes[reader.position + 1] * 256 + bytes[reader.position + 2];
          if (!micros || suppliedTempo !== null && micros !== suppliedTempo) unsupported('MIDI tempo changes or zero tempo are not supported.');
          suppliedTempo = micros;
          minimumTempoTick = Math.min(minimumTempoTick, tick);
        } else {
          const summary = summaries.get(type) ?? { type, count: 0, bytes: 0 };
          summary.count++; summary.bytes += length;
          summaries.set(type, summary);
        }
        reader.position += length;
      } else if (status === 240 || status === 247) {
        const length = reader.vlq();
        reader.need(length);
        unsupported('MIDI SysEx device configuration is not supported.');
      } else if (status >= 240) invalid('MIDI system-common and realtime statuses are not valid channel events.');
      else {
        const channel = status % 16, kind = status - channel;
        const first = reader.data();
        const second = kind === 192 || kind === 208 ? 0 : reader.data();
        let lane = laneStates.get(channel);
        if (!lane) { lane = newLane(channel); laneStates.set(channel, lane); }
        if (lane.sourceTracks.at(-1) !== track) {
          lane.sourceTracks.push(track);
          if (lane.sourceTracks.length > 1) { lane.issues.add('shared-channel'); lane.active.clear(); }
        }
        if (kind === 144 && second > 0) {
          if (noteOnCount === MIDI_IMPORT_LIMITS.notePairs) limit('MIDI files may contain at most 8192 positive note attacks.');
          noteOnCount++; lane.noteOnCount++;
        }
        if (kind === 128 && second > 0) ignoredReleaseVelocityCount++;
        if (lane.sourceTracks.length > 1) continue;
        if (kind === 192 || kind === 176 && first === 7) {
          const field = kind === 192 ? 'program' : 'volume';
          const value = kind === 192 ? first : second;
          if (lane.started) {
            if (value !== lane[field]) lane.issues.add('changing-state');
          } else { lane[field] = value; lane[field === 'program' ? 'programExplicit' : 'volumeExplicit'] = true; }
        } else if (kind === 176) lane.issues.add('controller');
        else if (kind === 160 || kind === 208 || kind === 224) lane.issues.add('expression');
        else if (kind === 144 && second > 0) {
          lane.started = true;
          if (lane.active.has(first)) lane.issues.add('ambiguous-notes');
          else lane.active.set(first, { tick, velocity: second });
        } else {
          const attack = lane.active.get(first);
          if (!attack || attack.tick === tick) lane.issues.add('ambiguous-notes');
          else lane.notes.push({ onTick: attack.tick, offTick: tick, pitch: first, velocity: attack.velocity });
          lane.active.delete(first);
        }
      }
    }
    if (!ended) invalid('Every MIDI track requires an end-of-track event.');
    for (const lane of laneStates.values()) {
      if (lane.sourceTracks.at(-1) === track && lane.active.size) { lane.issues.add('ambiguous-notes'); lane.active.clear(); }
    }
    lastTick = Math.max(lastTick, tick);
    reader.end = bytes.length;
  }
  if (reader.position !== bytes.length) invalid('The MIDI file contains undeclared trailing bytes.');
  const tempoMicros = suppliedTempo ?? 500000;
  if (tempoMicros !== 500000 && minimumTempoTick > 0) unsupported('A nondefault MIDI tempo must begin at tick zero.');
  const tempo = 60_000_000 / tempoMicros;
  if (tempo < 40 || tempo > 240) unsupported('MIDI tempo must be between 40 and 240 BPM.');
  const lanes: MidiLane[] = [...laneStates.values()].sort((a, b) => a.channel - b.channel).map(lane => {
    if (!lane.noteOnCount || !lane.notes.length) lane.issues.add('empty-lane');
    const shared = lane.sourceTracks.length > 1;
    return { id: `channel-${lane.channel}`, channel: lane.channel, sourceTracks: [...lane.sourceTracks],
      name: laneName(lane.sourceTracks, names), noteOnCount: lane.noteOnCount,
      notes: lane.issues.size ? [] : lane.notes.sort((a, b) => a.onTick - b.onTick || a.pitch - b.pitch || a.offTick - b.offTick),
      program: shared ? 0 : lane.program, volume: shared ? 100 : lane.volume,
      programExplicit: !shared && lane.programExplicit, volumeExplicit: !shared && lane.volumeExplicit,
      issues: [...lane.issues].map(code => ({ code, message: ISSUE_MESSAGES[code] })) };
  });
  return { format, ppqn, rawTrackCount, eventCount, noteOnCount, lastTick, tempoMicros, tempo,
    tempoExplicit: suppliedTempo !== null, title: resolvedName(names[0]), lanes,
    ignoredMeta: [...summaries.values()].sort((a, b) => a.type - b.type), ignoredReleaseVelocityCount };
}
