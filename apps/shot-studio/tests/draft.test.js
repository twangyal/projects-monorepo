import test from 'node:test';import assert from 'node:assert/strict';
import {DraftStore,DRAFT_KEY} from '../src/draft.js';import {createProject} from '../src/model.js';
const memory=raw=>({raw,writes:0,getItem(){return this.raw;},setItem(key,value){assert.equal(key,DRAFT_KEY);this.raw=value;this.writes++;}});
test('invalid and empty drafts retain exact bytes through blocked automatic saves',()=>{
  for(const raw of ['{broken\n☃','','{"schemaVersion":99}','\ud800']){const storage=memory(raw),store=new DraftStore(()=>storage);assert.equal(store.blocked,true);assert.equal(store.raw,raw);const p=createProject();p.title='New in-memory scene';assert.throws(()=>store.save(p),/protected/);assert.equal(storage.raw,raw);assert.equal(storage.writes,0);assert.equal(store.project.title,'The arrival');}
});
test('unavailable storage reads block overwrites even if later writes would succeed',()=>{
  const storage=memory('unread');storage.getItem=()=>{throw Error('Read denied');};const store=new DraftStore(()=>storage);assert.equal(store.blocked,true);assert.equal(store.raw,null);assert.throws(()=>store.save(createProject()),/protected/);assert.equal(storage.raw,'unread');assert.equal(storage.writes,0);
  const inaccessible=new DraftStore(()=>{throw Error('Storage getter denied');});assert.equal(inaccessible.blocked,true);assert.throws(()=>inaccessible.replace(createProject()),/denied/);assert.equal(inaccessible.blocked,true);
});
test('explicit replacement validates and changes protection only after an atomic successful write',()=>{
  const storage=memory('{recover me'),store=new DraftStore(()=>storage);const p=createProject();p.title='Recovered work';storage.setItem=()=>{throw Error('Quota');};assert.throws(()=>store.replace(p),/Quota/);assert.equal(store.blocked,true);assert.equal(store.raw,'{recover me');assert.equal(storage.raw,'{recover me');
  storage.setItem=memory(null).setItem;assert.throws(()=>store.replace({...p,title:''}),/Invalid/);assert.equal(storage.raw,'{recover me');store.replace(p);assert.equal(JSON.parse(storage.raw).title,'Recovered work');assert.equal(store.blocked,false);assert.equal(store.raw,null);p.title='Later edit';store.save(p);assert.equal(JSON.parse(storage.raw).title,'Later edit');
});
test('valid drafts reopen normalized snapshots and normal saves preserve failures',()=>{
  const original=createProject(),storage=memory(JSON.stringify(original)),store=new DraftStore(()=>storage);assert.equal(store.blocked,false);assert.equal(store.raw,null);assert.deepEqual(store.project,original);store.project.title='Changed';assert.equal(JSON.parse(storage.raw).title,original.title);store.save(store.project);assert.equal(JSON.parse(storage.raw).title,'Changed');const before=storage.raw;storage.setItem=()=>{throw Error('Denied');};assert.throws(()=>store.save(createProject()),/Denied/);assert.equal(storage.raw,before);assert.equal(new DraftStore(()=>memory(null)).blocked,false);
});
const originalV1=()=>({schemaVersion:1,title:'Original static backup',light:1,
  actors:[{name:'Mika',x:-1.2,z:0,color:'#db825c',action:'wave'},{name:'Noor',x:1.2,z:-1,color:'#6cb1ba',action:'walk'}],
  shots:[{name:'Original camera',duration:4,eye:[5,3,7],target:[0,1,0],fov:45}]});
test('genuine v1 draft migrates only in memory until a successful canonical v2 write',()=>{
  const raw=JSON.stringify(originalV1(),null,2),storage=memory(raw),store=new DraftStore(()=>storage);
  assert.equal(store.blocked,false);assert.equal(store.project.schemaVersion,2);assert.equal(store.project.shots[0].cameraMode,'static');
  assert.equal(storage.raw,raw);assert.equal(storage.writes,0);
  Object.assign(store.project.shots[0],{cameraMode:'linear',endEye:[3,2,7],endTarget:[0,1,0]});
  const write=storage.setItem;storage.setItem=()=>{throw Error('Quota');};assert.throws(()=>store.save(store.project),/Quota/);
  assert.equal(storage.raw,raw);assert.equal(storage.writes,0);
  storage.setItem=write;store.save(store.project);assert.equal(storage.writes,1);
  const saved=JSON.parse(storage.raw);assert.equal(saved.schemaVersion,2);assert.deepEqual(saved,store.project);
  assert.deepEqual(new DraftStore(()=>storage).project,saved);assert.equal(storage.writes,1);
});
test('motion-bearing v1 and unsupported drafts keep exact recovery bytes until successful replacement',()=>{
  const motion=originalV1();motion.shots[0].cameraMode='linear';motion.shots[0].endEye=[3,2,7];motion.shots[0].endTarget=[0,1,0];
  for(const raw of [JSON.stringify(motion,null,2),JSON.stringify({...originalV1(),schemaVersion:3})]){
    const storage=memory(raw),store=new DraftStore(()=>storage),replacement=createProject();
    assert.equal(store.blocked,true);assert.equal(store.raw,raw);assert.equal(storage.raw,raw);assert.equal(storage.writes,0);
    assert.throws(()=>store.save(replacement),/protected/);const write=storage.setItem;storage.setItem=()=>{throw Error('Denied');};
    assert.throws(()=>store.replace(replacement),/Denied/);assert.equal(store.blocked,true);assert.equal(store.raw,raw);assert.equal(storage.raw,raw);
    storage.setItem=write;store.replace(replacement);assert.equal(store.blocked,false);assert.equal(store.raw,null);assert.equal(JSON.parse(storage.raw).schemaVersion,2);
  }
});
