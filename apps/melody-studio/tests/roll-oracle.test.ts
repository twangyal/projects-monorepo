// Independent #99 scalar expectations, frozen before reading the roll kernel.
// Values are literal musical edits; reference PCM is original test-only data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeRollEdit } from '../src/roll-edit.ts';
import type { RollEdit, RollSnap } from '../src/roll-edit.ts';
import type { Composition, Note } from '../src/types.ts';
import { ReferenceHistory, withComposition } from '../src/reference-project.ts';
import type { ReferenceBundle } from '../src/reference-types.ts';

function composition(): Composition {
  return { version: 1, title: 'Literal off-grid phrase', tempo: 108, tracks: [
    { id: 'lead', name: 'Lead', instrument: 'triangle', volume: .7, muted: false,
      notes: [{ id: 'fractional', pitch: 60, start: 1.03125, duration: .8125, velocity: .63 },
        { id: 'untouched', pitch: 67, start: 3.375, duration: 1.125, velocity: .9 }] },
    { id: 'bass', name: 'Bass', instrument: 'sine', volume: .4, muted: true,
      notes: [{ id: 'bass-note', pitch: 48, start: .0625, duration: 2, velocity: .5 }] },
  ] };
}
function noteAt(value: Composition, id = 'fractional'): Note {
  const note = value.tracks[0].notes.find(item => item.id === id);
  assert.ok(note); return note;
}
const move = (deltaBeats: number, deltaPitch = 0, snap: RollSnap = 0): RollEdit =>
  ({ kind: 'move', noteId: 'fractional', deltaBeats, deltaPitch, snap });
const resize = (deltaBeats: number, snap: RollSnap = 0): RollEdit =>
  ({ kind: 'resize', noteId: 'fractional', deltaBeats, snap });
function referenceBundle(): ReferenceBundle {
  return { document: { schemaVersion: 1, composition: composition(), references: [
    { trackId: 'lead', assetId: '00000000-0000-4000-8000-000000000099' }] },
  assets: [{ id: '00000000-0000-4000-8000-000000000099', kind: 'audio-file', captureTempo: 108,
    decodedSampleRate: 22050, decodedChannels: 1, decodedFrames: 8, analyzedFrames: 8,
    frameCount: 8, pcm: new Uint8Array([0, 0, 255, 127, 0, 128, 1, 0, 255, 255, 52, 18, 204, 237, 0, 0]) }] };
}

test('independent move oracle: off-grid delta preserves represented timing, duration and velocity', () => {
  const input = composition(), before = structuredClone(input);
  const next = proposeRollEdit(input, 'lead', move(.1, 3));
  assert.deepEqual(noteAt(next), { id: 'fractional', pitch: 63, start: 1.13125, duration: .8125, velocity: .63 });
  assert.deepEqual(next.tracks[0].notes[1], input.tracks[0].notes[1]);
  assert.deepEqual(next.tracks[1], input.tracks[1]);
  assert.equal(next.tempo, 108); assert.deepEqual(input, before);
  next.tracks[1].notes[0].pitch = 50; assert.equal(input.tracks[1].notes[0].pitch, 48);
});

test('independent signed snapping oracle: move snaps delta, positive and negative half-grid ties go away from zero', () => {
  const rows: [RollSnap, number, number][] = [
    [.25, .125, 1.28125], [.25, -.125, .78125],
    [.125, .0625, 1.15625], [.125, -.0625, .90625],
    [.25, .124, 1.03125], [.25, -.124, 1.03125],
    [.25, .375, 1.53125], [.25, -.375, .53125],
  ];
  for (const [snap, delta, expected] of rows) {
    const next = proposeRollEdit(composition(), 'lead', move(delta, 0, snap));
    assert.equal(noteAt(next).start, expected); assert.equal(noteAt(next).duration, .8125);
  }
});

test('independent resize oracle: delta snapping preserves original fractional onset and changes only duration', () => {
  for (const [delta, snap, duration] of [[.125, .25, 1.0625], [-.125, .25, .5625],
    [.0625, .125, .9375], [-.0625, .125, .6875], [.03125, 0, .84375]] as const) {
    const input = composition(), next = proposeRollEdit(input, 'lead', resize(delta, snap));
    assert.deepEqual(noteAt(next), { ...input.tracks[0].notes[0], duration });
    assert.deepEqual(next.tracks[0].notes[1], input.tracks[0].notes[1]);
  }
});

test('independent add oracle: absolute onset and duration snap separately, original notes stay exact', () => {
  const input = composition();
  const next = proposeRollEdit(input, 'lead', { kind: 'add', id: 'new', pitch: 72,
    start: 1.03125, duration: .8125, velocity: .4, snap: .25 });
  assert.deepEqual(noteAt(next, 'new'), { id: 'new', pitch: 72, start: 1, duration: .75, velocity: .4 });
  assert.deepEqual(noteAt(next), input.tracks[0].notes[0]);
  const tie = proposeRollEdit(input, 'lead', { kind: 'add', id: 'tie', pitch: 61,
    start: 1.125, duration: .375, velocity: 0, snap: .25 });
  assert.deepEqual(noteAt(tie, 'tie'), { id: 'tie', pitch: 61, start: 1.25, duration: .5, velocity: 0 });
  const off = proposeRollEdit(input, 'lead', { kind: 'add', id: 'off', pitch: 62,
    start: .03125, duration: .28125, velocity: 1, snap: 0 });
  assert.deepEqual(noteAt(off, 'off'), { id: 'off', pitch: 62, start: .03125, duration: .28125, velocity: 1 });
});

test('independent zero/no-op oracle: exact zero and snapped sub-grid deltas do not accumulate drift', () => {
  const input = composition();
  for (const edit of [move(0), move(-0), move(.01, 0, .25), move(-.01, 0, .125), resize(0), resize(-0), resize(.01, .25)]) {
    const next = proposeRollEdit(input, 'lead', edit); assert.deepEqual(next, input);
    assert.notEqual(next, input); assert.notEqual(next.tracks[0].notes[0], input.tracks[0].notes[0]);
  }
});

test('independent exact bound oracle: edge pitch and beat128 are admitted without altering neighbours', () => {
  const input = composition(); Object.assign(input.tracks[0].notes[0], { pitch: 37, start: 127.5, duration: .25 });
  const low = proposeRollEdit(input, 'lead', move(.25, -1));
  assert.deepEqual(noteAt(low), { id: 'fractional', pitch: 36, start: 127.75, duration: .25, velocity: .63 });
  const upper = proposeRollEdit(input, 'lead', move(0, 59)); assert.equal(noteAt(upper).pitch, 96);
  const length = composition(); Object.assign(length.tracks[0].notes[0], { start: 112, duration: 15.75 });
  assert.equal(noteAt(proposeRollEdit(length, 'lead', resize(.25))).duration, 16);
  const shortest = composition(); Object.assign(shortest.tracks[0].notes[0], { start: 0, duration: .5 });
  assert.equal(noteAt(proposeRollEdit(shortest, 'lead', resize(-.25))).duration, .25);
});

test('independent refusal oracle: crossing bounds rejects rather than clamping, with complete input unchanged', () => {
  const input = composition(); Object.assign(input.tracks[0].notes[0], { pitch: 36, start: 0, duration: .25 });
  const before = structuredClone(input);
  for (const edit of [move(-.125, 0, .25), move(0, -1), move(0, 61), resize(-.125, .25), resize(16)]) {
    assert.throws(() => proposeRollEdit(input, 'lead', edit)); assert.deepEqual(input, before);
  }
  const end = composition(); Object.assign(end.tracks[0].notes[0], { start: 127.75, duration: .25 });
  assert.throws(() => proposeRollEdit(end, 'lead', move(.0000000000001)));
  const wide = composition(); Object.assign(wide.tracks[0].notes[0], { start: 0, duration: 16 });
  assert.throws(() => proposeRollEdit(wide, 'lead', resize(.000000000000004)));
});

test('independent quota oracle: note256 succeeds,257 refuses and all eight tracks remain detached', () => {
  const input = composition(); input.tracks = Array.from({ length: 8 }, (_, i) => ({
    id: `track-${i}`, name: `Track ${i}`, instrument: 'sine', volume: .8, muted: false,
    notes: Array.from({ length: i === 0 ? 255 : 256 }, (_, j) => ({ id: `${i}-${j}`, pitch: 60,
      start: j / 4, duration: .25, velocity: .8 })) }));
  const edit: RollEdit = { kind: 'add', id: 'last', pitch: 96, start: 127.75, duration: .25, velocity: 1, snap: 0 };
  const next = proposeRollEdit(input, 'track-0', edit); assert.equal(next.tracks[0].notes.length, 256);
  assert.equal(input.tracks[0].notes.length, 255); assert.deepEqual(next.tracks.slice(1), input.tracks.slice(1));
  const before = structuredClone(next);
  assert.throws(() => proposeRollEdit(next, 'track-0', { ...edit, id: 'over' })); assert.deepEqual(next, before);
});

test('independent full-candidate oracle: invalid unrelated notes/track also refuse atomically', () => {
  for (const corrupt of [(value: Composition) => { value.tracks[1].notes[0].duration = 17; },
    (value: Composition) => { value.tracks[1].volume = 2; },
    (value: Composition) => { value.tracks[0].notes[1].pitch = 97; }]) {
    const input = composition(); corrupt(input); const before = structuredClone(input);
    assert.throws(() => proposeRollEdit(input, 'lead', move(.25))); assert.deepEqual(input, before);
  }
});

test('independent malformed operation oracle: nonfinite, fractional pitch, unknown snap and missing IDs refuse', () => {
  const input = composition(), before = structuredClone(input);
  const edits = [move(NaN), move(Infinity), resize(-Infinity), move(0, .5),
    { ...move(.25), snap: .5 }, { ...move(.25), noteId: 'missing' },
    { kind: 'add', id: 'fractional', pitch: 60, start: 0, duration: 1, velocity: .8, snap: 0 },
    { kind: 'add', id: 'bad', pitch: 60.5, start: 0, duration: 1, velocity: .8, snap: 0 },
    { kind: 'add', id: 'bad', pitch: 60, start: NaN, duration: 1, velocity: .8, snap: 0 },
    { kind: 'add', id: 'bad', pitch: 60, start: 0, duration: .1, velocity: 2, snap: 0 }];
  for (const edit of edits) { assert.throws(() => proposeRollEdit(input, 'lead', edit as RollEdit)); assert.deepEqual(input, before); }
  assert.throws(() => proposeRollEdit(input, 'missing', move(.25)));
});

test('independent reference/history oracle: one edit Undo/Redo preserves exact PCM, binding and capture tempo', () => {
  const bundle = referenceBundle(), original = structuredClone(bundle), history = new ReferenceHistory(bundle);
  const next = proposeRollEdit(history.current.composition, 'lead', move(.125, 2, .25));
  assert.equal(history.commit(withComposition(history.current, next)), true);
  assert.equal(history.canUndo, true); assert.equal(history.current.composition.tracks[0].notes[0].start, 1.28125);
  assert.deepEqual(history.snapshot().assets, original.assets); assert.deepEqual(history.current.references, original.document.references);
  history.undo(); assert.deepEqual(history.snapshot(), original);
  history.redo(); assert.deepEqual(history.current.composition, next); assert.deepEqual(history.snapshot().assets, original.assets);
  assert.deepEqual(bundle, original);
});

test('independent redo oracle: no-op and rejected candidate retain redo and reference bytes exactly', () => {
  const history = new ReferenceHistory(referenceBundle());
  const next = proposeRollEdit(history.current.composition, 'lead', resize(.125, .25));
  history.commit(withComposition(history.current, next)); history.undo();
  const before = history.snapshot();
  const unchanged = proposeRollEdit(history.current.composition, 'lead', move(.01, 0, .25));
  assert.equal(history.commit(withComposition(history.current, unchanged)), false); assert.equal(history.canRedo, true);
  assert.throws(() => proposeRollEdit(history.current.composition, 'lead', move(-2)));
  assert.deepEqual(history.snapshot(), before); assert.equal(history.canRedo, true);
  history.redo(); assert.deepEqual(history.current.composition, next); assert.deepEqual(history.snapshot().assets, before.assets);
});
