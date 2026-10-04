import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMidi, MidiImportError } from '../src/midi-import.ts';
import type { MidiPreview } from '../src/midi-import.ts';
import { buildMidiReview, applyMidiImport } from '../src/midi-review.ts';
import type { MidiImportChoices, MidiImportReview } from '../src/midi-review.ts';
import type { Composition } from '../src/types.ts';

// Original authored SMF bytes, never made with the product's MIDI exporter.
const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];
const word = (value: number): number[] => [Math.floor(value / 256), value % 256];
const dword = (value: number): number[] => [Math.floor(value / 16777216), Math.floor(value / 65536) % 256, Math.floor(value / 256) % 256, value % 256];
function vlq(value: number): number[] {
  assert.ok(Number.isInteger(value) && value >= 0 && value <= 0x0fffffff);
  const digits = [value % 128];
  for (let remaining = Math.floor(value / 128); remaining; remaining = Math.floor(remaining / 128)) digits.unshift(remaining % 128 | 128);
  return digits;
}
interface AuthoredEvent { tick: number; bytes: number[] }
const event = (tick: number, bytes: number[]): AuthoredEvent => ({ tick, bytes });
const meta = (type: number, bytes: number[]): number[] => [255, type, ...vlq(bytes.length), ...bytes];
const name = (text: string): number[] => meta(3, utf8(text));
const tempo = (micros: number): number[] => meta(81, [Math.floor(micros / 65536), Math.floor(micros / 256) % 256, micros % 256]);
function timed(events: AuthoredEvent[], endTick: number): number[] {
  let previous = 0;
  const data: number[] = [];
  for (const row of [...events, event(endTick, [255, 47, 0])]) {
    assert.ok(row.tick >= previous, 'authored physical event order');
    data.push(...vlq(row.tick - previous), ...row.bytes);
    previous = row.tick;
  }
  return data;
}
function smf(tracks: number[][], ppqn = 100, format = tracks.length === 1 ? 0 : 1): Uint8Array {
  return new Uint8Array([...utf8('MThd'), 0, 0, 0, 6, ...word(format), ...word(tracks.length), ...word(ppqn),
    ...tracks.flatMap(data => [...utf8('MTrk'), ...dword(data.length), ...data])]);
}
function basicBytes(): Uint8Array {
  // PPQN96; literal deltas0/24/24/48. Two running-status messages,
  // including velocity-zero note-off; CC7 and onset velocities are separate.
  return smf([[0, 255, 3, 7, ...utf8('Fixture'), 0, 255, 81, 3, 7, 161, 32,
    0, 192, 73, 0, 176, 7, 64, 0, 144, 60, 64,
    24, 60, 0, 24, 64, 96, 48, 128, 64, 0, 0, 255, 47, 0]], 96);
}
function base(): Composition {
  return { version: 1, title: 'Existing committed music', tempo: 90,
    tracks: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Existing', instrument: 'triangle', volume: 0.8,
      muted: false, notes: [{ id: 'old-note', pitch: 48, start: 1, duration: 2, velocity: 0.6 }] }] };
}
function choices(laneIds = ['channel-0'], startBeat = 0, endBeat = 1): MidiImportChoices {
  return { title: 'Independent imported phrase', startBeat, endBeat,
    lanes: laneIds.map(laneId => ({ laneId, name: `Chosen ${laneId}`, instrument: 'sine' })) };
}
const noteShape = (project: Composition) => project.tracks.map(track => ({ name: track.name, instrument: track.instrument,
  volume: track.volume, muted: track.muted,
  notes: track.notes.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })) }));
function rejects(operation: () => unknown, code?: string): void {
  assert.throws(operation, error => error instanceof MidiImportError && (!code || error.code === code));
}
function validSource(): MidiPreview {
  const source = parseMidi(basicBytes());
  assert.equal(source.noteOnCount, 2); // Valid admission gates each negative suite.
  return source;
}
const issues = (source: MidiPreview, channel = 0): string[] => source.lanes.find(lane => lane.channel === channel)!.issues.map(issue => issue.code);

// Also used as a declared expectation for the separate native artifact probe.
function offGridPhrase(): Uint8Array {
  return smf([
    timed([event(0, name('Literal <phrase> 🎵')), event(0, tempo(500000))], 800),
    timed([event(0, name('Selected source')), event(0, [194, 81]), event(0, [178, 7, 64]),
      event(0, [146, 68, 100]), event(50, [130, 68, 0]),
      event(213, [146, 69, 96]), event(313, [130, 69, 0]),
      event(413, [146, 72, 32]), event(513, [130, 72, 0]),
      event(600, [146, 76, 100]), event(700, [130, 76, 0])], 800),
    timed([event(215, [149, 60, 127]), event(315, [133, 60, 0])], 800),
  ]);
}

test('oracle literal SMF0 running status and zero-velocity off preserve raw clocks and independent state', () => {
  const source = parseMidi(basicBytes());
  assert.deepEqual([source.format, source.ppqn, source.rawTrackCount, source.eventCount, source.noteOnCount,
    source.lastTick, source.tempoMicros, source.tempo, source.tempoExplicit], [0, 96, 1, 9, 2, 96, 500000, 120, true]);
  assert.deepEqual(source.title, { value: 'Fixture', status: 'usable', reason: null });
  assert.deepEqual(source.ignoredMeta, [{ type: 3, count: 1, bytes: 7 }]);
  assert.equal(source.ignoredReleaseVelocityCount, 0);
  assert.deepEqual(source.lanes, [{ id: 'channel-0', channel: 0, sourceTracks: [0], name: source.title,
    noteOnCount: 2, notes: [{ onTick: 0, offTick: 24, pitch: 60, velocity: 64 },
      { onTick: 48, offTick: 96, pitch: 64, velocity: 96 }], program: 73, programExplicit: true,
    volume: 64, volumeExplicit: true, issues: [] }]);
});

test('oracle polyphonic pairing sorts onset/pitch independently of release order and records release velocity', () => {
  const source = parseMidi(smf([timed([event(0, [144, 67, 30]), event(0, [144, 60, 80]),
    event(25, [128, 67, 45]), event(50, [128, 60, 0])], 100)]));
  assert.deepEqual(source.lanes[0].notes, [{ onTick: 0, offTick: 50, pitch: 60, velocity: 80 },
    { onTick: 0, offTick: 25, pitch: 67, velocity: 30 }]);
  assert.equal(source.ignoredReleaseVelocityCount, 1);
  assert.deepEqual([source.tempoMicros, source.tempo, source.tempoExplicit], [500000, 120, false]);
  assert.deepEqual([source.lanes[0].program, source.lanes[0].programExplicit, source.lanes[0].volume,
    source.lanes[0].volumeExplicit], [0, false, 100, false]);
  assert.deepEqual(source.title, { value: null, status: 'missing', reason: null });
});

test('oracle tempo is globally constant independently of raw-track encounter order and preserves fractional BPM', () => {
  const late = timed([event(96, tempo(333333))], 100);
  const initial = timed([event(0, tempo(333333)), event(0, [145, 69, 100]), event(25, [129, 69, 0])], 100);
  for (const tracks of [[late, initial], [initial, late]]) {
    const source = parseMidi(smf(tracks));
    assert.equal(source.tempoMicros, 333333);
    assert.equal(source.tempo, 60000000 / 333333);
    assert.equal(source.tempoExplicit, true);
    assert.equal(source.lanes[0].channel, 1);
  }
  assert.equal(parseMidi(smf([timed([event(10, tempo(500000))], 20)])).tempo, 120);
  for (const rows of [[event(10, tempo(333333))], [event(0, tempo(500000)), event(99, tempo(600000))],
    [event(0, tempo(0))], [event(0, tempo(1500001))], [event(0, tempo(249999))]]) rejects(() => parseMidi(smf([timed(rows, 100)])));
  assert.equal(parseMidi(smf([timed([event(0, tempo(250000))], 1)])).tempo, 240);
  assert.equal(parseMidi(smf([timed([event(0, tempo(1500000))], 1)])).tempo, 40);
});

test('oracle shared-channel ownership includes state-only tracks and never invents a merged lane', () => {
  const source = parseMidi(smf([
    timed([event(0, [192, 81]), event(0, [176, 7, 1])], 100),
    timed([event(0, [144, 60, 127]), event(25, [128, 60, 0]),
      event(0 + 25, [147, 72, 90]), event(50, [131, 72, 0])], 100),
  ]));
  assert.deepEqual(source.lanes.map(lane => lane.channel), [0, 3]);
  const shared = source.lanes[0];
  assert.deepEqual(shared.sourceTracks, [0, 1]);
  assert.deepEqual(shared.notes, []);
  assert.equal(shared.noteOnCount, 1);
  assert.ok(issues(source).includes('shared-channel'));
  assert.deepEqual([shared.program, shared.volume, shared.programExplicit, shared.volumeExplicit], [0, 100, false, false]);
  const review = buildMidiReview(base(), source, choices(['channel-3']));
  assert.deepEqual([review.sourceNoteOnCount, review.includedNotes, review.excludedNoteOnCount], [2, 1, 1]);
  rejects(() => buildMidiReview(base(), source, choices(['channel-0'])));
});

test('oracle initial program/CC7 uses physical event order and only identical later repeats are supported', () => {
  const supported = timed([event(0, [192, 1]), event(0, [192, 73]), event(0, [176, 7, 0]),
    event(0, [144, 60, 64]), event(0, [192, 73]), event(0, [176, 7, 0]), event(25, [128, 60, 0])], 100);
  const source = parseMidi(smf([supported]));
  assert.deepEqual(source.lanes[0].issues, []);
  assert.deepEqual([source.lanes[0].program, source.lanes[0].volume], [73, 0]);
  const review = buildMidiReview(base(), source, choices());
  assert.equal(review.candidate.tracks[0].volume, 0);
  assert.equal(review.candidate.tracks[0].notes[0].velocity, 64 / 127);
  for (const state of [[192, 1], [176, 7, 64]]) {
    const invalid = parseMidi(smf([timed([event(0, [144, 60, 64]), event(0, state), event(25, [128, 60, 0])], 100)]));
    assert.ok(issues(invalid).includes('changing-state'));
    assert.deepEqual(invalid.lanes[0].notes, []);
  }
});

test('oracle expressions/controllers/percussion are visible unsupported lanes even outside a phrase', () => {
  validSource();
  for (const unsupported of [[176, 64, 0], [176, 0, 0], [176, 120, 0], [176, 10, 64],
    [160, 60, 50], [208, 50], [224, 0, 64]]) {
    const source = parseMidi(smf([timed([event(0, [144, 60, 64]), event(25, [128, 60, 0]),
      event(200, unsupported), event(200, unsupported)], 200)]));
    const expectedIssue = unsupported[0] === 176 ? 'controller' : 'expression';
    assert.equal(issues(source).filter(code => code === expectedIssue).length, 1);
    assert.deepEqual(source.lanes[0].notes, []);
    assert.equal(source.lanes[0].noteOnCount, 1);
    rejects(() => buildMidiReview(base(), source, choices()));
  }
  const percussion = parseMidi(smf([timed([event(0, [153, 60, 100]), event(25, [137, 60, 0])], 100)]));
  assert.ok(issues(percussion, 9).includes('percussion'));
  assert.equal(percussion.lanes[0].id, 'channel-9');
  assert.deepEqual(percussion.lanes[0].notes, []);
  const empty = parseMidi(smf([timed([event(0, [192, 73])], 100)]));
  assert.ok(issues(empty).includes('empty-lane'));
});

test('oracle ambiguous note lifetimes are never repaired while adjacent physical off-before-on is supported', () => {
  validSource();
  for (const rows of [[event(0, [128, 60, 0])], [event(0, [144, 60, 100])],
    [event(0, [144, 60, 100]), event(0, [128, 60, 0])],
    [event(0, [144, 60, 100]), event(25, [144, 60, 80]), event(25, [128, 60, 0]), event(50, [128, 60, 0])]]) {
    const source = parseMidi(smf([timed(rows, 100)]));
    assert.ok(issues(source).includes('ambiguous-notes'));
    assert.deepEqual(source.lanes[0].notes, []);
  }
  const adjacent = parseMidi(smf([timed([event(0, [144, 60, 100]), event(25, [128, 60, 0]),
    event(25, [144, 60, 80]), event(50, [128, 60, 0])], 100)]));
  assert.deepEqual(adjacent.lanes[0].notes, [{ onTick: 0, offTick: 25, pitch: 60, velocity: 100 },
    { onTick: 25, offTick: 50, pitch: 60, velocity: 80 }]);
});

test('oracle track names preserve text/reason precedence and ignored arbitrary text is not silently decoded', () => {
  const cases: [number[][], object][] = [
    [[name('Lead'), name('Lead')], { value: 'Lead', status: 'usable', reason: null }],
    [[name('Lead'), name('Other')], { value: null, status: 'needs-choice', reason: 'multiple-names' }],
    [[meta(3, [255]), name('Other')], { value: null, status: 'needs-choice', reason: 'invalid-utf8' }],
    [[name('\uFEFFLead')], { value: '\uFEFFLead', status: 'needs-choice', reason: 'control' }],
    [[name(' Lead ')], { value: ' Lead ', status: 'needs-choice', reason: 'edge-whitespace' }],
    [[name(' '.repeat(81))], { value: ' '.repeat(81), status: 'needs-choice', reason: 'too-long' }],
    [[name('🎵'.repeat(40))], { value: '🎵'.repeat(40), status: 'usable', reason: null }],
    [[name('🎵'.repeat(41))], { value: '🎵'.repeat(41), status: 'needs-choice', reason: 'too-long' }],
  ];
  for (const [names, expected] of cases) {
    const source = parseMidi(smf([timed([...names.map(bytes => event(0, bytes)),
      event(0, [144, 60, 100]), event(25, [128, 60, 0])], 100)]));
    assert.deepEqual(source.title, expected);
    assert.deepEqual(source.lanes[0].name, expected);
  }
  const source = parseMidi(smf([timed([event(0, meta(1, [255, 254])), event(0, meta(0, [0, 1])),
    event(0, meta(88, [3, 2, 24, 8])), event(0, meta(89, [0, 0]))], 1)]));
  assert.deepEqual(source.ignoredMeta, [{ type: 0, count: 1, bytes: 2 }, { type: 1, count: 1, bytes: 2 },
    { type: 88, count: 1, bytes: 4 }, { type: 89, count: 1, bytes: 2 }]);
});

test('oracle strict SMF header/chunk/EOF and division boundaries are checked before selections', () => {
  validSource();
  const good = basicBytes();
  const corrupt = (offset: number, data: number[]) => { const bytes = good.slice(); bytes.set(data, offset); return bytes; };
  const bad = [new Uint8Array(), new Uint8Array([0, ...good]), new Uint8Array([...good, 0]), good.slice(0, -1),
    corrupt(0, utf8('RIFF')), corrupt(4, [0, 0, 0, 7]), corrupt(8, [0, 2]), corrupt(10, [0, 2]),
    corrupt(12, [0, 0]), corrupt(12, [128, 96]), corrupt(14, utf8('JUNK')), corrupt(18, [255, 255, 255, 255])];
  for (const bytes of bad) rejects(() => parseMidi(bytes));
  assert.equal(parseMidi(smf([timed([], 0)], 1)).ppqn, 1);
  assert.equal(parseMidi(smf([timed([], 0)], 32767)).ppqn, 32767);
  assert.equal(parseMidi(smf([timed([], 0)], 1, 1)).format, 1);
  assert.equal(parseMidi(smf(Array.from({ length: 32 }, () => timed([], 0)))).rawTrackCount, 32);
  rejects(() => parseMidi(smf(Array.from({ length: 33 }, () => timed([], 0)))));
});

test('oracle VLQ/data/running-status/EOT errors apply to every raw track while nonshortest valid VLQ is legal', () => {
  validSource();
  const goodTrack = timed([event(0, [145, 60, 100]), event(25, [129, 60, 0])], 100);
  const invalidTracks = [[128, 128, 128, 128, 0, 255, 47, 0], [128], [0, 60, 100, 0, 255, 47, 0],
    [0, 144, 60, 128, 0, 255, 47, 0], [0, 144, 60], [0, 255, 47, 1, 0],
    [0, 255, 47, 0, 0], [0, 255, 47, 0, 0, 255, 47, 0], [],
    [0, 144, 60, 100, 0, 255, 1, 0, 25, 60, 0, 0, 255, 47, 0],
    [0, 255, 1, 128, 128, 128, 128, 0, 0, 255, 47, 0],
    [0, 255, 1, 3, 65, 0, 255, 47, 0]];
  for (const bad of invalidTracks) rejects(() => parseMidi(smf([goodTrack, bad])));
  for (const status of [241, 242, 243, 244, 245, 246, 248, 249, 250, 251, 252, 253, 254]) {
    rejects(() => parseMidi(smf([[0, status, 0, 255, 47, 0]])));
  }
  rejects(() => parseMidi(smf([goodTrack, [0, 60, 0, 0, 255, 47, 0]]))); // No cross-track running status.
  assert.equal(parseMidi(smf([[128, 0, 255, 47, 0]])).eventCount, 1);
});

test('oracle unsupported global metadata/SysEx rejects even an otherwise selectable good channel', () => {
  validSource();
  const voice = timed([event(0, [144, 60, 100]), event(25, [128, 60, 0])], 100);
  for (const bytes of [[240, 0], [247, 0], meta(32, [0]), meta(33, [0]), meta(84, [0, 0, 0, 0, 0]),
    meta(127, []), meta(10, []), meta(126, [])]) rejects(() => parseMidi(smf([voice, timed([event(0, bytes)], 100)])));
  for (const [type, size] of [[0, 1], [47, 1], [81, 2], [88, 3], [89, 3]]) {
    rejects(() => parseMidi(smf([timed([event(0, meta(type, Array(size).fill(0)))], 100)])));
  }
  assert.equal(parseMidi(smf([timed([event(0, meta(1, Array(4096).fill(65)))], 0)])).ignoredMeta[0].bytes, 4096);
  rejects(() => parseMidi(smf([timed([event(0, meta(1, Array(4097).fill(65)))], 0)])));
});

test('oracle exact accumulated tick bound never wraps and every metadata/EOT event consumes budget', () => {
  validSource();
  const max = 2147483647;
  const clock = Array.from({ length: 8 }, () => [255, 255, 255, 127, 255, 1, 0]).flat();
  const atMax = smf([[...clock, 7, 255, 47, 0]]);
  assert.equal(parseMidi(atMax).lastTick, max);
  rejects(() => parseMidi(smf([[...clock, 8, 255, 47, 0]])));
  const exactEvents = Array.from({ length: 32767 }, () => [0, 255, 1, 0]).flat();
  assert.equal(parseMidi(smf([[...exactEvents, 0, 255, 47, 0]])).eventCount, 32768);
  rejects(() => parseMidi(smf([[...exactEvents, 0, 255, 1, 0, 0, 255, 47, 0]])));
});

test('oracle attack budget counts raw positive attacks even in already unsupported lanes', () => {
  validSource();
  const attacks = Array.from({ length: 8192 }, () => [0, 144, 60, 1]).flat();
  const source = parseMidi(smf([[...attacks, 0, 255, 47, 0]]));
  assert.equal(source.noteOnCount, 8192);
  assert.equal(source.lanes[0].noteOnCount, 8192);
  assert.deepEqual(source.lanes[0].notes, []);
  rejects(() => parseMidi(smf([[...attacks, 0, 144, 60, 1, 0, 255, 47, 0]])));
});

test('oracle PPQN100 off480 phrase imports exact numbers and omits explicitly disclosed trailing rests', () => {
  const source = parseMidi(offGridPhrase());
  const review = buildMidiReview(base(), source, choices(['channel-2'], 2, 6));
  assert.equal(source.lastTick, 800);
  assert.deepEqual([review.sourceNoteOnCount, review.includedNotes, review.excludedNoteOnCount], [5, 2, 3]);
  assert.deepEqual(noteShape(review.candidate), [{ name: 'Chosen channel-2', instrument: 'sine', volume: 64 / 127,
    muted: false, notes: [{ pitch: 69, start: 13 / 100, duration: 1, velocity: 96 / 127 },
      { pitch: 72, start: 213 / 100, duration: 1, velocity: 32 / 127 }] }]);
  assert.equal(review.candidate.tempo, 120);
  assert.deepEqual(review.lanes, [{ laneId: 'channel-2', sourceTracks: [1], channel: 2, sourceName: 'Selected source',
    name: 'Chosen channel-2', instrument: 'sine', sourceProgram: 81, sourceVolume: 64, includedNotes: 2, outsideNotes: 2 }]);
  assert.ok(review.warnings.some(warning => /rest|silence|tail/i.test(warning)));
  assert.ok(review.warnings.length <= 64 && review.warnings.every(warning => warning.length <= 512));
});

test('oracle PPQN997 and difference-before-division preserve fractions rather than quarter/480 quantization', () => {
  const prime = parseMidi(smf([timed([event(1079, [144, 69, 64]), event(1329, [128, 69, 0])], 1994)], 997));
  const review = buildMidiReview(base(), prime, choices(['channel-0'], 1, 2));
  assert.deepEqual(review.candidate.tracks[0].notes.map(({ pitch, start, duration, velocity }) => ({ pitch, start, duration, velocity })),
    [{ pitch: 69, start: 82 / 997, duration: 250 / 997, velocity: 64 / 127 }]);
  assert.equal(review.candidate.tracks[0].volume, 100 / 127);
  // (83/100)-(58/100) is below.25; duration=(83-58)/100 is exactly.25.
  const quarter = parseMidi(smf([timed([event(58, [144, 60, 100]), event(83, [128, 60, 0])], 100)]));
  assert.equal(buildMidiReview(base(), quarter, choices()).candidate.tracks[0].notes[0].duration, 0.25);
});

test('oracle whole-note window classifies touching boundaries as outside/included and rejects crossings atomically', () => {
  const source = parseMidi(smf([timed([event(0, [144, 35, 100]), event(100, [128, 35, 0]),
    event(100, [144, 60, 100]), event(200, [128, 60, 0]),
    event(200, [144, 64, 100]), event(300, [128, 64, 0])], 400)]));
  const input = base();
  const before = structuredClone(input);
  const review = buildMidiReview(input, source, choices(['channel-0'], 1, 2));
  assert.deepEqual([review.includedNotes, review.excludedNoteOnCount, review.lanes[0].outsideNotes], [1, 2, 2]);
  assert.deepEqual(review.candidate.tracks[0].notes.map(note => [note.pitch, note.start, note.duration]), [[60, 0, 1]]);
  const crossesStart = parseMidi(smf([timed([event(50, [144, 60, 100]), event(150, [128, 60, 0])], 200)]));
  const crossesEnd = parseMidi(smf([timed([event(150, [144, 60, 100]), event(250, [128, 60, 0])], 300)]));
  rejects(() => buildMidiReview(input, crossesStart, choices(['channel-0'], 1, 2)));
  rejects(() => buildMidiReview(input, crossesEnd, choices(['channel-0'], 1, 2)));
  assert.deepEqual(input, before);
});

test('oracle destination pitch/duration/window limits reject included incompatibility without hidden filtering', () => {
  validSource();
  for (const [pitch, off] of [[35, 25], [97, 25], [60, 24], [60, 1601]]) {
    const source = parseMidi(smf([timed([event(0, [144, pitch, 100]), event(off, [128, pitch, 0])], 1700)]));
    rejects(() => buildMidiReview(base(), source, choices(['channel-0'], 0, 17)));
  }
  for (const pitch of [36, 96]) {
    const source = parseMidi(smf([timed([event(0, [144, pitch, 127]), event(1600, [128, pitch, 0])], 1600)]));
    assert.equal(buildMidiReview(base(), source, choices(['channel-0'], 0, 16)).candidate.tracks[0].notes[0].duration, 16);
  }
  const source = validSource();
  for (const [startBeat, endBeat] of [[0.5, 1], [0, 1.5], [-1, 1], [0, 0], [0, 2], [0, Infinity], [NaN, 1]]) {
    rejects(() => buildMidiReview(base(), source, choices(['channel-0'], startBeat, endBeat)));
  }
});

test('oracle selection requires explicit unique supported parts/text and sorts destination by channel', () => {
  const source = parseMidi(smf([timed([event(0, name('Raw <name>')),
    event(0, [147, 72, 100]), event(0, [144, 60, 100]), event(25, [131, 72, 0]), event(25, [128, 60, 0])], 100)]));
  const request = choices(['channel-3', 'channel-0']);
  request.lanes[0].instrument = 'sawtooth';
  const review = buildMidiReview(base(), source, request);
  assert.deepEqual(review.lanes.map(lane => lane.channel), [0, 3]);
  assert.deepEqual(review.candidate.tracks.map(track => track.instrument), ['sine', 'sawtooth']);
  for (const request of [choices([]), choices(['channel-0', 'channel-0']), choices(['channel-2'])]) {
    rejects(() => buildMidiReview(base(), source, request));
  }
  for (const field of ['title', 'name'] as const) {
    for (const text of [' Leading', 'Trailing ', '', '🎵'.repeat(41), '\uFEFFName', 'Name\u0000']) {
      const request = choices();
      if (field === 'title') request.title = text;
      else request.lanes[0].name = text;
      rejects(() => buildMidiReview(base(), source, request));
    }
  }
  const eighty = choices();
  eighty.title = '🎵'.repeat(40);
  eighty.lanes[0].name = '🎵'.repeat(40);
  assert.equal(buildMidiReview(base(), source, eighty).candidate.title, eighty.title);
});

function maximumBytes(targetBytes?: number, noteCount = 256): Uint8Array {
  const voices = Array.from({ length: 8 }, (_, channel) => timed(Array.from({ length: noteCount }, (_, index) => [
    event(index * 50, [144 | channel, 60 + channel, 64]), event(index * 50 + 25, [128 | channel, 60 + channel, 0]),
  ]).flat(), Math.max(12800, (noteCount - 1) * 50 + 25)));
  let conductor = timed([event(0, tempo(500000))], 12800);
  if (targetBytes !== undefined) {
    let remaining = targetBytes - smf([conductor, ...voices]).length;
    const padding: number[] = [];
    while (remaining > 0) {
      // The complete metadata event has4 bytes for small payloads,5 for>=128.
      let payload = Math.min(4096, remaining - 5);
      if (payload < 128) payload = remaining - 4;
      let length = 3 + vlq(payload).length + payload;
      if (remaining - length > 0 && remaining - length < 4) {
        payload -= 4 - (remaining - length);
        length = 3 + vlq(payload).length + payload;
      }
      assert.ok(payload >= 0 && payload <= 4096 && length <= remaining);
      padding.push(0, 255, 1, ...vlq(payload), ...Array(payload).fill(65));
      remaining -= length;
    }
    conductor = [...padding, ...conductor];
  }
  return smf([conductor, ...voices]);
}

test('oracle selected8×256 notes and exact1MiB admitted bytes retain every lane/note, while next bounds reject', () => {
  const bytes = maximumBytes(1048576);
  assert.equal(bytes.length, 1048576);
  const source = parseMidi(bytes);
  const request = choices(Array.from({ length: 8 }, (_, channel) => `channel-${channel}`).reverse(), 0, 128);
  const review = buildMidiReview(base(), source, request);
  assert.equal(source.noteOnCount, 2048);
  assert.equal(review.includedNotes, 2048);
  assert.equal(review.excludedNoteOnCount, 0);
  assert.deepEqual(review.candidate.tracks.map(track => track.notes.length), Array(8).fill(256));
  assert.deepEqual(review.lanes.map(lane => lane.channel), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(review.candidate.tracks[7].notes[255].start, 127.5);
  assert.equal(review.candidate.tracks[7].notes[255].duration, 0.25);
  rejects(() => parseMidi(maximumBytes(1048577)));
  const extra = parseMidi(maximumBytes(undefined, 257));
  rejects(() => buildMidiReview(base(), extra, choices(['channel-0'], 0, 129)));
  // 257 whole notes inside the allowed128-beat window, not a window-overflow failure.
  const tooMany = parseMidi(smf([timed(Array.from({ length: 257 }, (_, i) => [event(i * 25, [144, 60, 100]),
    event((i + 1) * 25, [128, 60, 0])]).flat(), 6500)]));
  rejects(() => buildMidiReview(base(), tooMany, choices(['channel-0'], 0, 65)));
});

test('oracle malformed public previews cannot bypass declared sums/pairing/tempo/ordering guarantees', () => {
  const source = validSource();
  const invalid = (mutate: (source: MidiPreview) => void) => {
    const modified = structuredClone(source);
    mutate(modified);
    rejects(() => buildMidiReview(base(), modified, choices()));
  };
  invalid(value => { value.noteOnCount++; });
  invalid(value => { value.lanes[0].noteOnCount++; });
  invalid(value => { value.tempo++; });
  invalid(value => { value.lanes[0].notes[0].offTick = value.lastTick + 1; });
  invalid(value => { value.lanes[0].notes[0].velocity = 0; });
  invalid(value => { value.lanes[0].notes.reverse(); });
  invalid(value => { value.lanes[0].sourceTracks = [0, 0]; });
  invalid(value => { value.lanes[0].id = 'channel-2'; });
  invalid(value => { value.lanes[0].notes[1].pitch = 60; value.lanes[0].notes[1].onTick = 12; });
  invalid(value => { value.lanes[0].issues = [{ code: 'controller', message: 'Unsupported' }]; });
  invalid(value => { value.lanes[0].notes = new Array(2); });
});

test('oracle builder/parse detachment leaves bytes/base/choices unchanged and creates fresh globally unique IDs', () => {
  const bytes = basicBytes();
  const beforeBytes = bytes.slice();
  const source = parseMidi(bytes);
  const input = base();
  const request = choices();
  const before = structuredClone({ source, input, request });
  const review = buildMidiReview(input, source, request);
  assert.deepEqual({ source, input, request }, before);
  assert.deepEqual(bytes, beforeBytes);
  bytes.fill(0);
  assert.deepEqual(source, before.source);
  source.lanes[0].notes[0].pitch = 96;
  request.lanes[0].name = 'Changed choice';
  input.title = 'Changed input';
  assert.equal(review.base.title, before.input.title);
  assert.equal(review.choices.lanes[0].name, before.request.lanes[0].name);
  assert.equal(review.candidate.tracks[0].notes[0].pitch, 60);
  const ids = review.candidate.tracks.flatMap(track => [track.id, ...track.notes.map(note => note.id)]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => !['old-note', before.input.tracks[0].id].includes(id)));
  const applied = applyMidiImport(before.input, review);
  assert.deepEqual(applied, review.candidate);
  assert.notEqual(applied, review.candidate);
  applied.tracks[0].notes[0].pitch = 36;
  assert.equal(review.candidate.tracks[0].notes[0].pitch, 60);
});

test('oracle private receipt rejects clone/forgery/joint mutation/extra property and stale committed bases', () => {
  const source = validSource();
  const input = base();
  const fresh = () => buildMidiReview(input, source, choices());
  const legitimate = fresh();
  rejects(() => applyMidiImport(input, structuredClone(legitimate)));
  rejects(() => applyMidiImport(input, { ...legitimate }));
  for (const mutate of [
    (review: MidiImportReview) => { review.candidate.title = 'Changed'; review.choices.title = 'Changed'; },
    (review: MidiImportReview) => { review.candidate.tracks[0].notes[0].pitch++; },
    (review: MidiImportReview) => { review.includedNotes++; },
    (review: MidiImportReview) => { review.warnings.push('Added limitation'); },
    (review: MidiImportReview) => { Object.assign(review, { extra: 1 }); },
    (review: MidiImportReview) => { review.candidate.tracks[0].notes = new Array(100000); },
  ]) {
    const review = fresh();
    mutate(review);
    rejects(() => applyMidiImport(input, review));
  }
  const changed = structuredClone(input);
  changed.tracks[0].notes[0].pitch++;
  rejects(() => applyMidiImport(changed, legitimate), 'stale-review');
  assert.deepEqual(applyMidiImport(structuredClone(input), legitimate), legitimate.candidate);
});

test('oracle ID collision failure is bounded and leaves the committed composition unchanged', t => {
  const source = validSource();
  const input = base();
  const before = structuredClone(input);
  const stub = t.mock.method(crypto, 'randomUUID', () => '00000000-0000-4000-8000-000000000001');
  rejects(() => buildMidiReview(input, source, choices()));
  assert.ok(stub.mock.callCount() > 0 && stub.mock.callCount() <= 32);
  assert.deepEqual(input, before);
});
