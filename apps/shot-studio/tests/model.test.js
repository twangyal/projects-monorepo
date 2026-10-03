import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, validateProject, importProject, totalDuration, shotAt, actorPose} from '../src/model.js';
import {multiply, lookAt, perspective, transform, groundHit} from '../src/math.js';

test('starter film has two performers, a bounded shot list and isolated copies',()=>{
  const a=createProject(), b=createProject(); a.actors[0].x=4;
  assert.equal(b.actors[0].x,-1.2); assert.equal(a.actors.length,2);
  assert.ok(totalDuration(a)>0); assert.deepEqual(validateProject(b),b);
});
test('exact cuts and final frame choose the correct shot without overshoot',()=>{
  const p=createProject(); p.shots[0].duration=2; p.shots[1].duration=3;
  assert.equal(shotAt(p,0).index,0); assert.equal(shotAt(p,2).index,1);
  assert.equal(shotAt(p,5).index,1); assert.equal(shotAt(p,100).local,3);
  assert.equal(shotAt(p,-10).local,0);
});
test('invalid input is rejected without mutation or coercion',()=>{
  for(const mutation of [p=>p.actors[0].x=Infinity,p=>p.shots=[],p=>p.shots[0].fov=180,
    p=>p.shots[0].duration='2',p=>p.actors[0].action='execute',p=>p.light=-1,
    p=>p.shots=Array(21).fill(p.shots[0]),p=>p.title='x'.repeat(81),p=>p.schemaVersion=true,
    p=>p.actors[0].color='red',p=>p.shots[0].target=[0,0,0],p=>p.shots[0].eye=[0,0,0]]){
    const p=createProject(); mutation(p); const before=JSON.stringify(p);
    assert.throws(()=>validateProject(p)); assert.equal(JSON.stringify(p),before);
  }
});
test('imports reject oversized, malformed and unknown-schema backups',()=>{
  assert.throws(()=>importProject(' '.repeat(65537)));
  assert.throws(()=>importProject('{'));
  assert.deepEqual(importProject(JSON.stringify(createProject())),createProject());
});
test('pose is deterministic, bounded and changes for authored wave/walk',()=>{
  const actor=createProject().actors[0]; actor.action='wave';
  assert.notEqual(actorPose(actor,0).arm,actorPose(actor,.2).arm);
  assert.deepEqual(actorPose(actor,1),actorPose(actor,1)); actor.action='walk';
  assert.ok(Math.abs(actorPose(actor,5).x-actor.x)<=.8);
});
test('camera view and perspective project the target to the image center',()=>{
  const view=lookAt([3,2,5],[0,1,0]); const eye=transform(view,[3,2,5,1]);
  eye.slice(0,3).forEach(x=>assert.ok(Math.abs(x)<1e-6));
  const projected=transform(multiply(perspective(45,16/9,.1,100),view),[0,1,0,1]);
  assert.ok(Math.abs(projected[0])<1e-5); assert.ok(Math.abs(projected[1])<1e-5);
  assert.ok(projected[3]>0);
});
test('ground selection rejects parallel, backwards and out-of-set rays',()=>{
  assert.deepEqual(groundHit([0,2,0],[0,-1,-1]),[0,-2]);
  for(const d of [[0,0,-1],[0,1,0],[10,-.1,0]]) assert.equal(groundHit([0,2,0],d),null);
});
