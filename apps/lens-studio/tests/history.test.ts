import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/history.ts';
import { createProject, fillMask } from '../src/model.ts';
import { LIMITS } from '../src/types.ts';
import { photo } from './model-fixture.ts';

test('history returns isolated states, ignores no-ops and preserves redo until an actual branch', () => {
  const project = createProject(photo()), history = new History(project);
  project.title = 'Outside mutation'; assert.equal(history.current.title, 'Lens study');
  const first = history.current; first.title = 'First'; assert.equal(history.commit(first), true);
  first.settings.near = .5; assert.equal(history.current.settings.near, .6);
  const second = history.current; second.title = 'Second'; history.commit(second);
  assert.equal(history.undo().title, 'First');
  assert.equal(history.commit(history.current), false); assert.equal(history.canRedo, true);
  assert.equal(history.redo().title, 'Second'); history.undo();
  const branch = fillMask(history.current, 0); history.commit(branch);
  assert.equal(history.canRedo, false); assert.deepEqual(history.redo(), branch);
  assert.equal(history.undo().title, 'First');
});

test('history retains at most thirty states including current', () => {
  const history = new History(createProject(photo()));
  for (let i = 1; i <= 40; i++) { const next = history.current; next.title = String(i); history.commit(next); }
  let undos = 0; while (history.canUndo) { history.undo(); undos++; }
  assert.equal(undos, 29); assert.equal(history.current.title, '11');
  assert.equal(history.undo().title, '11');
});

test('byte cap accounts compact edit states while preserving current and a single fixed photo', () => {
  const history = new History(createProject(photo(1280, 1280)));
  const sizes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const next = history.current; next.title = String(i).padStart(2, '0'); history.commit(next);
    const { title, settings, depth } = next;
    sizes.push(new TextEncoder().encode(JSON.stringify({ title, settings, depth })).length);
  }
  const expected = Math.floor(LIMITS.historyBytes / sizes[0]);
  let count = 1; while (history.canUndo) { history.undo(); count++; }
  assert.equal(count, expected); assert.equal(history.current.title, String(20 - expected).padStart(2, '0'));
});

test('commit rejects different project/photo and invalid state atomically; reset accepts a staged new photo', () => {
  const original = createProject(photo()), history = new History(original);
  const changed = history.current; changed.title = 'Edit'; history.commit(changed); history.undo();
  for (const candidate of [{ ...changed, id: crypto.randomUUID() }, { ...changed, photo: { ...changed.photo, id: crypto.randomUUID() } },
    { ...changed, photo: photo(2, 2) }, { ...changed, title: '' }]) {
    assert.throws(() => history.commit(candidate)); assert.deepEqual(history.current, original); assert.equal(history.canRedo, true);
  }
  assert.throws(() => history.reset({ ...original, schemaVersion: 2 } as never));
  assert.equal(history.canRedo, true);
  const next = createProject(photo(2, 2)); history.reset(next);
  assert.deepEqual(history.current, next); assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
});
