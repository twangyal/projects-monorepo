import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/model.js';

// Independent fixtures and literal expected results were authored from the
// reviewed contract, without reading the new producer camera implementation.
function staticShot(change={}){
  return {name:'Static original',duration:4,eye:[0,2,6],target:[0,1,0],fov:50,cameraMode:'static',...change};
}
function travel(change={}){
  return {name:'Original truck',duration:4,eye:[-2,2.2,8],target:[-2,1.15,0],fov:50,
    cameraMode:'linear',endEye:[2,2.2,8],endTarget:[2,1.15,0],...change};
}
function project(shots=[travel()]){
  return {schemaVersion:2,title:'Independent camera film',light:1,
    actors:[{name:'Red',x:-1.25,z:0,color:'#ff0000',action:'idle'},
      {name:'Green',x:1.25,z:0,color:'#00ff00',action:'idle'}],shots};
}
function legacy(){
  const p=project([staticShot(),staticShot({name:'Second original',duration:3,eye:[3,2,5],fov:40})]);
  p.schemaVersion=1;
  for(const shot of p.shots)delete shot.cameraMode;
  return p;
}
function validGate(){assert.doesNotThrow(()=>model.validateProject(project()));}

test('oracle publishes canonical camera APIs and preserves original static migration',()=>{
  assert.equal(model.SCHEMA_VERSION,2);
  assert.equal(typeof model.cameraAt,'function');assert.equal(typeof model.frameAt,'function');
  const old=legacy(),before=structuredClone(old),canonical=model.validateProject(old);
  assert.equal(canonical.schemaVersion,2);
  assert.deepEqual(canonical,{...before,schemaVersion:2,shots:before.shots.map(shot=>({...shot,cameraMode:'static'}))});
  assert.deepEqual(model.importProject(JSON.stringify(old)),canonical);
  assert.deepEqual(old,before);
  assert.notEqual(canonical.shots[0].eye,old.shots[0].eye);
  assert.equal(model.createProject().schemaVersion,2);
  assert.ok(model.createProject().shots.every(shot=>shot.cameraMode==='static'&&!('endEye' in shot)));
});

test('oracle strictly refuses motion-bearing or undocumented-key v1 films',()=>{
  assert.equal(model.validateProject(legacy()).schemaVersion,2);
  const changes=[
    p=>p.shots[0].cameraMode='linear',p=>p.shots[0].cameraMode='static',
    p=>p.shots[0].endEye=[1,2,5],p=>p.shots[0].endTarget=[0,1,0],
    p=>p.shots[0].undocumented=true,p=>p.actors[0].undocumented=true,p=>p.undocumented=true,
    p=>p.schemaVersion=3,p=>p.schemaVersion='1',
  ];
  for(const change of changes){
    const value=legacy();change(value);const original=structuredClone(value);
    assert.throws(()=>model.validateProject(value));assert.throws(()=>model.importProject(JSON.stringify(value)));
    assert.deepEqual(value,original);
  }
});

test('oracle evaluates exact linear endpoints and hand-worked interior positions with fixed lens',()=>{
  const shot=travel({duration:8,eye:[-2,2,8],target:[-2,1,0],endEye:[2,4,6],endTarget:[1,2,-2],fov:37});
  const before=structuredClone(shot);
  const cases=[
    [-100,[-2,2,8],[-2,1,0]],[0,[-2,2,8],[-2,1,0]],
    [2,[-1,2.5,7.5],[-1.25,1.25,-.5]],[4,[0,3,7],[-.5,1.5,-1]],
    [6,[1,3.5,6.5],[.25,1.75,-1.5]],[8,[2,4,6],[1,2,-2]],[100,[2,4,6],[1,2,-2]],
  ];
  for(const [time,eye,target] of cases){
    const result=model.cameraAt(shot,time);
    assert.deepEqual(result,{eye,target,fov:37});
    assert.notEqual(result.eye,shot.eye);assert.notEqual(result.eye,shot.endEye);
    assert.notEqual(result.target,shot.target);assert.notEqual(result.target,shot.endTarget);
  }
  assert.deepEqual(shot,before);
});

test('oracle static and identical-endpoint travel ignore progress but detach every result',()=>{
  const staticCamera=staticShot(),identical=travel({eye:[.5,1,0],target:[0,1,0],endEye:[.5,1,0],endTarget:[0,1,0]});
  for(const shot of [staticCamera,identical]){
    const first=model.cameraAt(shot,-1),second=model.cameraAt(shot,2),last=model.cameraAt(shot,99);
    assert.deepEqual(first,second);assert.deepEqual(second,last);
    first.eye[0]=12;first.target[2]=-12;
    assert.deepEqual(model.cameraAt(shot,2),second);
    assert.notEqual(second.eye,last.eye);assert.notEqual(second.target,last.target);
  }
});

test('oracle zero relative delta permits both eye and target to translate together',()=>{
  const shot=travel({eye:[.5,1,0],target:[0,1,0],endEye:[3.5,4,2],endTarget:[3,4,2]});
  assert.doesNotThrow(()=>model.validateProject(project([shot])));
  assert.deepEqual(model.cameraAt(shot,2),{eye:[2,2.5,1],target:[1.5,2.5,1],fov:50});
});

test('oracle valid endpoints cannot hide an eye-target collision in the middle',()=>{
  validGate();
  const unsafe=travel({eye:[-1,1,0],target:[0,1,0],endEye:[1,1,0],endTarget:[0,1,0]});
  // Endpoint distances are both 1; relative vector at u=.5 is exactly zero.
  assert.doesNotThrow(()=>model.validateProject(project([staticShot({eye:unsafe.eye,target:unsafe.target})])));
  assert.doesNotThrow(()=>model.validateProject(project([staticShot({eye:unsafe.endEye,target:unsafe.endTarget})])));
  assert.throws(()=>model.validateProject(project([unsafe])));
  assert.throws(()=>model.cameraAt(unsafe,0));
});

test('oracle horizontal midpoint singularity rejects even with safe full 3D distance',()=>{
  validGate();
  const unsafe=travel({eye:[-1,3,0],target:[0,1,0],endEye:[1,3,0],endTarget:[0,1,0]});
  // r(u)=[-1+2u,2,0]; minimum XYZ=2 while minimum XZ=0.
  assert.throws(()=>model.validateProject(project([unsafe])));
  assert.throws(()=>model.cameraAt(unsafe,4));
});

test('oracle XYZ and XZ must be minimized at their own different times',()=>{
  validGate();
  const unsafe=travel({eye:[-1,1,.099],target:[0,2,0],endEye:[1,5,.099],endTarget:[0,2,0]});
  // r0=[-1,-1,.099], d=[2,4,0]. XYZ minimum at .3 has
  // r=[-.4,.2,.099] (norm >.3); XZ minimum at .5 is .099.
  assert.ok(Math.hypot(-.4,.2,.099)>.3);
  assert.throws(()=>model.validateProject(project([unsafe])));
  const safe={...unsafe,eye:[-1,1,.1],endEye:[1,5,.1]};
  assert.doesNotThrow(()=>model.validateProject(project([safe])));
});

test('oracle an off-center horizontal minimum catches paths that endpoint/midpoint sampling misses',()=>{
  validGate();
  const unsafe=travel({eye:[-.4,2,.099],target:[0,1,0],endEye:[.6,2,.099],endTarget:[0,1,0]});
  // XZ minimum at u=.4 is .099; both endpoints and u=.5 exceed .1.
  assert.ok(Math.hypot(.1,.099)>.1);
  assert.throws(()=>model.validateProject(project([unsafe])));
  assert.doesNotThrow(()=>model.validateProject(project([{...unsafe,eye:[-.4,2,.1],endEye:[.6,2,.1]}])));
});

test('oracle XYZ clearance can fail while horizontal clearance stays above its limit',()=>{
  validGate();
  const unsafe=travel({eye:[-1,1.1,.15],target:[0,1,0],endEye:[1,1.1,.15],endTarget:[0,1,0]});
  // At u=.5, horizontal=.15>.1 but full distance sqrt(.1²+.15²)<.3.
  assert.ok(Math.hypot(.1,.15)<.3);
  assert.throws(()=>model.validateProject(project([unsafe])));
});

test('oracle direct inclusive thresholds reject represented values just below each bound',()=>{
  validGate();
  for(const [eye,target] of [[[.3,1,0],[0,1,0]],[[.1,2,0],[0,1,0]]]){
    assert.doesNotThrow(()=>model.validateProject(project([staticShot({eye,target})])));
  }
  for(const [eye,target] of [[[.3-1e-10,1,0],[0,1,0]],[[.1-1e-10,2,0],[0,1,0]]]){
    assert.throws(()=>model.validateProject(project([staticShot({eye,target})])));
  }
  const tangent=travel({eye:[.3,1,0],target:[0,2,0],endEye:[.3,3,0],endTarget:[0,2,0]});
  assert.doesNotThrow(()=>model.validateProject(project([tangent])));
  const near={...tangent,eye:[.3-1e-10,1,0],endEye:[.3-1e-10,3,0]};
  assert.throws(()=>model.validateProject(project([near])));
});

test('oracle clamped endpoint minima and convex coordinate/floor limits remain enforced',()=>{
  validGate();
  const away=travel({eye:[.31,1,0],target:[0,1,0],endEye:[2,1,0],endTarget:[0,1,0]});
  const toward={...away,eye:[2,1,0],endEye:[.31,1,0]};
  assert.doesNotThrow(()=>model.validateProject(project([away,toward])));
  assert.throws(()=>model.validateProject(project([{...away,eye:[.299,1,0]}])));
  assert.throws(()=>model.validateProject(project([{...toward,endEye:[.299,1,0]}])));
  const extremes=travel({eye:[-15,.3,15],target:[15,.3,-15],endEye:[15,15,15],endTarget:[-15,15,-15],fov:80});
  assert.doesNotThrow(()=>model.validateProject(project([extremes])));
  assert.throws(()=>model.validateProject(project([{...extremes,endEye:[15.001,15,15]}])));
  assert.throws(()=>model.validateProject(project([{...extremes,endTarget:[-15,.299,-15]}])));
});

test('oracle standalone camera requires complete canonical v2 shape and validates the whole path',()=>{
  assert.doesNotThrow(()=>model.cameraAt(travel(),0));
  const hole=[0,2,6];delete hole[1];
  const cases=[
    staticShot({endEye:[0,2,5]}),staticShot({endTarget:undefined}),staticShot({extra:true}),
    travel({cameraMode:'spline'}),travel({cameraMode:undefined}),travel({endEye:undefined}),
    travel({endTarget:undefined}),travel({endEye:[0,NaN,5]}),travel({endEye:hole}),
    travel({endEye:[0,'2',5]}),travel({eye:[0,2,6,1]}),travel({duration:0}),travel({fov:81}),
    legacy().shots[0],
  ];
  for(const shot of cases){const before=structuredClone(shot);assert.throws(()=>model.cameraAt(shot,0));assert.deepEqual(shot,before);}
});

test('oracle all public time APIs reject coercion and nonfinite time, even for static cameras',()=>{
  const p=project([staticShot()]);assert.doesNotThrow(()=>model.frameAt(p,0));
  for(const time of [undefined,null,'1',true,NaN,Infinity,-Infinity,{},[]]){
    assert.throws(()=>model.cameraAt(p.shots[0],time));
    assert.throws(()=>model.frameAt(p,time));
    assert.throws(()=>model.shotAt(p,time));
  }
});

test('oracle exact cuts select next Start, while exact final clamp returns authored End',()=>{
  const p=project([travel({duration:2}),travel({duration:3,eye:[1,2,6],target:[0,1,0],endEye:[3,2,6],endTarget:[2,1,0]})]);
  const cases=[[-10,0,0],[0,0,0],[1,0,1],[2,1,0],[4,1,2],[5,1,3],[100,1,3]];
  for(const [time,index,local] of cases){
    const selected=model.shotAt(p,time),frame=model.frameAt(p,time);
    assert.equal(selected.index,index);assert.equal(selected.local,local);assert.equal(selected.shot,p.shots[index]);
    assert.equal(frame.index,index);assert.equal(frame.local,local);
    assert.deepEqual(frame.camera,model.cameraAt(p.shots[index],local));
  }
  assert.deepEqual(model.frameAt(p,2).camera,{eye:[1,2,6],target:[0,1,0],fov:50});
  assert.deepEqual(model.frameAt(p,5).camera,{eye:[3,2,6],target:[2,1,0],fov:50});
});

test('oracle cumulative fractional cut 1.1+1.2 belongs exactly to shot three',()=>{
  const p=project([travel({duration:1.1}),travel({duration:1.2}),travel({duration:1.3})]);
  const boundary=1.1+1.2,total=1.1+1.2+1.3;
  const selected=model.shotAt(p,boundary);
  assert.equal(selected.index,2);assert.equal(selected.local,0);
  const frame=model.frameAt(p,boundary);
  assert.equal(frame.index,2);assert.equal(frame.local,0);
  assert.equal(model.shotAt(p,boundary-1e-12).index,1);
  assert.equal(model.shotAt(p,total).local,1.3);
  assert.equal(model.frameAt(p,total+100).local,1.3);
  assert.deepEqual(model.frameAt(p,total).camera,{eye:[2,2.2,8],target:[2,1.15,0],fov:50});
});

test('oracle frame and camera objects detach caller input while shotAt keeps its reference contract',()=>{
  const p=project(),before=structuredClone(p),frame=model.frameAt(p,2),again=model.frameAt(p,2);
  assert.notEqual(frame.shot,p.shots[0]);assert.notEqual(frame.shot.eye,p.shots[0].eye);
  assert.notEqual(frame.camera.eye,frame.shot.eye);assert.notEqual(frame.camera.target,frame.shot.target);
  frame.shot.endEye[0]=15;frame.camera.eye[0]=-15;frame.camera.target[1]=14;
  assert.deepEqual(p,before);assert.deepEqual(model.frameAt(p,2),again);
  assert.equal(model.shotAt(p,2).shot,p.shots[0]);
});

test('oracle canonical travel honors 20-shot/60-second bounds and exact UTF8 backup admission',()=>{
  const p=project(Array.from({length:20},(_,index)=>travel({name:`Shot ${index+1}`,duration:3})));
  const valid=model.validateProject(p);assert.equal(valid.shots.length,20);assert.equal(model.totalDuration(valid),60);
  assert.throws(()=>model.validateProject(project([...p.shots,travel({duration:1})])));
  assert.throws(()=>model.validateProject(project(p.shots.map((shot,index)=>index===0?{...shot,duration:3.001}:shot))));
  const padded=JSON.stringify(valid).padEnd(65536,' ');
  assert.equal(new TextEncoder().encode(padded).length,65536);
  assert.deepEqual(model.importProject(padded),valid);assert.throws(()=>model.importProject(padded+' '));
});
