import test from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../src/history.ts';
import { createImageAsset, createProject, updateProject } from '../src/model.ts';

function project() { return createProject(createImageAsset({ width: 1, height: 1, rgba: new Uint8ClampedArray([23, 71, 5, 0]) }, { fileName: 'one.png', format: 'png', width: 1, height: 1 })); }

test('history restores exact edits and pixels with detached snapshots and one undo per commit', () => {
  const original = project(), history = new History(original);
  const next = updateProject(original, { title: 'Second', settings: { ...original.settings, border: 0 } });
  assert.equal(history.commit(next), true); next.title = 'External mutation';
  const exposed = history.current; exposed.settings.border = 128; exposed.image.source.fileName = 'External label';
  assert.equal(history.current.title, 'Second'); assert.equal(history.current.settings.border, 0);
  assert.deepEqual(history.undo(), original); assert.equal(history.canRedo, true);
  assert.equal(history.redo().title, 'Second'); assert.equal(history.current.image.rgba, original.image.rgba);
});

test('no-op and rejected edits preserve redo, current state and immutable image identity', () => {
  const first = project(), history = new History(first), second = updateProject(first, { title: 'Second', settings: first.settings });
  history.commit(second); history.undo(); assert.equal(history.commit(first), false); assert.equal(history.canRedo, true);
  for (const next of [{ ...second, title: '' }, { ...second, id: crypto.randomUUID() }, { ...second, image: { ...second.image, id: crypto.randomUUID() } }, { ...second, image: { ...second.image, rgba: 'AAAAAA==' } }, { ...second, image: { ...second.image, source: { ...second.image.source, fileName: 'Other label' } } }]) assert.throws(() => history.commit(next));
  assert.deepEqual(history.current, first); assert.equal(history.canRedo, true); assert.equal(history.redo().title, 'Second');
});

test('only the newest30 states remain, branching truncates redo and validated reset replaces the image', () => {
  const history = new History(project());
  for (let i = 1; i <= 40; i++) history.commit(updateProject(history.current, { title: `State ${i}`, settings: history.current.settings }));
  let undos = 0; while (history.canUndo) { history.undo(); undos++; }
  assert.equal(undos, 29); assert.equal(history.current.title, 'State 11');
  const branch = updateProject(history.current, { title: 'Branch', settings: history.current.settings }); history.commit(branch);
  assert.equal(history.canRedo, false);
  assert.throws(() => history.reset({ ...branch, title: '' })); assert.equal(history.current.title, 'Branch');
  const replacement = project(); history.reset(replacement); replacement.title = 'Changed outside';
  assert.equal(history.current.title, 'Color context study'); assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
});
