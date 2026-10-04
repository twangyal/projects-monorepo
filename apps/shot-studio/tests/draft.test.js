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
