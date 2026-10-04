import assert from 'node:assert/strict';
import test from 'node:test';
import { MIDI_IMPORT_LIMITS, MidiImportError, parseMidi } from '../src/midi-import.ts';

const u16 = (n: number) => [Math.floor(n / 256), n % 256];
const u32 = (n: number) => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256];
function vlq(n: number): number[] {
  const out = [n % 128];
  while ((n = Math.floor(n / 128))) out.unshift(n % 128 + 128);
  return out;
}
const event = (delta: number, ...bytes: number[]) => [...vlq(delta), ...bytes];
const meta = (delta: number, type: number, data: number[]) => event(delta, 255, type, ...vlq(data.length), ...data);
const end = (delta = 0) => meta(delta, 47, []);
const name = (value: string) => meta(0, 3, [...new TextEncoder().encode(value)]);
const tempo = (delta: number, value: number) => meta(delta, 81, u32(value).slice(1));
function smf(tracks: number[][], ppqn = 480, format = tracks.length === 1 ? 0 : 1): Uint8Array {
  const bytes = [77, 84, 104, 100, ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(ppqn)];
  for (const track of tracks) {
    bytes.push(77, 84, 114, 107, ...u32(track.length));
    for (const byte of track) bytes.push(byte);
  }
  return new Uint8Array(bytes);
}
const pair = (channel = 0, pitch = 60, length = 480) => [
  ...event(0, 144 + channel, pitch, 64), ...event(length, 128 + channel, pitch, 0), ...end(),
];
function rejects(bytes: Uint8Array, code = 'invalid-midi') {
  assert.throws(() => parseMidi(bytes), error => error instanceof MidiImportError && error.code === code);
}

test('format0 preserves tick pairs, initial physical state, raw names and exact velocity', () => {
  const source = smf([[...name('<歌>'), ...event(0, 192, 73), ...event(0, 176, 7, 0), ...pair()]], 997);
  const before = source.slice();
  const result = parseMidi(source);
  assert.equal(result.format, 0);
  assert.equal(result.ppqn, 997);
  assert.equal(result.tempo, 120);
  assert.equal(result.tempoExplicit, false);
  assert.equal(result.eventCount, 6);
  assert.equal(result.noteOnCount, 1);
  assert.deepEqual(result.title, { value: '<歌>', status: 'usable', reason: null });
  assert.deepEqual(result.lanes[0], {
    id: 'channel-0', channel: 0, sourceTracks: [0], name: result.title, noteOnCount: 1,
    notes: [{ onTick: 0, offTick: 480, pitch: 60, velocity: 64 }], program: 73,
    programExplicit: true, volume: 0, volumeExplicit: true, issues: [],
  });
  assert.deepEqual(result.ignoredMeta, [{ type: 3, count: 1, bytes: 5 }]);
  assert.deepEqual(source, before);
  result.lanes[0].notes[0].pitch = 80;
  assert.equal(parseMidi(source).lanes[0].notes[0].pitch, 60);
});

test('format1 constant tempo uses global minimum tick regardless track read order', () => {
  const result = parseMidi(smf([[...tempo(10, 600000), ...end()], [...tempo(0, 600000), ...pair(2)]]));
  assert.equal(result.tempo, 100);
  assert.equal(result.tempoExplicit, true);
  assert.equal(result.lastTick, 480);
  assert.deepEqual(result.lanes[0].sourceTracks, [1]);
  assert.equal(parseMidi(smf([[...tempo(0, 500001), ...pair()]])).tempo, 60_000_000 / 500001);
  assert.equal(parseMidi(smf([[...tempo(20, 500000), ...end()]])).tempo, 120);
});

test('tempo zero, nondefault late first, conflicting values and out-of-model BPM reject globally', () => {
  for (const tracks of [
    [[...tempo(0, 0), ...end()]], [[...tempo(1, 600000), ...end()]],
    [[...tempo(0, 500000), ...end()], [...tempo(0, 600000), ...end()]],
    [[...tempo(0, 249999), ...end()]], [[...tempo(0, 1500001), ...end()]],
  ]) rejects(smf(tracks), 'unsupported-midi');
});

test('running status remains track-local, permits non-shortest VLQ and clears on metadata', () => {
  const result = parseMidi(smf([[...event(0, 144, 64, 100), 128, 0, 60, 80,
    ...event(240, 64, 0), ...event(0, 60, 0), ...end()]]));
  assert.deepEqual(result.lanes[0].notes.map(n => n.pitch), [60, 64]);
  rejects(smf([[...event(0, 144, 60, 80), ...meta(0, 1, []), ...event(480, 60, 0), ...end()]]));
  rejects(smf([[...pair()], [...event(0, 60, 80), ...end()]]));
});

test('positive attack and nonzero release counts include unsupported and shared channels', () => {
  const result = parseMidi(smf([[...event(0, 192, 73), ...end()], [...pair()],
    [...event(0, 153, 36, 100), ...event(480, 137, 36, 20), ...end()]]));
  assert.equal(result.noteOnCount, 2);
  assert.equal(result.ignoredReleaseVelocityCount, 1);
  assert.deepEqual(result.lanes[0].sourceTracks, [0, 1]);
  assert.equal(result.lanes[0].issues[0].code, 'shared-channel');
  assert.deepEqual(result.lanes[0].notes, []);
  assert.equal(result.lanes[0].program, 0);
  assert.equal(result.lanes[0].programExplicit, false);
  assert.equal(result.lanes[0].volume, 100);
  assert.equal(result.lanes[1].issues[0].code, 'percussion');
  assert.deepEqual(result.lanes[1].notes, []);
});

test('polyphony, touching repeated pitch, velocity-zero off and onset ordering are precise', () => {
  const result = parseMidi(smf([[...event(0, 144, 64, 100), ...event(0, 144, 60, 80),
    ...event(480, 144, 60, 0), ...event(0, 144, 60, 50), ...event(0, 128, 64, 2),
    ...event(480, 128, 60, 0), ...end()]]));
  assert.deepEqual(result.lanes[0].notes, [
    { onTick: 0, offTick: 480, pitch: 60, velocity: 80 },
    { onTick: 0, offTick: 480, pitch: 64, velocity: 100 },
    { onTick: 480, offTick: 960, pitch: 60, velocity: 50 },
  ]);
  assert.equal(result.ignoredReleaseVelocityCount, 1);
});

test('ambiguous duplicate, orphan, zero-length and hanging notes never fabricate pairs', () => {
  const cases = [
    [...event(0, 144, 60, 80), ...event(1, 144, 60, 90), ...event(480, 128, 60, 0)],
    event(0, 128, 60, 0), [...event(0, 144, 60, 80), ...event(0, 128, 60, 0)],
    event(0, 144, 60, 80),
  ];
  for (const bytes of cases) {
    const lane = parseMidi(smf([[...bytes, ...end()]])).lanes[0];
    assert.ok(lane.issues.some(issue => issue.code === 'ambiguous-notes'));
    assert.deepEqual(lane.notes, []);
  }
});

test('initial state defaults are frozen at first attack, repeated equal later state is harmless', () => {
  const valid = parseMidi(smf([[...event(0, 192, 2), ...event(0, 192, 73),
    ...event(0, 176, 7, 60), ...event(0, 144, 60, 80), ...event(1, 192, 73),
    ...event(0, 176, 7, 60), ...event(479, 128, 60, 0), ...end()]]));
  assert.equal(valid.lanes[0].program, 73);
  assert.equal(valid.lanes[0].volume, 60);
  assert.deepEqual(valid.lanes[0].issues, []);
  const repeatedDefault = parseMidi(smf([[...event(0, 144, 60, 80), ...event(0, 192, 0),
    ...event(0, 176, 7, 100), ...event(480, 128, 60, 0), ...end()]]));
  assert.equal(repeatedDefault.lanes[0].programExplicit, false);
  assert.equal(repeatedDefault.lanes[0].volumeExplicit, false);
  for (const state of [[192, 1], [176, 7, 0]]) {
    const lane = parseMidi(smf([[...event(0, 144, 60, 80), ...event(0, ...state), ...event(480, 128, 60, 0), ...end()]])).lanes[0];
    assert.ok(lane.issues.some(issue => issue.code === 'changing-state'));
    assert.deepEqual(lane.notes, []);
  }
});

test('unsupported controllers and expressions expose bounded unique reasons without hiding attacks', () => {
  for (const bytes of [[176, 64, 127], [176, 0, 1], [160, 60, 3], [208, 3], [224, 0, 64]]) {
    const result = parseMidi(smf([[...event(0, ...bytes), ...event(0, ...bytes), ...pair()]]));
    assert.equal(result.lanes[0].noteOnCount, 1);
    assert.deepEqual(result.lanes[0].notes, []);
    assert.equal(result.lanes[0].issues.filter(i => i.code === (bytes[0] === 176 ? 'controller' : 'expression')).length, 1);
  }
  const lane = parseMidi(smf([[...event(0, 192, 73), ...end()]])).lanes[0];
  assert.ok(lane.issues.some(i => i.code === 'empty-lane'));
});

test('name policy preserves literal invalid choices and never decodes omitted text', () => {
  for (const [value, reason] of [[' padded ', 'edge-whitespace'], [' ', 'edge-whitespace'],
    ['a\0b', 'control'], ['a\u0085b', 'control'], ['\ufefftitle', 'control'],
    ['🎵'.repeat(41), 'too-long']] as const) {
    const result = parseMidi(smf([[...name(value), ...pair()]]));
    assert.deepEqual(result.title, { value, status: 'needs-choice', reason });
  }
  assert.equal(parseMidi(smf([[...name('🎵'.repeat(40)), ...pair()]])).title.status, 'usable');
  assert.equal(parseMidi(smf([[...name('same'), ...name('same'), ...pair()]])).title.status, 'usable');
  assert.deepEqual(parseMidi(smf([[...name('a'), ...name('b'), ...pair()]])).title,
    { value: null, status: 'needs-choice', reason: 'multiple-names' });
  assert.deepEqual(parseMidi(smf([[...name('a'), ...name('b'), ...meta(0, 3, [255]), ...pair()]])).title,
    { value: null, status: 'needs-choice', reason: 'invalid-utf8' });
  assert.equal(parseMidi(smf([[...meta(0, 1, [255, 0]), ...pair()]])).ignoredMeta[0].bytes, 2);
});

test('whitelisted ignored metadata has exact type/count/byte totals', () => {
  const result = parseMidi(smf([[...meta(0, 0, [0, 2]), ...meta(0, 1, [65]), ...meta(0, 1, [66, 67]),
    ...meta(0, 88, [4, 2, 24, 8]), ...meta(0, 89, [0, 0]), ...end(10)]]));
  assert.deepEqual(result.ignoredMeta, [{ type: 0, count: 1, bytes: 2 }, { type: 1, count: 2, bytes: 3 },
    { type: 88, count: 1, bytes: 4 }, { type: 89, count: 1, bytes: 2 }]);
  assert.equal(result.eventCount, 6);
  assert.equal(result.lastTick, 10);
});

test('unsupported global events fail even on an otherwise unused raw track', () => {
  for (const type of [32, 33, 84, 127, 10]) rejects(smf([pair(), [...meta(0, type, []), ...end()]]), 'unsupported-midi');
  for (const status of [240, 247]) rejects(smf([pair(), [...event(0, status, 0), ...end()]]), 'unsupported-midi');
});

test('header/track/EOT/exactEOF, status, VLQ and fixed metadata shapes reject malformed bytes', () => {
  const good = smf([pair()]);
  for (const bytes of [good.slice(1), good.slice(0, -1), new Uint8Array([...good, 0]),
    smf([pair()], 0), smf([pair()], 0x8001), smf([pair()], 480, 2), smf([pair(), pair(1)], 480, 0),
    smf([[...pair().slice(0, -4)]]), smf([[...meta(0, 47, [0])]]), smf([[...end(), 0]]),
    smf([[0, 144, 128, 64, ...end()]]), smf([[0, 241, 0, ...end()]]),
    smf([[128, 128, 128, 128, 0, ...end()]]), smf([[0, 255, 1, 128]]),
    ...[0, 47, 81, 88, 89].map(type => smf([[...meta(0, type, [0]), ...end()]])),
  ]) rejects(bytes, bytes === good ? 'unsupported-midi' : 'invalid-midi');
});

test('typed subarray respects exact offsets, does not retain or mutate source', () => {
  const fixture = smf([pair()]);
  const container = new Uint8Array(fixture.length + 14).fill(255);
  container.set(fixture, 7);
  const view = container.subarray(7, 7 + fixture.length);
  const result = parseMidi(view);
  container.fill(0);
  assert.equal(result.lanes[0].notes[0].offTick, 480);
  assert.equal(result.ppqn, 480);
});

test('track, bytes, event, attack and text budgets enforce exact boundaries', () => {
  assert.equal(parseMidi(smf(Array.from({ length: 32 }, () => end()))).rawTrackCount, 32);
  rejects(smf(Array.from({ length: 33 }, () => end())), 'limit');
  rejects(new Uint8Array(MIDI_IMPORT_LIMITS.bytes + 1), 'limit');
  assert.equal(parseMidi(smf([[...meta(0, 3, Array(4096).fill(65)), ...end()]])).title.reason, 'too-long');
  rejects(smf([[...meta(0, 3, Array(4097).fill(65)), ...end()]]), 'limit');
  const events = Array.from({ length: 32767 }, () => meta(0, 1, [])).flat();
  assert.equal(parseMidi(smf([[...events, ...end()]])).eventCount, 32768);
  rejects(smf([[...events, ...meta(0, 1, []), ...end()]]), 'limit');
  const attacks = Array.from({ length: 8192 }, () => event(0, 153, 60, 80)).flat();
  assert.equal(parseMidi(smf([[...attacks, ...end()]])).noteOnCount, 8192);
  rejects(smf([[...attacks, ...event(0, 153, 60, 80), ...end()]]), 'limit');
});

test('tick accumulation accepts maxTick and rejects overflow before wrap', () => {
  const deltas = Array.from({ length: 8 }, () => meta(0x0fffffff, 1, [])).flat();
  assert.equal(parseMidi(smf([[...deltas, ...end(7)]])).lastTick, 2147483647);
  rejects(smf([[...deltas, ...end(8)]]), 'limit');
});

test('all sixteen lanes sort by channel and aggregate every completed attack', () => {
  const bytes: number[] = [];
  for (let channel = 15; channel >= 0; channel--) bytes.push(...pair(channel).slice(0, -4));
  const result = parseMidi(smf([[...bytes, ...end()]]));
  assert.deepEqual(result.lanes.map(lane => lane.channel), Array.from({ length: 16 }, (_, i) => i));
  assert.equal(result.noteOnCount, 16);
  assert.equal(result.lanes.reduce((sum, lane) => sum + lane.noteOnCount, 0), 16);
  assert.equal(result.lanes.filter(lane => !lane.issues.length).length, 15);
});

test('all 8192 completed pairs fit the parser budget without destination truncation', () => {
  const pairs: number[] = [];
  for (let i = 0; i < 8192; i++) pairs.push(...event(0, 144, 60, 80), ...event(1, 128, 60, 0));
  const result = parseMidi(smf([[...pairs, ...end()]]));
  assert.equal(result.noteOnCount, 8192);
  assert.equal(result.lanes[0].notes.length, 8192);
  assert.equal(result.lanes[0].notes.at(-1)?.offTick, 8192);
});

test('exactly one MiB is admitted and untrusted chunk lengths allocate no payload arrays', () => {
  const data: number[] = [];
  const target = MIDI_IMPORT_LIMITS.bytes - 26;
  while (target - data.length > 4101) data.push(...meta(0, 1, Array(4096).fill(65)));
  const left = target - data.length;
  data.push(...meta(0, 1, Array(left - 5).fill(65)));
  const bytes = smf([[...data, ...end()]]);
  assert.equal(bytes.byteLength, MIDI_IMPORT_LIMITS.bytes);
  assert.equal(parseMidi(bytes).ignoredMeta[0].bytes, target - 256 * 5);
  const malformed = smf([end()]);
  malformed.set([255, 255, 255, 255], 18);
  rejects(malformed);
});

test('every whitelisted text type is counted without permitting unknown global events', () => {
  const track: number[] = [];
  for (let type = 1; type <= 9; type++) track.push(...meta(0, type, [65]));
  const result = parseMidi(smf([[...track, ...end()]]));
  assert.deepEqual(result.ignoredMeta.map(item => item.type), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(result.title, { value: 'A', status: 'usable', reason: null });
  const malformed = smf([[...meta(0, 3, [237, 160, 128]), ...end()]]);
  assert.equal(parseMidi(malformed).title.reason, 'invalid-utf8');
});

test('unselected raw-track structural errors still fail and every truncation is bounded', () => {
  const source = smf([pair(), [...name('Other'), ...pair(1)]]);
  for (let size = 0; size < source.length; size++) rejects(source.slice(0, size));
  const extended = source.slice();
  extended[7] = 7;
  rejects(extended);
  const unknownChunk = source.slice();
  unknownChunk[14] = 88;
  rejects(unknownChunk);
  for (const status of [128, 144, 160, 176, 192, 208, 224]) {
    rejects(smf([pair(), [...event(0, status, 128, 0), ...end()]]));
  }
});
