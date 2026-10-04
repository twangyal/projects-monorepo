import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectHistory,moveShot} from '../src/history.js';
import {createProject} from '../src/model.js';
test('scene history snapshots isolate input/output and undo/redo exact edits',()=>{
  const p=createProject(),h=new ProjectHistory(p);p.title='outside';
  const next=h.current;next.title='First edit';h.commit(next);next.actors[0].x=4;
  assert.equal(h.current.title,'First edit');assert.equal(h.current.actors[0].x,-1.2);
  assert.equal(h.undo().title,'The arrival');assert.equal(h.redo().title,'First edit');
  const leaked=h.current;leaked.title='external mutation';assert.equal(h.current.title,'First edit');
});
test('invalid and identical edits do not consume history or discard redo',()=>{
  const h=new ProjectHistory(createProject()),a=h.current;a.title='edit';h.commit(a);h.undo();
  const invalid=h.current;invalid.light=100;assert.throws(()=>h.commit(invalid));
  h.commit(h.current);assert.equal(h.canRedo,true);assert.equal(h.canUndo,false);
  assert.equal(h.redo().title,'edit');
});
test('new edit after undo clears redo and history retains only 30 previous states',()=>{
  const h=new ProjectHistory(createProject());
  for(let i=0;i<40;i++){const p=h.current;p.title=`Film ${i}`;h.commit(p);}
  let count=0;while(h.canUndo){h.undo();count++;}assert.equal(count,30);assert.equal(h.current.title,'Film 9');
  h.redo();const p=h.current;p.title='new branch';h.commit(p);assert.equal(h.canRedo,false);
});
test('shot moves preserve camera/content and are reversible with whole-scene history',()=>{
  const p=createProject(),h=new ProjectHistory(p),moved=moveShot(p,1,-1);
  assert.deepEqual(moved.shots[0],p.shots[1]);assert.deepEqual(moved.shots[1],p.shots[0]);
  assert.equal(p.shots[0].name,'Establishing');h.commit(moved);assert.deepEqual(h.undo(),p);
  for(const args of [[0,-1],[1,1],[-1,1],[0,2],[.5,1]])assert.throws(()=>moveShot(p,...args));
});
test('motion arrays survive history, reordering and portable snapshots without aliases',()=>{
  const initial=createProject(),h=new ProjectHistory(initial),candidate=h.current;
  Object.assign(candidate.shots[0],{cameraMode:'linear',endEye:[3,2,7],endTarget:[0,1,0]});
  const travel=h.commit(candidate);candidate.shots[0].endEye[0]=12;
  assert.equal(h.current.shots[0].endEye[0],3);assert.equal(travel.schemaVersion,2);
  const moved=moveShot(h.current,0,1);assert.deepEqual(moved.shots[1],travel.shots[0]);h.commit(moved);
  moved.shots[1].endTarget[0]=10;assert.deepEqual(h.current.shots[1],travel.shots[0]);
  assert.deepEqual(h.undo(),travel);assert.deepEqual(h.undo(),initial);
  assert.deepEqual(h.redo(),travel);assert.deepEqual(h.redo().shots[1],travel.shots[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.current)),h.current);
});
test('invalid whole-path edits preserve the history cursor and no-op redo',()=>{
  const p=createProject();Object.assign(p.shots[0],{cameraMode:'linear',eye:[1,1,0],target:[0,1,0],endEye:[2,1,0],endTarget:[0,1,0]});
  const h=new ProjectHistory(p),edited=h.current;edited.title='Valid later edit';h.commit(edited);h.undo();
  const invalid=h.current;invalid.shots[0].endEye=[-1,1,0];assert.throws(()=>h.commit(invalid),/camera|path/i);
  assert.deepEqual(h.current,p);assert.equal(h.canUndo,false);assert.equal(h.canRedo,true);
  h.commit(h.current);assert.equal(h.canRedo,true);assert.deepEqual(h.redo(),edited);
});
