import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../src/workspace.js';

test('search and selection operate on messages without changing their content', () => {
  const workspace = createWorkspace();
  assert.equal(workspace.search('CALIBRATION').length, 1);
  const message = workspace.search('CALIBRATION')[0];
  assert.equal(workspace.select(message.id).id, message.id);
  assert.equal(workspace.select('missing'), null);
  assert.equal(workspace.search('no matching text').length, 0);
  assert.equal(workspace.search('').length, 4);
});

test('drafts validate content and return detached snapshots', () => {
  const workspace = createWorkspace();
  assert.throws(() => workspace.saveDraft('', '  '), /Write/);
  const draft = workspace.saveDraft(' Hello ', ' Local draft ');
  assert.equal(draft.subject, 'Hello');
  assert.equal(draft.body, 'Local draft');
  draft.subject = 'changed';
  assert.equal(workspace.drafts()[0].subject, 'Hello');
  const snapshot = workspace.drafts();
  snapshot.length = 0;
  assert.equal(workspace.drafts().length, 1);
});
