import assert from 'node:assert/strict';
import test from 'node:test';
import { CompositionHistory } from '../src/history.ts';
import type { Composition } from '../src/types.ts';

const fixture = (title = 'Sketch'): Composition => ({
  version: 1,
  title,
  tempo: 120,
  tracks: [{
    id: 'track', name: 'Melody', instrument: 'sine', volume: 0.8, muted: false,
    notes: [{ id: 'note', pitch: 60, start: 0, duration: 1, velocity: 0.75 }],
  }],
});

test('history begins at the initial composition with neither undo nor redo available', () => {
  const history = new CompositionHistory(fixture());
  assert.deepEqual(history.current, fixture());
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);
});

test('commits undo and redo in order, including returning to the initial capture', () => {
  const initial = fixture();
  const captured = fixture();
  captured.tracks[0].notes = [{ id: 'captured-note', pitch: 72, start: 2, duration: 2, velocity: 0.9 }];
  const edited = fixture('Edited capture');
  const history = new CompositionHistory(initial);
  assert.equal(history.commit(captured), true);
  assert.equal(history.commit(edited), true);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  assert.deepEqual(history.undo(), captured);
  assert.deepEqual(history.undo(), initial);
  assert.equal(history.undo(), null);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), captured);
  assert.deepEqual(history.redo(), edited);
  assert.equal(history.redo(), null);
  assert.equal(history.canRedo, false);
});

test('a new commit after undo drops the old redo branch', () => {
  const history = new CompositionHistory(fixture());
  history.commit(fixture('First'));
  history.commit(fixture('Second'));
  history.undo();
  assert.equal(history.commit(fixture('Branch')), true);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(), null);
  assert.deepEqual(history.undo(), fixture('First'));
  assert.deepEqual(history.redo(), fixture('Branch'));
});

test('the default limit keeps fifty prior states and trims only the oldest', () => {
  const history = new CompositionHistory(fixture('0'));
  for (let index = 1; index <= 50; index++) history.commit(fixture(String(index)));
  for (let index = 49; index >= 0; index--) assert.equal(history.undo()?.title, String(index));
  assert.equal(history.undo(), null);
  for (let index = 1; index <= 50; index++) assert.equal(history.redo()?.title, String(index));
  history.commit(fixture('51'));
  for (let index = 50; index >= 1; index--) assert.equal(history.undo()?.title, String(index));
  assert.equal(history.undo(), null);
  assert.equal(history.current.title, '1');
});

test('custom limits bound prior states and remain usable when branching at the limit', () => {
  const history = new CompositionHistory(fixture('0'), 1);
  history.commit(fixture('1'));
  history.commit(fixture('2'));
  assert.equal(history.undo()?.title, '1');
  assert.equal(history.undo(), null);
  history.commit(fixture('Branch'));
  assert.equal(history.redo(), null);
  assert.equal(history.undo()?.title, '1');
  assert.equal(history.undo(), null);
  assert.equal(history.redo()?.title, 'Branch');
  const largest = new CompositionHistory(fixture('0'), 100);
  for (let index = 1; index <= 101; index++) largest.commit(fixture(String(index)));
  for (let index = 100; index >= 1; index--) assert.equal(largest.undo()?.title, String(index));
  assert.equal(largest.undo(), null);
});

test('limits must be integers from one through one hundred', () => {
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) {
    assert.throws(() => new CompositionHistory(fixture(), limit), /limit|integer|100/i);
  }
});

test('mutating initial and committed inputs cannot alter stored history', () => {
  const initial = fixture();
  const history = new CompositionHistory(initial);
  initial.title = 'Changed input';
  initial.tracks[0].notes[0].pitch = 90;
  initial.tracks.push({ ...initial.tracks[0], id: 'other-track', notes: [] });
  assert.deepEqual(history.current, fixture());
  const committed = fixture('Committed');
  history.commit(committed);
  committed.tracks[0].name = 'Changed track';
  committed.tracks[0].notes[0].velocity = 0;
  committed.tracks[0].notes.length = 0;
  assert.deepEqual(history.current, fixture('Committed'));
  assert.deepEqual(history.undo(), fixture());
  assert.deepEqual(history.redo(), fixture('Committed'));
});

test('current, undo and redo return independent copies at every depth', () => {
  const history = new CompositionHistory(fixture());
  const current = history.current;
  current.title = 'Changed title';
  current.tracks[0].notes[0].pitch = 90;
  current.tracks[0].volume = 0;
  assert.deepEqual(history.current, fixture());
  history.commit(fixture('Committed'));
  const undone = history.undo();
  assert.ok(undone);
  undone.tracks[0].notes.length = 0;
  assert.deepEqual(history.current, fixture());
  const redone = history.redo();
  assert.ok(redone);
  redone.tracks.length = 0;
  assert.deepEqual(history.current, fixture('Committed'));
  assert.deepEqual(history.undo(), fixture());
  assert.deepEqual(history.redo(), fixture('Committed'));
});

test('identical commits create no undo entries and preserve redo', () => {
  const history = new CompositionHistory(fixture());
  assert.equal(history.commit(fixture()), false);
  assert.equal(history.canUndo, false);
  history.commit(fixture('Second'));
  history.undo();
  assert.equal(history.commit(fixture()), false);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  assert.deepEqual(history.redo(), fixture('Second'));
});

test('snapshots are reconstructed safely and normalized no-op commits preserve redo', () => {
  const initial = Object.assign(fixture(), { extra: 'discard' });
  initial.title = ' Sketch ';
  Object.assign(initial.tracks[0], { name: ' Melody ', extra: true });
  Object.assign(initial.tracks[0].notes[0], { extra: true });
  const history = new CompositionHistory(initial);
  assert.deepEqual(history.current, fixture());
  history.commit(fixture('Second'));
  history.undo();
  assert.equal(history.commit(initial), false);
  assert.deepEqual(history.redo(), fixture('Second'));
  const next = Object.assign(fixture(' Third '), { extra: true });
  assert.equal(history.commit(next), true);
  assert.deepEqual(history.current, fixture('Third'));
});

test('invalid snapshots fail before changing current, undo or redo', () => {
  const history = new CompositionHistory(fixture());
  history.commit(fixture('Second'));
  history.commit(fixture('Third'));
  history.undo();
  const invalid: Composition[] = [
    { ...fixture(), tempo: NaN },
    { ...fixture(), tracks: [] },
    { ...fixture(), tracks: new Array(1) },
  ];
  const duplicate = fixture();
  duplicate.tracks[0].notes[0].id = 'track';
  invalid.push(duplicate);
  for (const value of invalid) {
    assert.throws(() => history.commit(value));
    assert.deepEqual(history.current, fixture('Second'));
    assert.equal(history.canUndo, true);
    assert.equal(history.canRedo, true);
  }
  assert.deepEqual(history.redo(), fixture('Third'));
  assert.deepEqual(history.undo(), fixture('Second'));
  assert.deepEqual(history.undo(), fixture());
});

test('initial snapshots are validated before history can be constructed', () => {
  assert.throws(() => new CompositionHistory({ ...fixture(), tempo: 241 }));
  assert.throws(() => new CompositionHistory({ ...fixture(), tracks: [] }));
});
