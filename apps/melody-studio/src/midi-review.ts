import { MAX_COMPOSITION_BEATS } from './limits.ts';
import type { Composition, Instrument } from './types.ts';
import type { MidiPreview, MidiLane, MidiName } from './midi-import.ts';
import { MidiImportError, MIDI_IMPORT_LIMITS as LIMITS } from './midi-import.ts';
import { validateComposition } from './model.ts';

export interface MidiLaneChoice { laneId: string; name: string; instrument: Instrument }
export interface MidiImportChoices { title: string; startBeat: number; endBeat: number; lanes: MidiLaneChoice[] }
export interface MidiReviewedLane {
  laneId: string; sourceTracks: number[]; channel: number; sourceName: string | null;
  name: string; instrument: Instrument; sourceProgram: number; sourceVolume: number;
  includedNotes: number; outsideNotes: number;
}
export interface MidiImportReview {
  base: Composition; candidate: Composition; choices: MidiImportChoices;
  lanes: MidiReviewedLane[]; sourceNoteOnCount: number; includedNotes: number;
  excludedNoteOnCount: number; warnings: string[];
}

function invalid(message = 'MIDI source or selection is invalid.'): never {
  throw new MidiImportError('invalid-selection', message);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of keys) if (!descriptors[key] || !('value' in descriptors[key]) || !descriptors[key].enumerable) invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) invalid();
  const own = Reflect.ownKeys(value);
  if (own.length !== value.length + 1) invalid();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid();
  }
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid();
  return value;
}
function number(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
function string(value: unknown, maximum: number, minimum = 0): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}
function wellFormed(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}
function hasControls(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code <= 31 || code >= 127 && code <= 159 || code === 0xfeff) return true;
  }
  return false;
}
function chosenText(value: unknown): string {
  const text = string(value, 80, 1);
  if (text.trim() !== text || !text.trim() || hasControls(text) || !wellFormed(text)) {
    invalid('Choose names with 1–80 UTF-16 units, valid Unicode, no controls or edge whitespace.');
  }
  return text;
}
function sourceText(value: unknown): string {
  const text = string(value, LIMITS.textBytes);
  if (!wellFormed(text) || new TextEncoder().encode(text).length > LIMITS.textBytes) invalid();
  return text;
}
function instrument(value: unknown): Instrument {
  if (value !== 'sine' && value !== 'triangle' && value !== 'sawtooth') invalid('Choose a local instrument for every selected channel.');
  return value;
}
function name(value: unknown): MidiName {
  const data = object(value, ['value', 'status', 'reason']);
  if (data.status === 'missing') {
    if (data.value !== null || data.reason !== null) invalid();
    return { value: null, status: 'missing', reason: null };
  }
  if (data.status === 'usable') {
    if (data.reason !== null) invalid();
    return { value: chosenText(data.value), status: 'usable', reason: null };
  }
  if (data.status !== 'needs-choice') invalid();
  if (data.reason === 'invalid-utf8' || data.reason === 'multiple-names') {
    if (data.value !== null) invalid();
    return { value: null, status: 'needs-choice', reason: data.reason };
  }
  const text = sourceText(data.value);
  const reason = hasControls(text) ? 'control'
    : text.length > 80 ? 'too-long' : !text.trim() || text.trim() !== text ? 'edge-whitespace' : null;
  if (!reason || data.reason !== reason) invalid();
  return { value: text, status: 'needs-choice', reason };
}
function sourceTracks(value: unknown, count: number): number[] {
  let previous = -1;
  return array(value, count, 1).map(item => {
    const index = integer(item, 0, count - 1);
    if (index <= previous) invalid();
    previous = index; return index;
  });
}
function composition(value: unknown): Composition {
  const root = object(value, ['version', 'title', 'tempo', 'tracks']);
  integer(root.version, 1, 1); string(root.title, 80, 1); number(root.tempo, 40, 240);
  for (const part of array(root.tracks, 8, 1)) {
    const track = object(part, ['id', 'name', 'instrument', 'volume', 'muted', 'notes']);
    string(track.id, 100, 1); string(track.name, 80, 1); instrument(track.instrument);
    number(track.volume, 0, 1); boolean(track.muted);
    for (const item of array(track.notes, 256)) {
      const note = object(item, ['id', 'pitch', 'start', 'duration', 'velocity']);
      string(note.id, 100, 1); integer(note.pitch, 36, 96); number(note.start, 0, MAX_COMPOSITION_BEATS);
      number(note.duration, .25, 16); number(note.velocity, 0, 1);
    }
  }
  try { return validateComposition(value); } catch { invalid('Composition does not satisfy the existing note and track limits.'); }
}
function preview(value: unknown): MidiPreview {
  const root = object(value, ['format', 'ppqn', 'rawTrackCount', 'eventCount', 'noteOnCount', 'lastTick',
    'tempoMicros', 'tempo', 'tempoExplicit', 'title', 'lanes', 'ignoredMeta', 'ignoredReleaseVelocityCount']);
  const format = integer(root.format, 0, 1) as 0 | 1;
  const ppqn = integer(root.ppqn, 1, 32767);
  const rawTrackCount = integer(root.rawTrackCount, 1, LIMITS.rawTracks);
  if (format === 0 && rawTrackCount !== 1) invalid();
  const eventCount = integer(root.eventCount, rawTrackCount, LIMITS.events);
  const noteOnCount = integer(root.noteOnCount, 0, LIMITS.notePairs);
  const lastTick = integer(root.lastTick, 0, LIMITS.maxTick);
  const tempoMicros = integer(root.tempoMicros, 250000, 1500000);
  const tempo = number(root.tempo, 40, 240);
  if (tempo !== 60_000_000 / tempoMicros) invalid('MIDI tempo does not match its exact source value.');
  const tempoExplicit = boolean(root.tempoExplicit);
  if (!tempoExplicit && tempoMicros !== 500000) invalid();
  const title = name(root.title);
  let previousChannel = -1, totalAttacks = 0, supportedPairs = 0;
  const issueCodes = ['shared-channel', 'percussion', 'controller', 'expression', 'changing-state', 'ambiguous-notes', 'empty-lane'];
  const lanes: MidiLane[] = array(root.lanes, LIMITS.lanes).map(value => {
    const part = object(value, ['id', 'channel', 'sourceTracks', 'name', 'noteOnCount', 'notes', 'program', 'programExplicit', 'volume', 'volumeExplicit', 'issues']);
    const channel = integer(part.channel, 0, 15);
    if (channel <= previousChannel || part.id !== `channel-${channel}`) invalid();
    previousChannel = channel;
    const tracks = sourceTracks(part.sourceTracks, rawTrackCount);
    const attacks = integer(part.noteOnCount, 0, LIMITS.notePairs);
    totalAttacks += attacks;
    if (totalAttacks > LIMITS.notePairs) invalid();
    const seenIssues = new Set<string>();
    const issues = array(part.issues, issueCodes.length).map(value => {
      const issue = object(value, ['code', 'message']);
      const code = string(issue.code, 32, 1), message = string(issue.message, 512, 1);
      if (!issueCodes.includes(code) || seenIssues.has(code) || !wellFormed(message)) invalid();
      seenIssues.add(code);
      return { code: code as MidiLane['issues'][number]['code'], message };
    });
    if (channel === 9 && !seenIssues.has('percussion')) invalid();
    if (tracks.length > 1 && !seenIssues.has('shared-channel')) invalid();
    if (!attacks && !seenIssues.has('empty-lane')) invalid();
    const program = integer(part.program, 0, 127), volume = integer(part.volume, 0, 127);
    const programExplicit = boolean(part.programExplicit), volumeExplicit = boolean(part.volumeExplicit);
    if ((!programExplicit && program !== 0) || (!volumeExplicit && volume !== 100)) invalid();
    if (tracks.length > 1 && (program !== 0 || volume !== 100 || programExplicit || volumeExplicit)) invalid();
    const rawNotes = array(part.notes, LIMITS.notePairs);
    if (issues.length ? rawNotes.length !== 0 : rawNotes.length !== attacks || attacks === 0) invalid();
    let previous: MidiLane['notes'][number] | undefined;
    const pitchEnds = new Map<number, number>();
    const notes = rawNotes.map(item => {
      const n = object(item, ['onTick', 'offTick', 'pitch', 'velocity']);
      const onTick = integer(n.onTick, 0, lastTick), offTick = integer(n.offTick, onTick + 1, lastTick);
      const pitch = integer(n.pitch, 0, 127), velocity = integer(n.velocity, 1, 127);
      if (previous && (onTick < previous.onTick || onTick === previous.onTick &&
        (pitch < previous.pitch || pitch === previous.pitch && offTick < previous.offTick))) invalid();
      if (onTick < (pitchEnds.get(pitch) ?? -1)) invalid('A supported MIDI lane contains overlapping same-pitch notes.');
      pitchEnds.set(pitch, offTick);
      previous = { onTick, offTick, pitch, velocity }; return previous;
    });
    if (!issues.length) supportedPairs += notes.length;
    return { id: `channel-${channel}`, channel, sourceTracks: tracks, name: name(part.name), noteOnCount: attacks,
      notes, program, programExplicit, volume, volumeExplicit, issues };
  });
  if (noteOnCount !== totalAttacks) invalid('MIDI source attack counts do not agree.');
  const metaTypes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x58, 0x59];
  let previousMeta = -1, metaCount = 0;
  const ignoredMeta = array(root.ignoredMeta, metaTypes.length).map(value => {
    const data = object(value, ['type', 'count', 'bytes']);
    const type = integer(data.type, 0, 255), count = integer(data.count, 1, eventCount);
    const bytes = integer(data.bytes, 0, LIMITS.bytes);
    if (!metaTypes.includes(type) || type <= previousMeta || bytes > count * LIMITS.textBytes ||
      type === 0 && bytes !== count * 2 || type === 0x58 && bytes !== count * 4 || type === 0x59 && bytes !== count * 2) invalid();
    previousMeta = type; metaCount += count; return { type, count, bytes };
  });
  if (totalAttacks + supportedPairs + rawTrackCount + metaCount + Number(tempoExplicit) > eventCount) invalid();
  const ignoredReleaseVelocityCount = integer(root.ignoredReleaseVelocityCount, 0, eventCount);
  return { format, ppqn, rawTrackCount, eventCount, noteOnCount, lastTick, tempoMicros, tempo,
    tempoExplicit, title, lanes, ignoredMeta, ignoredReleaseVelocityCount };
}
function selection(value: unknown, maximumEnd = LIMITS.maxTick + 1): MidiImportChoices {
  const data = object(value, ['title', 'startBeat', 'endBeat', 'lanes']);
  const title = chosenText(data.title), startBeat = integer(data.startBeat, 0, maximumEnd), endBeat = integer(data.endBeat, 1, maximumEnd);
  if (endBeat <= startBeat || endBeat - startBeat > MAX_COMPOSITION_BEATS) invalid(`Choose a whole-beat source window spanning 1–${MAX_COMPOSITION_BEATS} beats.`);
  const seen = new Set<string>();
  const lanes = array(data.lanes, 8, 1).map(value => {
    const lane = object(value, ['laneId', 'name', 'instrument']);
    const laneId = string(lane.laneId, 10, 1);
    if (!/^channel-(?:[0-9]|1[0-5])$/.test(laneId) || seen.has(laneId)) invalid();
    seen.add(laneId);
    return { laneId, name: chosenText(lane.name), instrument: instrument(lane.instrument) };
  });
  return { title, startBeat, endBeat, lanes };
}

interface Receipt { canonical: string; base: string; candidate: Composition }
const receipts = new WeakMap<MidiImportReview, Receipt>();

export function buildMidiReview(base: Composition, source: MidiPreview, choices: MidiImportChoices): MidiImportReview {
  const checkedBase = composition(base), checkedSource = preview(source);
  const checkedChoices = selection(choices, Math.max(1, Math.ceil(checkedSource.lastTick / checkedSource.ppqn)));
  const startTick = checkedChoices.startBeat * checkedSource.ppqn, endTick = checkedChoices.endBeat * checkedSource.ppqn;
  if (!Number.isSafeInteger(startTick) || !Number.isSafeInteger(endTick)) invalid();
  const ids = new Set(checkedBase.tracks.flatMap(part => [part.id, ...part.notes.map(note => note.id)]));
  const allocate = (): string => {
    for (let attempt = 0; attempt < 32; attempt++) {
      const id = crypto.randomUUID();
      if (typeof id === 'string' && id.length > 0 && id.length <= 100 && !ids.has(id)) { ids.add(id); return id; }
    }
    invalid('Could not allocate a unique imported ID after 32 attempts. Try reviewing again.');
  };
  const lanes: MidiReviewedLane[] = [];
  const tracks: Composition['tracks'] = [];
  let includedNotes = 0;
  for (const part of checkedSource.lanes) {
    const choice = checkedChoices.lanes.find(choice => choice.laneId === part.id);
    if (!choice) continue;
    if (part.issues.length) invalid(`Channel ${part.channel + 1} is unsupported; deselect that part.`);
    let outsideNotes = 0;
    const notes: Composition['tracks'][number]['notes'] = [];
    for (const note of part.notes) {
      if (note.offTick <= startTick || note.onTick >= endTick) { outsideNotes++; continue; }
      if (note.onTick < startTick || note.offTick > endTick) {
        invalid(`Channel ${part.channel + 1} note ticks ${note.onTick}–${note.offTick} cross the source window boundary. Adjust the window or deselect that part.`);
      }
      if (notes.length >= 256) invalid('Each selected part must contain at most 256 included notes.');
      notes.push({ id: allocate(), pitch: note.pitch, start: (note.onTick - startTick) / checkedSource.ppqn,
        duration: (note.offTick - note.onTick) / checkedSource.ppqn, velocity: note.velocity / 127 });
    }
    if (!notes.length) invalid(`Channel ${part.channel + 1} has no whole notes inside the chosen window.`);
    includedNotes += notes.length;
    tracks.push({ id: allocate(), name: choice.name, instrument: choice.instrument, volume: part.volume / 127, muted: false, notes });
    lanes.push({ laneId: part.id, sourceTracks: [...part.sourceTracks], channel: part.channel, sourceName: part.name.value,
      name: choice.name, instrument: choice.instrument, sourceProgram: part.program, sourceVolume: part.volume,
      includedNotes: notes.length, outsideNotes });
  }
  if (tracks.length !== checkedChoices.lanes.length) invalid('Choose existing supported source channels.');
  const candidate = composition({ version: 1, title: checkedChoices.title, tempo: checkedSource.tempo, tracks });
  const excluded = checkedSource.noteOnCount - includedNotes;
  const warnings = [
    'Local instruments approximate sound; source GM programs are hints, not source-sound reproduction.',
    `Source beat ${checkedChoices.startBeat + 1} becomes destination beat 1; leading and internal rests within the window remain.`,
    'Composition schema 1 ends at its last note: trailing silence and source EOT padding are not retained.',
    'MIDI re-export rounds positions to 480 ticks per beat and merges overlapping same-pitch notes; JSON retains imported beat values.',
    'Title and part names are explicit choices; source text may be omitted or replaced by disclosed fallback names.',
    `${excluded} excluded source note attacks include unsupported/unselected channels and selected-window outside notes.`,
  ];
  if (checkedSource.ignoredMeta.length) warnings.push('Source text/names, sequence numbers and time/key metadata are omitted except names explicitly chosen; source metadata type/count/byte totals remain in the preview.');
  if (checkedSource.ignoredReleaseVelocityCount) warnings.push(`${checkedSource.ignoredReleaseVelocityCount} nonzero source note-off release velocities are omitted.`);
  if (!checkedSource.tempoExplicit) warnings.push('Source tempo defaults to 120 BPM; this is an initial-state convention.');
  if (checkedSource.lanes.some(part => !part.programExplicit || !part.volumeExplicit)) warnings.push('Absent initial program/CC7 use GM program 0 and CC7 100 defaults; these do not establish an external receiver state.');
  if (tracks.some(part => part.volume === 0)) warnings.push('A selected channel has source CC7 zero and imports as a silent track; onset velocity remains separate.');
  const review: MidiImportReview = { base: checkedBase, candidate, choices: checkedChoices, lanes,
    sourceNoteOnCount: checkedSource.noteOnCount, includedNotes, excludedNoteOnCount: excluded, warnings };
  const canonical = canonicalReview(review);
  receipts.set(review, { canonical, base: JSON.stringify(checkedBase), candidate: composition(candidate) });
  return review;
}

function canonicalReview(value: unknown): string {
  const root = object(value, ['base', 'candidate', 'choices', 'lanes', 'sourceNoteOnCount', 'includedNotes', 'excludedNoteOnCount', 'warnings']);
  composition(root.base);
  const candidate = composition(root.candidate), choices = selection(root.choices);
  const sourceNoteOnCount = integer(root.sourceNoteOnCount, 0, LIMITS.notePairs);
  const includedNotes = integer(root.includedNotes, 1, 8 * 256), excludedNoteOnCount = integer(root.excludedNoteOnCount, 0, LIMITS.notePairs);
  if (sourceNoteOnCount !== includedNotes + excludedNoteOnCount) invalid();
  let previous = -1;
  const lanes = array(root.lanes, 8, 1).map(value => {
    const lane = object(value, ['laneId', 'sourceTracks', 'channel', 'sourceName', 'name', 'instrument', 'sourceProgram', 'sourceVolume', 'includedNotes', 'outsideNotes']);
    const channel = integer(lane.channel, 0, 15);
    if (channel <= previous || lane.laneId !== `channel-${channel}`) invalid(); previous = channel;
    return { laneId: `channel-${channel}`, sourceTracks: sourceTracks(lane.sourceTracks, LIMITS.rawTracks), channel,
      sourceName: lane.sourceName === null ? null : sourceText(lane.sourceName), name: chosenText(lane.name), instrument: instrument(lane.instrument),
      sourceProgram: integer(lane.sourceProgram, 0, 127), sourceVolume: integer(lane.sourceVolume, 0, 127),
      includedNotes: integer(lane.includedNotes, 1, 256), outsideNotes: integer(lane.outsideNotes, 0, LIMITS.notePairs) };
  });
  for (const value of array(root.warnings, 64)) {
    const text = string(value, 512, 1); if (!wellFormed(text)) invalid();
  }
  if (lanes.length !== candidate.tracks.length || lanes.length !== choices.lanes.length ||
    includedNotes !== candidate.tracks.reduce((count, part) => count + part.notes.length, 0)) invalid();
  // All nested data is bounded, exact and accessor-free. Pin the complete
  // public values, including changes that model normalization would erase.
  return JSON.stringify(root);
}

export function applyMidiImport(current: Composition, review: MidiImportReview): Composition {
  const receipt = typeof review === 'object' && review !== null ? receipts.get(review) : undefined;
  if (!receipt) throw new MidiImportError('stale-review', 'Use an unchanged MIDI review produced here; clones and imported reviews cannot be applied.');
  try {
    const canonical = canonicalReview(review);
    const checkedCurrent = composition(current);
    if (canonical !== receipt.canonical || JSON.stringify(checkedCurrent) !== receipt.base) {
      throw new Error('stale');
    }
    return composition(receipt.candidate);
  } catch {
    throw new MidiImportError('stale-review', 'MIDI review or current composition changed. Review the phrase again before replacing.');
  }
}
