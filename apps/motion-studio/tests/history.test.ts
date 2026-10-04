import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../src/model.ts';
import { History } from '../src/history.ts';

test('history snapshots isolate callers, getters, undo and redo', () => {
  const initial = createProject();
  const history = new History(initial);
  initial.title = 'Mutated input';
  assert.notEqual(history.current.title, initial.title);
  const second = history.current;
  second.title = 'Second';
  assert.equal(history.commit(second), true);
  second.title = 'Mutated again';
  assert.equal(history.current.title, 'Second');
  history.current.layers[0].keys[0].x = 999;
  assert.equal(history.current.layers[0].keys[0].x, 320);
  const undone = history.undo();
  undone.title = 'Mutated undo result';
  assert.notEqual(history.current.title, undone.title);
  assert.equal(history.canRedo, true);
  assert.equal(history.redo().title, 'Second');
});

test('identical commits preserve redo while new branches discard it', () => {
  const history = new History(createProject());
  history.commit({ ...history.current, title: 'Second' });
  history.undo();
  assert.equal(history.commit(history.current), false);
  assert.equal(history.canRedo, true);
  history.commit({ ...history.current, title: 'Branch' });
  assert.equal(history.canRedo, false);
  assert.equal(history.redo().title, 'Branch');
});

test('invalid commits and reset leave the current history intact', () => {
  const history = new History(createProject());
  history.commit({ ...history.current, title: 'Saved' });
  assert.throws(() => history.commit({ ...history.current, frameCount: 999 }));
  assert.throws(() => history.reset({ ...history.current, title: '' }));
  assert.equal(history.current.title, 'Saved');
  assert.equal(history.canUndo, true);
  history.reset(createProject());
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
});

test('history retains at most thirty states including current', () => {
  const history = new History(createProject());
  for (let index = 1; index <= 40; index++) history.commit({ ...history.current, title: `State ${index}` });
  let undos = 0;
  while (history.canUndo) { history.undo(); undos++; }
  assert.equal(undos, 29);
  assert.equal(history.current.title, 'State 11');
});

test('serialized byte budget evicts old snapshots before thirty states', () => {
  const initial = createProject();
  initial.layers = [{ id: 'image', name: 'Image', kind: 'image', image: {
    dataUrl: `data:image/png;base64,${'A'.repeat(1_400_000)}`, width: 1, height: 1 }, keys: initial.layers[0].keys }];
  const history = new History(initial);
  for (let index = 1; index <= 20; index++) history.commit({ ...history.current, title: `State ${index}` });
  let states = 1;
  while (history.canUndo) { history.undo(); states++; }
  assert.equal(states, 14);
  assert.equal(history.current.title, 'State 7');
});


test('preparing an asynchronous history candidate leaves the current cursor and redo branch intact', () => {
  const original = createProject(), history = new History(original);
  const edited = { ...original, title: 'Second state' };
  history.commit(edited);
  const pending = history.peek('undo');
  pending.title = 'Mutated detached preview';
  assert.deepEqual(history.current, edited);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  // A canceled decode never advances or rolls back the cursor. New work can
  // arrive before that old candidate resolves without corrupting its ancestry.
  history.commit({ ...edited, title: 'Newer state' });
  assert.equal(history.undo().title, 'Second state');
  assert.equal(history.peek('redo').title, 'Newer state');
  assert.equal(history.current.title, 'Second state');
  assert.equal(history.redo().title, 'Newer state');
});
