// Independent #63 expectations: literal films/cues and frozen temporal equations.
// Authored before reading the new model/evaluator/renderer implementations.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';
import {performerPose} from '../src/performer.js';
import {ProjectHistory} from '../src/history.js';

const still={name:'Control',color:'#00ff00',performanceMode:'loop',x:1,z:-1,action:'idle'};
const loop={name:'Pacer',color:'#ff0000',performanceMode:'loop',x:-1,z:0,action:'walk'};
const cue=(time,x,z,action='idle',visible=true)=>({time,x,z,action,visible});
function blocked(){return {name:'Arrival',color:'#ff0000',performanceMode:'blocking',cues:[
  cue(0,-3,0,'idle',false),cue(1,-3,0,'walk'),cue(3,0,2,'wave'),
  cue(5,0,2,'idle'),cue(6,0,2,'walk'),cue(8,4,2,'idle',false),
]};}
function film(){return {schemaVersion:3,title:'Literal independent arrival',light:1,
  actors:[blocked(),{...still}],shots:[{name:'Fixed witness',duration:8,
    eye:[0,2.2,8],target:[0,1.15,0],fov:50,cameraMode:'static'}]};}
function legacy(version){
  const value={schemaVersion:version,title:'Literal original film',light:1,
    actors:[{name:'Pacer',x:-1,z:0,color:'#ff0000',action:'walk'},
      {name:'Waver',x:1,z:-1,color:'#00ff00',action:'wave'}],
    shots:[{name:'Original view',duration:4,eye:[5,3,7],target:[0,1,0],fov:45}]};
  if(version===2)Object.assign(value.shots[0],{cameraMode:'linear',endEye:[4,3,7],endTarget:[1,1,0]});
  return value;
}
function near(actual,expected){assert.ok(Math.abs(actual-expected)<=1e-12,`${actual} differs from ${expected}`);}
function expectedPose(x,z,arm,leg,visible,action){return {x,z,arm,leg,visible,action};}

test('independent blocking oracle: arrival, hold, wave and departure follow literal marks',()=>{
  const actor=blocked();
  assert.deepEqual(performerPose(actor,0,8),expectedPose(-3,0,0,0,false,'idle'));
  assert.deepEqual(performerPose(actor,1,8),expectedPose(-3,0,0,0,true,'walk'));
  const arrival=performerPose(actor,2,8);
  near(arrival.x,-1.5);near(arrival.z,1);
  near(arrival.arm,-.4794621373315692);near(arrival.leg,-.3356234961320984);
  assert.equal(arrival.action,'walk');assert.equal(arrival.visible,true);
  assert.deepEqual(performerPose(actor,3,8),expectedPose(0,2,.8,0,true,'wave'));
  const wave=performerPose(actor,4,8);near(wave.x,0);near(wave.z,2);
  near(wave.arm,.6602922509005371);assert.equal(wave.leg,0);
  assert.deepEqual(performerPose(actor,5.5,8),expectedPose(0,2,0,0,true,'idle'));
  const departing=performerPose(actor,7,8);near(departing.x,2);near(departing.z,2);
  assert.deepEqual(performerPose(actor,8,8),expectedPose(4,2,0,0,false,'idle'));
});

test('independent blocking oracle: actions and visibility step exactly, never interpolate',()=>{
  const actor=blocked();
  assert.equal(performerPose(actor,.999,8).visible,false);
  assert.equal(performerPose(actor,1,8).visible,true);
  assert.equal(performerPose(actor,2.999,8).action,'walk');
  assert.equal(performerPose(actor,3,8).action,'wave');
  assert.equal(performerPose(actor,4.999,8).action,'wave');
  assert.equal(performerPose(actor,5,8).action,'idle');
  assert.equal(performerPose(actor,7.999,8).visible,true);
  assert.equal(performerPose(actor,8,8).visible,false);
});

test('independent blocking oracle: each cue resets limb phase while root motion stays purely linear',()=>{
  const actor={name:'Phase witness',color:'#ff0000',performanceMode:'blocking',cues:[
    cue(0,-2,0,'wave'),cue(2,0,0,'wave'),cue(4,2,0,'walk'),cue(6,4,0,'walk')]};
  near(performerPose(actor,2,8).arm,.8);
  near(performerPose(actor,2.25,8).arm,1.2987474933020273);
  const moving=performerPose(actor,5,8);near(moving.x,3);
  near(moving.arm,-.4794621373315692);near(moving.leg,-.3356234961320984);
  assert.equal(performerPose(actor,6,8).arm,0);
  assert.equal(performerPose(actor,6,8).leg,0);
  near(performerPose(actor,7,8).x,4);
});

test('independent blocking oracle: finite times clamp at film ends and detached outputs cannot alter cues',()=>{
  const actor=blocked();
  assert.deepEqual(performerPose(actor,-100,8),expectedPose(-3,0,0,0,false,'idle'));
  assert.deepEqual(performerPose(actor,100,8),expectedPose(4,2,0,0,false,'idle'));
  const pose=performerPose(actor,2,8);pose.x=99;pose.visible=false;
  near(performerPose(actor,2,8).x,-1.5);
  assert.equal(actor.cues[1].x,-3);
  for(const time of [NaN,Infinity,-Infinity])assert.throws(()=>performerPose(actor,time,8));
  for(const duration of [0,-1,60.01,NaN,Infinity])assert.throws(()=>performerPose(actor,2,duration));
});

test('independent loop oracle: original global sine motion continues outside authored film',()=>{
  for(const time of [-2,0,2,11,70]){
    const pose=performerPose(loop,time,8);
    near(pose.x,-1+.7*Math.sin(time));near(pose.z,0);
    near(pose.arm,.5*Math.sin(time*5));near(pose.leg,.35*Math.sin(time*5));
    assert.equal(pose.action,'walk');assert.equal(pose.visible,true);
  }
  const wave={...loop,action:'wave'};
  near(performerPose(wave,70,8).arm,.8+.5*Math.sin(420));
  assert.deepEqual(performerPose(still,70,8),expectedPose(1,-1,0,0,true,'idle'));
});

test('independent admission oracle: malformed full cues reject without coercion or mutation',()=>{
  const mutations=[
    actor=>actor.cues[0].time=.001,
    actor=>actor.cues[1].time=0,
    actor=>actor.cues[1].time=-1,
    actor=>actor.cues[2].time=9,
    actor=>actor.cues[1].x=4.01,
    actor=>actor.cues[1].z=NaN,
    actor=>actor.cues[1].visible='true',
    actor=>actor.cues[1].action='dance',
    actor=>actor.cues[1].extra=true,
    actor=>actor.cues=new Array(2),
    actor=>actor.cues=Array.from({length:33},(_,index)=>cue(index/5,0,0)),
    actor=>actor.x=0,
  ];
  for(const mutate of mutations){
    const actor=blocked();mutate(actor);const before=JSON.stringify(actor);
    assert.throws(()=>performerPose(actor,2,8));assert.equal(JSON.stringify(actor),before);
  }
});

test('independent migration oracle: genuine original-key v1 and v2 preserve legacy loops and complete cameras',()=>{
  for(const version of [1,2]){
    const input=legacy(version),before=JSON.stringify(input),output=model.validateProject(input);
    assert.equal(output.schemaVersion,3);assert.equal(JSON.stringify(input),before);
    assert.deepEqual(output.actors,input.actors.map(actor=>({...actor,performanceMode:'loop'})));
    assert.deepEqual(output.shots,[{...input.shots[0],cameraMode:version===1?'static':'linear'}]);
    const original=model.actorPose(input.actors[0],11),migrated=model.performerAt(output,0,11);
    near(original.x,-1+.7*Math.sin(11));near(migrated.x,original.x);
    near(migrated.arm,original.arm);near(migrated.leg,original.leg);
  }
});

test('independent migration oracle: motion-bearing legacy, future and mixed actor shapes fail closed',()=>{
  for(const version of [1,2]){
    const input=legacy(version);input.actors[0].performanceMode='loop';
    assert.throws(()=>model.validateProject(input));
    const withCues=legacy(version);withCues.actors[0].cues=[cue(0,0,0)];
    assert.throws(()=>model.importProject(JSON.stringify(withCues)));
  }
  const future=film();future.schemaVersion=4;assert.throws(()=>model.validateProject(future));
  const mixed=film();mixed.actors[0].x=0;assert.throws(()=>model.validateProject(mixed));
  const legacyMotion=legacy(1);legacyMotion.shots[0].cameraMode='linear';
  assert.throws(()=>model.validateProject(legacyMotion));
});

test('independent global-time oracle: exact fractional camera cuts do not reset performer cues',()=>{
  const value=film();value.actors[0].cues=[cue(0,-3,0,'walk'),cue(2.3,1,0,'wave'),cue(3.5,2,0,'idle')];
  value.shots=[1.1,1.2,1.3].map((duration,index)=>({...value.shots[0],name:`Cut ${index}`,duration}));
  const cut=1.1+1.2,view=model.frameAt(value,cut);
  assert.equal(view.index,2);assert.equal(view.local,0);
  assert.deepEqual(model.performerAt(value,0,cut),expectedPose(1,0,.8,0,true,'wave'));
  const midpoint=model.performerAt(value,0,1.15);near(midpoint.x,-1);
  near(midpoint.arm,.5*Math.sin(5.75));
  const final=model.performerAt(value,0,100);near(final.x,2);assert.equal(final.action,'idle');
});

test('independent mode conversion oracle: base position retained, scheduled visibility/cues explicitly removed',()=>{
  const input=legacy(2),canonical=model.validateProject(input);
  const converted=model.setPerformanceMode(canonical,0,'blocking');
  assert.deepEqual(converted.actors[0],{name:'Pacer',color:'#ff0000',performanceMode:'blocking',cues:[cue(0,-1,0,'walk')]});
  assert.equal(canonical.actors[0].performanceMode,'loop');
  const original=film(),back=model.setPerformanceMode(original,0,'loop');
  assert.deepEqual(back.actors[0],{name:'Arrival',color:'#ff0000',performanceMode:'loop',x:-3,z:0,action:'idle'});
  assert.equal(original.actors[0].cues.length,6);
});

test('independent cue-operation oracle: insertion/retiming/removal return exact chronological selection',()=>{
  const input=film();input.actors[0].cues=[cue(0,0,0),cue(4,4,0)];
  const inserted=model.insertCue(input,0,cue(2,2,0,'walk'));
  assert.equal(inserted.cueIndex,1);assert.deepEqual(inserted.project.actors[0].cues.map(item=>item.time),[0,2,4]);
  assert.equal(input.actors[0].cues.length,2);
  const retimed=model.updateCue(inserted.project,0,1,cue(5,2,0,'wave'));
  assert.equal(retimed.cueIndex,2);assert.deepEqual(retimed.project.actors[0].cues.map(item=>item.time),[0,4,5]);
  const following=model.removeCue(retimed.project,0,1);
  assert.equal(following.cueIndex,1);assert.deepEqual(following.project.actors[0].cues.map(item=>item.time),[0,5]);
  const previous=model.removeCue(retimed.project,0,2);
  assert.equal(previous.cueIndex,1);assert.deepEqual(previous.project.actors[0].cues.map(item=>item.time),[0,4]);
});

test('independent cue-operation oracle: invalid operations leave the caller untouched',()=>{
  const input=film(),before=JSON.stringify(input);
  for(const operation of [
    ()=>model.removeCue(input,0,0),
    ()=>model.updateCue(input,0,0,cue(1,0,0)),
    ()=>model.insertCue(input,0,cue(3,0,0)),
    ()=>model.insertCue(input,0,cue(8.001,0,0)),
    ()=>model.insertCue(input,1,cue(1,0,0)),
    ()=>model.updateCue(input,1,0,cue(0,0,0)),
    ()=>model.removeCue(input,1,0),
    ()=>model.performerAt(input,2,0),
  ]){assert.throws(operation);assert.equal(JSON.stringify(input),before);}
});

test('independent bounds oracle:32 cues accepted,33 rejected and shorter film cannot silently clip',()=>{
  const value=film();value.actors[0].cues=Array.from({length:32},(_,index)=>cue(index/4,0,0));
  assert.equal(model.validateProject(value).actors[0].cues.length,32);
  assert.throws(()=>model.insertCue(value,0,cue(8,0,0)));
  const shortened=film();shortened.shots[0].duration=7.99;
  const before=JSON.stringify(shortened);assert.throws(()=>model.validateProject(shortened));
  assert.equal(JSON.stringify(shortened),before);
});

test('independent history oracle: cue edits undo/redo as one state and failed duration leaves cursor intact',()=>{
  const input=film(),history=new ProjectHistory(input);
  const changed=model.updateCue(input,0,2,cue(3,1,2,'wave'));
  history.commit(changed.project);assert.equal(history.current.actors[0].cues[2].x,1);
  history.undo();assert.equal(history.current.actors[0].cues[2].x,0);assert.equal(history.canRedo,true);
  const invalid=history.current;invalid.shots[0].duration=7;
  assert.throws(()=>history.commit(invalid));assert.equal(history.canRedo,true);
  history.redo();assert.equal(history.current.actors[0].cues[2].x,1);
});
