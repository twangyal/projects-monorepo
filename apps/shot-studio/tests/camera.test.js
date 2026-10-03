import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraFromPose,createProject} from '../src/model.js';
import {ProjectHistory} from '../src/history.js';
const pose=()=>[1,0,0,0,0,1,0,0,0,0,1,0,1,2,5,1];
test('headset camera uses world position and normalized negative Z forward',()=>{
  const m=pose(),before=[...m];
  assert.deepEqual(cameraFromPose(new Float32Array(m)),{eye:[1,2,5],target:[1,2,2]});
  assert.deepEqual(m,before);m[8]=2;m[10]=0;
  assert.deepEqual(cameraFromPose(m),{eye:[1,2,5],target:[-2,2,5]});
  m[8]=0;m[9]=.5;m[10]=Math.sqrt(.75);
  assert.equal(cameraFromPose(m).target[1],.5);
});
test('missing, nonfinite, vertical and out-of-bounds tracking cannot make a camera',()=>{
  const vertical=pose();vertical[9]=1;vertical[10]=0;
  const outside=pose();outside[12]=16;
  const below=pose();below[13]=.2;
  const bad=pose();bad[0]=NaN;
  for(const m of [null,[],bad,vertical,outside,below])assert.throws(()=>cameraFromPose(m),/camera|tracking/i);
});
test('a captured camera retains shot metadata, persists as a snapshot and is reversible',()=>{
  const p=createProject(),history=new ProjectHistory(p),candidate=history.current;
  Object.assign(candidate.shots[1],cameraFromPose(pose()));
  const film=history.commit(candidate);
  assert.equal(film.shots[1].name,p.shots[1].name);assert.equal(film.shots[1].duration,4);assert.equal(film.shots[1].fov,40);
  assert.deepEqual(history.undo(),p);assert.deepEqual(history.redo(),film);
  assert.deepEqual(JSON.parse(JSON.stringify(film)),film);
});
