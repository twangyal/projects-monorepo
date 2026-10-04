import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';

const legacy=()=>({schemaVersion:1,title:'Original film',light:1,
  actors:[{name:'Mika',x:-1.2,z:0,color:'#db825c',action:'wave'},{name:'Noor',x:1.2,z:-1,color:'#6cb1ba',action:'walk'}],
  shots:[{name:'Original camera',duration:4,eye:[5,3,7],target:[0,1,0],fov:45}]});
const staticShot=()=>({name:'Authored camera',duration:4,eye:[1,2,5],target:[0,1,0],fov:40,cameraMode:'static'});
const linear=(change={})=>({...staticShot(),cameraMode:'linear',endEye:[3,4,7],endTarget:[1,2,2],...change});
function film(shot=staticShot()){const p={...legacy(),schemaVersion:2};p.shots=[shot];return p;}
function path(start,end){return linear({eye:start.map((v,i)=>v+[0,1,0][i]),target:[0,1,0],endEye:end.map((v,i)=>v+[0,1,0][i]),endTarget:[0,1,0]});}

test('canonical starter uses explicit v3 performers and static shots without changing authored images',()=>{
  const p=model.createProject();assert.equal(model.SCHEMA_VERSION,3);assert.equal(p.schemaVersion,3);
  assert.deepEqual(p.shots.map(s=>[s.cameraMode,s.eye,s.target,s.fov]),[['static',[5,3,7],[0,1,0],45],['static',[0,1.8,5],[0,1,0],40]]);
  assert.deepEqual(model.validateProject(p),p);
});
test('genuine original-key v1 imports migrate detached static scenes without mutating source',()=>{
  const p=legacy(),before=structuredClone(p),next=model.validateProject(p);
  assert.equal(next.schemaVersion,3);assert.deepEqual(next.shots,[{...p.shots[0],cameraMode:'static'}]);
  assert.deepEqual(model.importProject(JSON.stringify(p)),next);next.shots[0].eye[0]=9;next.actors[0].name='Changed';assert.deepEqual(p,before);
});
test('legacy migration rejects unknown fields and any disguised motion instead of stripping them',()=>{
  assert.doesNotThrow(()=>model.validateProject(legacy()));
  for(const mutate of [p=>p.extra=true,p=>p.actors[0].extra=true,p=>p.shots[0].extra=true,
    p=>p.shots[0].cameraMode='static',p=>p.shots[0].endEye=[3,2,5],p=>p.shots[0].endTarget=[0,1,0],
    p=>p.schemaVersion=4,p=>p.schemaVersion='1']){
    const p=legacy();mutate(p);const before=structuredClone(p);assert.throws(()=>model.validateProject(p));assert.deepEqual(p,before);
    assert.throws(()=>model.importProject(JSON.stringify(p)),/Invalid project backup/);
  }
});
test('v2 mode-specific keys and dense ordinary finite vectors are strict',()=>{
  assert.doesNotThrow(()=>model.validateProject(film(linear())));
  for(const mutate of [p=>delete p.shots[0].cameraMode,p=>p.shots[0].cameraMode='spline',p=>delete p.shots[0].endEye,
    p=>p.shots[0].cameraMode='static',p=>p.shots[0].extra=1,p=>p.actors.push(p.actors[0]),
    p=>delete p.shots[0].endTarget[1],p=>delete p.shots[0],p=>delete p.actors[1],
    p=>p.shots[0].eye=[1,2,NaN],p=>p.shots[0].endEye=[3,Infinity,7],p=>p.shots[0].endTarget=[1,'2',2],
    p=>p.shots[0].endEye[1]=.2,p=>p.shots[0].endEye[0]=16,p=>p.shots[0].endTarget.push(0),
    p=>p.shots[0].eye.extra=true,p=>p.shots.extra=true,p=>p.actors[0].name='',p=>p.shots[0].duration=0]){
    const p=film(linear());mutate(p);assert.throws(()=>model.validateProject(p));
  }
  let reads=0;const p=film(linear());Object.defineProperty(p.shots[0],'fov',{enumerable:true,get(){reads++;return 40;}});
  assert.throws(()=>model.validateProject(p));assert.equal(reads,0);
});
test('translation, pan, dolly and constant-relative paths remain valid without endpoint aliasing',()=>{
  for(const shot of [linear(),linear({eye:[0,2,5],endEye:[0,2,5],target:[0,1,0],endTarget:[3,1,0]}),
    linear({eye:[0,2,8],endEye:[0,2,3],target:[0,1,0],endTarget:[0,1,0]}),
    linear({eye:[2,2,4],target:[0,1,0],endEye:[5,4,7],endTarget:[3,3,3]}),
    linear({endEye:[1,2,5],endTarget:[0,1,0]})]){
    const p=film(shot),next=model.validateProject(p);assert.deepEqual(next.shots[0],shot);
    next.shots[0].endEye[0]=10;assert.notDeepEqual(next.shots[0].endEye,p.shots[0].endEye);
  }
});
test('valid endpoints cannot conceal a coincident XYZ midpoint',()=>{
  assert.doesNotThrow(()=>model.validateProject(film(path([1,0,1],[-1,0,1]))));
  assert.throws(()=>model.validateProject(film(path([1,0,0],[-1,0,0]))),/camera|path/i);
});
test('horizontal clearance has its own minimum even when the XYZ minimum is safe elsewhere',()=>{
  // XYZ minimizes at u=0, while XZ vanishes at u=1/2.
  assert.doesNotThrow(()=>model.validateProject(film(path([1,1,.2],[-1,3,.2]))));
  assert.throws(()=>model.validateProject(film(path([1,1,0],[-1,3,0]))),/camera|path/i);
});
test('analytic validation catches an off-center near-collision that endpoint/midpoint samples miss',()=>{
  assert.doesNotThrow(()=>model.validateProject(film(path([1,0,.31],[-3,0,.31]))));
  // u=1/4 has distance .11 (<.3), though both endpoints and u=1/2 exceed .3.
  assert.throws(()=>model.validateProject(film(path([1,0,.11],[-3,0,.11]))),/camera|path/i);
});
test('represented exact XYZ/XZ thresholds are inclusive without epsilon widening',()=>{
  for(const clearance of [.3,.3+Number.EPSILON])assert.doesNotThrow(()=>model.validateProject(film(path([1,0,clearance],[-1,0,clearance]))));
  assert.throws(()=>model.validateProject(film(path([1,0,.3-Number.EPSILON],[-1,0,.3-Number.EPSILON]))));
  for(const clearance of [.1,.1+Number.EPSILON])assert.doesNotThrow(()=>model.validateProject(film(path([1,1,clearance],[-1,1,clearance]))));
  assert.throws(()=>model.validateProject(film(path([1,1,.1-Number.EPSILON],[-1,1,.1-Number.EPSILON]))));
  assert.doesNotThrow(()=>model.validateProject(film(path([.3,0,0],[1,0,0]))));
  assert.doesNotThrow(()=>model.validateProject(film(path([1,0,0],[.3,0,0]))));
});
test('camera evaluation has exact detached authored endpoints, interior positions and fixed lens',()=>{
  const shot=linear(),before=structuredClone(shot);
  assert.deepEqual(model.cameraAt(shot,-1),{eye:[1,2,5],target:[0,1,0],fov:40});
  assert.deepEqual(model.cameraAt(shot,2),{eye:[2,3,6],target:[.5,1.5,1],fov:40});
  assert.deepEqual(model.cameraAt(shot,4),{eye:[3,4,7],target:[1,2,2],fov:40});
  assert.deepEqual(model.cameraAt(shot,100),model.cameraAt(shot,4));
  const start=model.cameraAt(shot,0),end=model.cameraAt(shot,4);start.eye[0]=10;end.target[0]=10;assert.deepEqual(shot,before);
  for(const time of [-100,0,2,100])assert.deepEqual(model.cameraAt(staticShot(),time),{eye:[1,2,5],target:[0,1,0],fov:40});
});
test('camera evaluation admits only canonical v2 shots and validates the whole path before sampling',()=>{
  assert.deepEqual(model.cameraAt(linear(),0).eye,[1,2,5]);
  assert.throws(()=>model.cameraAt(legacy().shots[0],0));
  assert.throws(()=>model.cameraAt(path([1,0,0],[-1,0,0]),0));
});
test('time APIs reject coercion and nonfinite values instead of selecting arbitrary frames',()=>{
  const p=film(linear());assert.equal(model.shotAt(p,0).index,0);assert.deepEqual(model.frameAt(p,0).camera.eye,[1,2,5]);
  for(const time of [NaN,Infinity,-Infinity,'0',null,undefined,true,{},[]]){
    assert.throws(()=>model.shotAt(p,time));assert.throws(()=>model.cameraAt(p.shots[0],time));assert.throws(()=>model.frameAt(p,time));
  }
});
test('cumulative fractional cuts select the next shot exactly, with exact final endpoint clamping',()=>{
  const p=film(linear({duration:1.1}));p.shots.push({...staticShot(),name:'Second',duration:1.2},{...linear(),name:'Third',duration:1.3});
  for(const [time,index,local] of [[-10,0,0],[0,0,0],[1.1,1,0],[1.1+1.2,2,0],[model.totalDuration(p),2,1.3],[100,2,1.3]]){
    const selected=model.shotAt(p,time);assert.equal(selected.index,index);assert.equal(selected.local,local);assert.equal(selected.shot,p.shots[index]);
    const frame=model.frameAt(p,time);assert.equal(frame.index,index);assert.equal(frame.local,local);assert.deepEqual(frame.camera,model.cameraAt(p.shots[index],local));
  }
  const frame=model.frameAt(p,1.1+1.2);frame.shot.eye[0]=9;frame.camera.target[0]=9;assert.equal(p.shots[2].eye[0],1);assert.equal(p.shots[2].target[0],0);
});
