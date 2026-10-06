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

test('updating a reopened draft keeps its identity, order and unrelated records',()=>{
 const w=createWorkspace(),first=w.saveDraft('First','One'),second=w.saveDraft('Second','Two');
 const opened=w.draft(first.id);opened.body='external change';
 assert.equal(w.draft(first.id).body,'One');
 assert.deepEqual(w.updateDraft(first.id,' Revised ',' Three '),{id:first.id,subject:'Revised',body:'Three'});
 assert.deepEqual(w.drafts(),[{id:first.id,subject:'Revised',body:'Three'},second]);
 assert.throws(()=>w.updateDraft('missing','Wrong','New'),/found/);
 assert.throws(()=>w.updateDraft(first.id,'',' '),/Write/);
 assert.equal(w.draft(first.id).body,'Three');
});

test('notebook capacity and field limits refuse atomically while updates remain available',()=>{
 const w=createWorkspace();
 for(let i=0;i<20;i++)w.saveDraft(`Saved ${i}`,'x'.repeat(10000));
 const before=w.drafts();
 assert.throws(()=>w.saveDraft('Overflow','New'),/20/);
 assert.throws(()=>w.updateDraft(before[0].id,'x'.repeat(201),'valid'),/200/);
 assert.throws(()=>w.updateDraft(before[0].id,'valid','x'.repeat(10001)),/10000/);
 assert.deepEqual(w.drafts(),before);
 assert.equal(w.updateDraft(before[0].id,'x'.repeat(200),'Changed').body,'Changed');
 assert.equal(w.drafts().length,20);
});
