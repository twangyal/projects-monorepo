import assert from 'node:assert/strict';
import test from 'node:test';
import type { Composition } from '../src/types.ts';
import { proposeRollEdit, type RollEdit, type RollSnap } from '../src/roll-edit.ts';

function fixture(): Composition {
  return { version: 1, title: 'Original phrase', tempo: 108, tracks: [
    { id: 't1', name: 'Melody', instrument: 'triangle', volume: .7, muted: false, notes: [
      { id: 'later', pitch: 67, start: 8.17, duration: .31, velocity: .4 },
      { id: 'edit', pitch: 60, start: 2.13, duration: 1.37, velocity: .8 },
    ] },
    { id: 't2', name: 'Other', instrument: 'sine', volume: .5, muted: true, notes: [
      { id: 'other', pitch: 48, start: .07, duration: 2.41, velocity: .6 },
    ] },
  ] };
}
function edit(deltaBeats: number, snap: RollSnap, deltaPitch = 0): RollEdit {
  return { kind: 'move', noteId: 'edit', deltaBeats, deltaPitch, snap };
}
function fails(input: Composition, trackId: string, action: RollEdit) {
  const before = JSON.stringify(input);
  assert.throws(() => proposeRollEdit(input, trackId, action));
  assert.equal(JSON.stringify(input), before);
}

test('move snaps signed DELTA with ties away from zero and preserves off-grid duration/velocity', () => {
  const input = fixture(), original = input.tracks[0].notes[1];
  for (const [delta, snap, expected] of [[.125, .25, .25], [-.125, .25, -.25], [.0625, .125, .125], [-.0625, .125, -.125], [.124, .25, 0], [-.124, .25, 0], [.137, 0, .137]] as const) {
    const result = proposeRollEdit(input, 't1', edit(delta, snap, 3)), changed = result.tracks[0].notes[1];
    assert.equal(changed.start, original.start + expected);
    assert.equal(changed.pitch, 63); assert.equal(changed.duration, 1.37); assert.equal(changed.velocity, .8); assert.equal(changed.id, 'edit');
    assert.deepEqual(result.tracks[0].notes[0], input.tracks[0].notes[0]);
    assert.deepEqual(result.tracks[1], input.tracks[1]);
  }
});

test('resize snaps signed DELTA, retains exact original start/pitch/velocity and does not snap absolute duration', () => {
  const input = fixture();
  for (const [delta, snap, expected] of [[.125, .25, .25], [-.125, .25, -.25], [.0625, .125, .125], [-.0625, .125, -.125], [.013, 0, .013]] as const) {
    const changed = proposeRollEdit(input, 't1', { kind: 'resize', noteId: 'edit', deltaBeats: delta, snap }).tracks[0].notes[1];
    assert.deepEqual(changed, { ...input.tracks[0].notes[1], duration: 1.37 + expected });
  }
});

test('zero and snapped-zero edits preserve original number representation including negative-zero start', () => {
  const input = fixture();input.tracks[0].notes[1].start = -0;
  for (const delta of [0, -0, .001, -.001]) {
    const result = proposeRollEdit(input, 't1', edit(delta, .25));
    assert.ok(Object.is(result.tracks[0].notes[1].start, -0));
    assert.equal(result.tracks[0].notes[1].duration, 1.37);
  }
  assert.ok(Object.is(proposeRollEdit(input, 't1', edit(-0, 0)).tracks[0].notes[1].start, -0));
  assert.deepEqual(proposeRollEdit(input, 't1', { kind: 'resize', noteId: 'edit', deltaBeats: 0, snap: 0 }), input);
});

test('add snaps absolute start and duration and appends without sorting existing notes', () => {
  const input = fixture();
  const result = proposeRollEdit(input, 't1', { kind: 'add', id: 'new', pitch: 72, start: 1.125, duration: .375, velocity: .3, snap: .25 });
  assert.deepEqual(result.tracks[0].notes.map(note => note.id), ['later', 'edit', 'new']);
  assert.deepEqual(result.tracks[0].notes[2], { id: 'new', pitch: 72, start: 1.25, duration: .5, velocity: .3 });
  const exact = proposeRollEdit(input, 't1', { kind: 'add', id: 'fraction', pitch: 36, start: .13, duration: .333, velocity: 0, snap: 0 });
  assert.deepEqual(exact.tracks[0].notes[2], { id: 'fraction', pitch: 36, start: .13, duration: .333, velocity: 0 });
});

test('move and resize candidate pitch/time/duration/end bounds refuse atomically without clipping', () => {
  const input = fixture();
  for (const action of [edit(-3, 0), edit(512, 0), edit(0, 0, -25), edit(0, 0, 37), edit(0, .25, .5),
    { kind: 'resize', noteId: 'edit', deltaBeats: -1.25, snap: 0 },
    { kind: 'resize', noteId: 'edit', deltaBeats: 15, snap: 0 },
    { kind: 'resize', noteId: 'edit', deltaBeats: Infinity, snap: 0 }] as RollEdit[]) fails(input, 't1', action);
  input.tracks[0].notes[1] = { id: 'edit', pitch: 96, start: 511.75, duration: .25, velocity: 1 };
  assert.deepEqual(proposeRollEdit(input, 't1', edit(0, .25)), input);
  fails(input, 't1', edit(.125, .25));
  fails(input, 't1', { kind: 'resize', noteId: 'edit', deltaBeats: .125, snap: .25 });
});

test('unknown IDs, duplicate add identity, invalid exact edit shape and nonfinite options cannot publish', () => {
  const input = fixture();
  const actions: unknown[] = [
    { ...edit(0, .25), noteId: 'missing' }, { ...edit(0, .25), noteId: 'other' },
    { ...edit(0, .25), snap: .5 }, { ...edit(0, .25), extra: true },
    { ...edit(0, .25), deltaBeats: NaN }, { ...edit(0, .25), deltaPitch: Infinity },
    { kind: 'remove', noteId: 'edit', snap: 0 }, null,
    { kind: 'add', id: 'other', pitch: 60, start: 0, duration: 1, velocity: 1, snap: 0 },
    { kind: 'add', id: 't1', pitch: 60, start: 0, duration: 1, velocity: 1, snap: 0 },
    { kind: 'add', id: 'new', pitch: 60.5, start: 0, duration: 1, velocity: 1, snap: 0 },
    { kind: 'add', id: 'new', pitch: 60, start: 0, duration: .01, velocity: 1, snap: 0 },
  ];
  for (const action of actions) fails(input, 't1', action as RollEdit);
  fails(input, 'missing', edit(0, 0));
  let reads = 0;const accessor = { ...edit(0, .25) };
  Object.defineProperty(accessor, 'deltaBeats', { enumerable: true, get() { reads++; return 0; } });
  fails(input, 't1', accessor);assert.equal(reads, 0);
});

test('full-composition admission and256-note maximum are checked while successful results remain detached', () => {
  const input = fixture();input.tracks[0].notes = Array.from({ length: 256 }, (_, i) => ({ id: `n${i}`, pitch: 60, start: i / 4, duration: .25, velocity: .8 }));
  assert.equal(proposeRollEdit(input, 't1', { kind: 'move', noteId: 'n0', deltaBeats: 1, deltaPitch: 0, snap: 0 }).tracks[0].notes.length, 256);
  fails(input, 't1', { kind: 'add', id: 'overflow', pitch: 60, start: 0, duration: 1, velocity: .8, snap: 0 });
  const ordinary = fixture(), before = structuredClone(ordinary), result = proposeRollEdit(ordinary, 't1', edit(.25, .25));
  result.tracks[0].notes[0].pitch = 72;result.tracks[1].name = 'Changed';
  assert.deepEqual(ordinary, before);
  ordinary.tracks[1].notes[0].velocity = 2;
  fails(ordinary, 't1', edit(.25, .25));
});
