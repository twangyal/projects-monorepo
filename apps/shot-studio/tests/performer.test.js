import test from 'node:test';
import assert from 'node:assert/strict';
import {performerPose} from '../src/performer.js';

const loop=(action='idle')=>({name:'Solo',color:'#d03040',performanceMode:'loop',x:1,z:-2,action});
const blocking=()=>({name:'Arrival',color:'#15a040',performanceMode:'blocking',cues:[
  {time:0,x:-3,z:1,action:'walk',visible:true},
  {time:2,x:1,z:-1,action:'idle',visible:true},
  {time:4,x:1,z:-1,action:'wave',visible:true},
  {time:6,x:3,z:1,action:'idle',visible:false},
]});
const pose=(x,z,arm,leg,visible,action)=>({x,z,arm,leg,visible,action});

test('canonical loop preserves the old root and limb formulas beyond film end',()=>{
  assert.deepEqual(performerPose(loop(),100,8),pose(1,-2,0,0,true,'idle'));
  for(const time of [-.5,0,.75,8,65,120]){
    assert.deepEqual(performerPose(loop('wave'),time,8),pose(1,-2,.8+.5*Math.sin(time*6),0,true,'wave'));
    assert.deepEqual(performerPose(loop('walk'),time,8),pose(1+.7*Math.sin(time),-2,.5*Math.sin(time*5),.35*Math.sin(time*5),true,'walk'));
  }
});

test('blocking interpolates only root position and uses left-cue action/visibility',()=>{
  const actor=blocking();
  assert.deepEqual(performerPose(actor,1,8),pose(-1,0,.5*Math.sin(5),.35*Math.sin(5),true,'walk'));
  assert.deepEqual(performerPose(actor,3,8),pose(1,-1,0,0,true,'idle'));
  assert.deepEqual(performerPose(actor,5,8),pose(2,0,.8+.5*Math.sin(6),0,true,'wave'));
  assert.deepEqual(performerPose(actor,6,8),pose(3,1,0,0,false,'idle'));
});

test('exact cue boundaries reset limb phase, including stationary holds and visibility steps',()=>{
  const actor=blocking();
  assert.deepEqual(performerPose(actor,0,8),pose(-3,1,0,0,true,'walk'));
  assert.deepEqual(performerPose(actor,2,8),pose(1,-1,0,0,true,'idle'));
  assert.deepEqual(performerPose(actor,4,8),pose(1,-1,.8,0,true,'wave'));
  assert.equal(performerPose(actor,6-Number.EPSILON*4,8).visible,true);
  assert.equal(performerPose(actor,6,8).visible,false);
});

test('blocking negative and after-end times clamp; final action continues to film end',()=>{
  const actor={...blocking(),cues:[{time:0,x:0,z:0,action:'idle',visible:false},{time:2,x:1,z:2,action:'wave',visible:true}]};
  assert.deepEqual(performerPose(actor,-99,8),pose(0,0,0,0,false,'idle'));
  assert.deepEqual(performerPose(actor,8,8),pose(1,2,.8+.5*Math.sin(36),0,true,'wave'));
  assert.deepEqual(performerPose(actor,999,8),performerPose(actor,8,8));
});

test('one cue and a final cue exactly at duration are both valid',()=>{
  const actor={...blocking(),cues:[{time:0,x:-4,z:4,action:'idle',visible:true}]};
  assert.deepEqual(performerPose(actor,3,.1),pose(-4,4,0,0,true,'idle'));
  actor.cues.push({time:.1,x:4,z:-4,action:'wave',visible:false});
  assert.deepEqual(performerPose(actor,.1,.1),pose(4,-4,.8,0,false,'wave'));
});

test('evaluation validates all cues, even unused future cues, before returning',()=>{
  const actor=blocking(); actor.cues[3].x=4.01;
  assert.throws(()=>performerPose(actor,0,8));
  actor.cues[3].x=3; actor.cues[3].time=9;
  assert.throws(()=>performerPose(actor,0,8));
});

test('film time and duration are finite strict numbers; duration is positive and at most60',()=>{
  for(const time of [NaN,Infinity,-Infinity,'1',null])assert.throws(()=>performerPose(loop(),time,8));
  for(const duration of [0,-1,60.00001,NaN,Infinity,'8',null])assert.throws(()=>performerPose(loop(),1,duration));
  assert.equal(performerPose(loop(),0,60).visible,true);
});

test('canonical modes require exact shapes and retain existing performer bounds',()=>{
  for(const actor of [
    {name:'Solo',color:'#d03040',x:1,z:-2,action:'idle'},
    {...loop(),performanceMode:'unknown'}, {...loop(),cues:[]},
    {...blocking(),x:0}, {...blocking(),action:'idle'},
    {...loop(),name:''},{...loop(),name:'x'.repeat(31)},{...loop(),name:'bad\nname'},
    {...loop(),color:'red'},{...loop(),color:'#abc'},
    {...loop(),x:4.0001},{...loop(),z:NaN},{...loop(),action:'dance'},
  ])assert.throws(()=>performerPose(actor,0,8));
});

test('cue shape, strict increasing time, first zero and boolean visibility are admitted exactly',()=>{
  const cue={time:0,x:0,z:0,action:'idle',visible:true};
  for(const cues of [[],[{...cue,time:.1}],[cue,{...cue,time:0}],
    [cue,{...cue,time:2},{...cue,time:1}],[{...cue,visible:1}],
    [{...cue,extra:1}],[{...cue,time:'0'}],[{...cue,x:'0'}],
    [{...cue,z:Infinity}],[{...cue,action:'dance'}],
  ])assert.throws(()=>performerPose({...blocking(),cues},0,8));
});

test('32 dense cues are admitted;33, sparse, accessor and extra array properties are rejected without getter calls',()=>{
  const cues=Array.from({length:32},(_,time)=>({time,x:0,z:0,action:'idle',visible:true}));
  assert.equal(performerPose({...blocking(),cues},0,60).x,0);
  assert.throws(()=>performerPose({...blocking(),cues:[...cues,{...cues[0],time:32}]},0,60));
  const sparse=[...cues]; delete sparse[1]; assert.throws(()=>performerPose({...blocking(),cues:sparse},0,60));
  const extra=[...cues]; extra.metadata='hidden'; assert.throws(()=>performerPose({...blocking(),cues:extra},0,60));
  let reads=0;const accessor=[...cues];Object.defineProperty(accessor,'0',{get(){reads++;return cues[0];},enumerable:true});
  assert.throws(()=>performerPose({...blocking(),cues:accessor},0,60));assert.equal(reads,0);
  const actor=loop();Object.defineProperty(actor,'x',{get(){reads++;return 1;},enumerable:true});
  assert.throws(()=>performerPose(actor,0,8));assert.equal(reads,0);
});

test('output is detached and evaluation does not mutate frozen canonical actor data',()=>{
  const actor=blocking();const before=JSON.stringify(actor);
  actor.cues.forEach(Object.freeze);Object.freeze(actor.cues);Object.freeze(actor);
  const result=performerPose(actor,1,8);result.x=99;result.action='idle';
  assert.equal(JSON.stringify(actor),before);assert.equal(performerPose(actor,1,8).x,-1);
  assert.equal(performerPose(Object.assign(Object.create(null),loop()),0,8).visible,true);
});

test('finite extreme loop time fails closed on arithmetic overflow, while blocking remains bounded',()=>{
  assert.throws(()=>performerPose(loop('wave'),1e308,8),/finite animation range/);
  assert.throws(()=>performerPose(loop('walk'),-1e308,8),/finite animation range/);
  assert.deepEqual(performerPose(loop(),1e308,8),pose(1,-2,0,0,true,'idle'));
  assert.deepEqual(performerPose(blocking(),1e308,8),pose(3,1,0,0,false,'idle'));
});

async function renderScene(project,time){
  const {StageRenderer}=await import('../src/renderer.js');
  const records=[];let matrix,color;
  const renderer=Object.create(StageRenderer.prototype);
  renderer.program={};renderer.uniforms={model:'model',viewProjection:'vp',color:'color',light:'light'};
  renderer.gl={TRIANGLES:4,useProgram(){},uniform1f(){},
    uniformMatrix4fv(key,_transpose,value){if(key==='model')matrix=[...value];},
    uniform3fv(_key,value){color=[...value];},
    drawArrays(){records.push({matrix,color});},
  };
  renderer.scene(project,time,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  return records;
}
const stageFilm=()=>({schemaVersion:3,title:'Blocking stage',light:1,
  actors:[blocking(),{...loop(),name:'Control',color:'#2244ee',x:0,z:2}],
  shots:[{name:'Wide',duration:8,cameraMode:'static',eye:[5,3,7],target:[0,1,0],fov:45}],
});
const costume=(records,color)=>records.filter(record=>record.color.every((value,index)=>value===color[index]));

test('renderer evaluates global blocking time, omits hidden actor boxes and preserves stage/control',async()=>{
  const film=stageFilm(),first=await renderScene(film,0),middle=await renderScene(film,1),last=await renderScene(film,6);
  assert.equal(first.length,28);assert.equal(middle.length,28);assert.equal(last.length,20);
  assert.deepEqual(first.slice(0,12),last.slice(0,12));
  const green=[21/255,160/255,64/255],blue=[34/255,68/255,238/255];
  assert.equal(costume(middle,green)[0].matrix[12],-1);assert.equal(costume(middle,green)[0].matrix[14],0);
  assert.equal(costume(last,green).length,0);assert.deepEqual(costume(first,blue),costume(last,blue));
});

test('renderer does not reset performer phase at camera cuts and keeps XR loop motion after film end',async()=>{
  const film=stageFilm();film.shots=[{...film.shots[0],duration:4},{...film.shots[0],name:'Cut',duration:4}];
  const records=await renderScene(film,5),green=[21/255,160/255,64/255];
  assert.equal(costume(records,green)[0].matrix[12],2);
  film.actors[1].action='walk';const xr=await renderScene(film,100),blue=[34/255,68/255,238/255];
  assert.equal(xr.length,20);assert.equal(costume(xr,blue)[0].matrix[12],.7*Math.sin(100));
});
