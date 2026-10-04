import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';
import {ProjectHistory,moveShot} from '../src/history.js';

const originalActors=()=>[
  {name:'Mika',x:-1.2,z:0,color:'#db825c',action:'wave'},
  {name:'Noor',x:1.2,z:-1,color:'#6cb1ba',action:'walk'},
];
function original(version){
  const shot={name:'Authored camera',duration:4,eye:[0,2,6],target:[0,1,0],fov:40};
  if(version===2)Object.assign(shot,{cameraMode:'linear',endEye:[2,2,6],endTarget:[2,1,0]});
  return {schemaVersion:version,title:'Original film',light:1,actors:originalActors(),shots:[shot]};
}
const cue=(time,x=0,action='idle',visible=true,z=0)=>({time,x,z,action,visible});
function blocking(cues=[cue(0),cue(4,2,'wave')]){
  const p=model.createProject();
  p.actors[0]={name:'Authored mover',color:'#ff0000',performanceMode:'blocking',cues};
  return p;
}
function unchanged(input,operation){
  const before=structuredClone(input);
  assert.throws(operation);
  assert.deepEqual(input,before);
}

test('starter schema3 retains both original looping performances and camera settings',()=>{
  const p=model.createProject();
  assert.equal(model.SCHEMA_VERSION,3);assert.equal(p.schemaVersion,3);
  assert.equal(model.MAX_PERFORMER_CUES,32);
  assert.deepEqual(p.actors,originalActors().map(a=>({...a,performanceMode:'loop'})));
  assert.deepEqual(model.validateProject(p),p);
  assert.deepEqual(p.shots.map(s=>[s.cameraMode,s.duration]),[['static',4],['static',4]]);
});

test('genuine original-key version1 and version2 migrate detached without losing camera travel',()=>{
  for(const version of [1,2]){
    const p=original(version),before=structuredClone(p),next=model.validateProject(p);
    assert.equal(next.schemaVersion,3);
    assert.deepEqual(next.actors,originalActors().map(a=>({...a,performanceMode:'loop'})));
    assert.deepEqual(next.shots,[version===1?{...p.shots[0],cameraMode:'static'}:p.shots[0]]);
    assert.deepEqual(model.importProject(JSON.stringify(p)),next);
    next.actors[0].x=4;next.shots[0].eye[0]=10;
    if(version===2)next.shots[0].endEye[0]=10;
    assert.deepEqual(p,before);
  }
});

test('legacy schemas reject new performer fields and future versions instead of stripping them',()=>{
  for(const version of [1,2])for(const patch of [{performanceMode:'loop'},{cues:[cue(0)]},{visible:true}]){
    const p=original(version);Object.assign(p.actors[0],patch);
    unchanged(p,()=>model.validateProject(p));
    assert.throws(()=>model.importProject(JSON.stringify(p)));
  }
  unchanged(original(4),()=>model.validateProject(original(4)));
  const v1=original(1);v1.shots[0].cameraMode='static';
  unchanged(v1,()=>model.validateProject(v1));
});

test('canonical actor modes admit only their exact keys and retain original field bounds',()=>{
  assert.deepEqual(model.validateProject(blocking()).actors[0].cues,[cue(0),cue(4,2,'wave')]);
  for(const change of [p=>delete p.actors[1].performanceMode,p=>p.actors[0].performanceMode='linear',
    p=>p.actors[0].x=0,p=>p.actors[0].action='idle',p=>p.actors[1].cues=[cue(0)],
    p=>p.actors[0].name='',p=>p.actors[0].color='red',p=>p.actors[0].cues[0].extra=true,
    p=>p.actors[0].cues[0].visible=1,p=>p.actors[0].cues[0].action='run',
    p=>p.actors[0].cues[0].x=4.001,p=>p.actors[0].cues[0].z=-4.001,
    p=>delete p.actors[1],p=>delete p.actors[0].cues[1]]){
    const p=blocking();change(p);unchanged(p,()=>model.validateProject(p));
  }
  let reads=0;const p=blocking();
  Object.defineProperty(p.actors[0].cues[0],'x',{enumerable:true,get(){reads++;return 0;}});
  assert.throws(()=>model.validateProject(p));assert.equal(reads,0);
});

test('cue times are exact globally ordered numbers with first0 and inclusive film end',()=>{
  assert.deepEqual(model.validateProject(blocking([cue(0,-4),cue(.123456789,4),cue(8,1)])).actors[0].cues,
    [cue(0,-4),cue(.123456789,4),cue(8,1)]);
  for(const cues of [[],[cue(.001)],[cue(0),cue(2),cue(1)],[cue(0),cue(2),cue(2)],
    [cue(0),cue(-1)],[cue(0),cue(8.000000000000002)],[cue(0),cue(NaN)],
    [cue(0),cue(Infinity)],[cue(0),cue('1')]]){
    const p=blocking(cues);unchanged(p,()=>model.validateProject(p));
  }
  const fractional=blocking([cue(0),cue(1.1+1.2)]);
  fractional.shots=[{...fractional.shots[0],duration:1.1},{...fractional.shots[1],duration:1.2}];
  assert.equal(model.validateProject(fractional).actors[0].cues[1].time,1.1+1.2);
});

test('exact32-cue maximum survives and a33rd cue or sparse/accessor collection rejects',()=>{
  const cues=Array.from({length:32},(_,i)=>cue(i*.25,i%2));
  assert.equal(model.validateProject(blocking(cues)).actors[0].cues.length,32);
  unchanged(blocking([...cues,cue(8)]),()=>model.validateProject(blocking([...cues,cue(8)])));
  const p=blocking();p.actors[0].cues.extra=1;
  assert.throws(()=>model.validateProject(p));
  const inherited=blocking();Object.setPrototypeOf(inherited.actors[0].cues,Object.create(Array.prototype));
  assert.throws(()=>model.validateProject(inherited));
});

test('mode conversions retain the loop base or first cue and detached identical conversion',()=>{
  const p=model.createProject(),before=structuredClone(p);
  const next=model.setPerformanceMode(p,1,'blocking');
  assert.deepEqual(next.actors[1],{name:'Noor',color:'#6cb1ba',performanceMode:'blocking',cues:[cue(0,1.2,'walk',true,-1)]});
  assert.deepEqual(p,before);
  next.actors[1].cues.push(cue(4,3,'wave',false));
  next.actors[1].cues[0].visible=false;
  const loop=model.setPerformanceMode(next,1,'loop');
  assert.deepEqual(loop.actors[1],{name:'Noor',color:'#6cb1ba',performanceMode:'loop',x:1.2,z:-1,action:'walk'});
  const identical=model.setPerformanceMode(next,1,'blocking');assert.deepEqual(identical,next);
  identical.actors[1].cues[0].x=4;assert.equal(next.actors[1].cues[0].x,1.2);
});

test('insert places one unique cue by time, reports its index and detaches caller fields',()=>{
  const p=blocking(),before=structuredClone(p),added=cue(1.25,-2,'walk',false,3);
  const result=model.insertCue(p,0,added);
  assert.equal(result.cueIndex,1);
  assert.deepEqual(result.project.actors[0].cues,[cue(0),added,cue(4,2,'wave')]);
  added.x=4;result.project.actors[0].cues[0].z=4;
  assert.equal(result.project.actors[0].cues[1].x,-2);assert.deepEqual(p,before);
  unchanged(p,()=>model.insertCue(p,0,cue(4)));
});

test('update can reorder a later cue while pinning first0 and rejecting duplicates atomically',()=>{
  const p=blocking([cue(0),cue(2,1),cue(4,2)]),before=structuredClone(p);
  const result=model.updateCue(p,0,2,cue(1,-2,'wave',false));
  assert.equal(result.cueIndex,1);assert.deepEqual(result.project.actors[0].cues,[cue(0),cue(1,-2,'wave',false),cue(2,1)]);
  assert.deepEqual(p,before);
  const first=model.updateCue(p,0,0,cue(0,-3,'walk'));
  assert.equal(first.cueIndex,0);assert.equal(first.project.actors[0].cues[0].x,-3);
  for(const [index,value] of [[0,cue(.1)],[1,cue(0)],[1,cue(4)]])unchanged(p,()=>model.updateCue(p,0,index,value));
});

test('remove picks following index or final previous index without deleting first0',()=>{
  const p=blocking([cue(0),cue(1,1),cue(3,2),cue(6,3)]),before=structuredClone(p);
  const middle=model.removeCue(p,0,1);assert.equal(middle.cueIndex,1);
  assert.deepEqual(middle.project.actors[0].cues,[cue(0),cue(3,2),cue(6,3)]);
  const last=model.removeCue(p,0,3);assert.equal(last.cueIndex,2);
  assert.deepEqual(last.project.actors[0].cues,[cue(0),cue(1,1),cue(3,2)]);
  unchanged(p,()=>model.removeCue(p,0,0));assert.deepEqual(p,before);
  assert.throws(()=>model.removeCue(blocking([cue(0)]),0,0));
});

test('invalid indices/modes/loop-cue edits and invalid source films are refused without mutation',()=>{
  const p=blocking();
  for(const index of [-1,2,.5,NaN,Infinity,'0']){
    unchanged(p,()=>model.setPerformanceMode(p,index,'loop'));
    unchanged(p,()=>model.insertCue(p,index,cue(1)));
    unchanged(p,()=>model.performerAt(p,index,0));
  }
  for(const index of [-1,2,.5,'0']){
    unchanged(p,()=>model.updateCue(p,0,index,cue(1)));
    unchanged(p,()=>model.removeCue(p,0,index));
  }
  unchanged(p,()=>model.setPerformanceMode(p,0,'wave'));
  for(const operation of [()=>model.insertCue(p,1,cue(1)),()=>model.updateCue(p,1,0,cue(0)),()=>model.removeCue(p,1,0)])assert.throws(operation,/blocking/i);
  const malformed=blocking();malformed.actors[0].cues[1].time=10;
  unchanged(malformed,()=>model.updateCue(malformed,0,1,cue(4)));
});

test('film shortening rejects orphaned cues and reordering preserves their global times',()=>{
  const p=blocking([cue(0),cue(8,2)]),history=new ProjectHistory(p),before=history.current;
  for(const next of [(()=>{const a=structuredClone(p);a.shots[0].duration=3.9;return a;})(),(()=>{const a=structuredClone(p);a.shots.pop();return a;})()]){
    assert.throws(()=>history.commit(next),/cue|blocking|film/i);
    assert.deepEqual(history.current,before);assert.equal(history.canUndo,false);
  }
  const moved=moveShot(p,0,1);assert.deepEqual(moved.actors,p.actors);
  history.commit(moved); // Same-valued camera order may be an identical edit; no hidden cue retime.
  assert.deepEqual(history.current.actors,p.actors);
});

test('performer adapter uses global time across exact cuts, clamps blocking and detaches output',()=>{
  const p=blocking([cue(0,-2,'walk'),cue(4,2,'wave'),cue(8,2,'idle',false)]),before=structuredClone(p);
  assert.deepEqual(model.performerAt(p,0,2),{x:0,z:0,arm:.5*Math.sin(10),leg:.35*Math.sin(10),visible:true,action:'walk'});
  assert.deepEqual(model.performerAt(p,0,4),{x:2,z:0,arm:.8,leg:0,visible:true,action:'wave'});
  assert.deepEqual(model.performerAt(p,0,100),{x:2,z:0,arm:0,leg:0,visible:false,action:'idle'});
  assert.equal(model.performerAt(p,0,-10).x,-2);
  const result=model.performerAt(p,0,2);result.x=4;assert.deepEqual(p,before);
  for(const time of [NaN,Infinity,'0',null])assert.throws(()=>model.performerAt(p,0,time));
});

test('legacy actorPose retains original four-field formulas for original and canonical loop actors',()=>{
  const a=originalActors()[1];
  for(const time of [-2,0,.125,60,100]){
    const expected={x:a.x+.7*Math.sin(time),z:a.z,arm:.5*Math.sin(time*5),leg:.35*Math.sin(time*5)};
    assert.deepEqual(model.actorPose(a,time),expected);
    assert.deepEqual(model.actorPose({...a,performanceMode:'loop'},time),expected);
  }
  assert.throws(()=>model.actorPose(blocking().actors[0],0),/performerAt|blocking/i);
});
