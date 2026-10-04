// Adapted from the independently authored concurrent draft tests.
// Only the production module path and current reviewed-replacement/recovery API differ.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSequence} from '../src/sequence.js';
import * as api from '../src/sequence-store.js';
test('sequence draft has a separate protected store',()=>assert.equal(typeof api.SequenceDraftStore,'function'));
const memory=initial=>{const map=new Map(initial===null?[]:[[api.SEQUENCE_DRAFT_KEY,initial]]);return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),map};};
test('valid startup reads do not write; absent draft permits first atomic save',()=>{
  const storage=memory(null),s=new api.SequenceDraftStore(()=>storage);assert.equal(storage.map.size,0);
  assert.deepEqual(s.sequence,createSequence());s.save({...s.sequence,title:'Saved'});const text=storage.getItem(api.SEQUENCE_DRAFT_KEY);
  const restored=new api.SequenceDraftStore(()=>storage);assert.equal(restored.sequence.title,'Saved');assert.equal(storage.getItem(api.SEQUENCE_DRAFT_KEY),text);
});
test('corrupt startup exact raw survives ordinary saves and failed explicit replacement',()=>{
  const raw=' {broken\n😺',storage=memory(raw),s=new api.SequenceDraftStore(()=>storage);
  assert.equal(s.blocked,true);assert.equal(s.raw,raw);assert.throws(()=>s.save(createSequence()));assert.equal(storage.getItem(api.SEQUENCE_DRAFT_KEY),raw);
  assert.deepEqual(JSON.parse(s.recoveryJson()),{kind:'shot-studio-sequence-recovery',raw});
  storage.setItem=()=>{throw Error('quota');};assert.throws(()=>s.replace(createSequence()));assert.equal(s.blocked,true);assert.equal(s.raw,raw);
});
test('failed read blocks automatic save without pretending raw recovery is available',()=>{
  let writes=0;const storage={getItem(){throw Error('denied');},setItem(){writes++;}},s=new api.SequenceDraftStore(()=>storage);
  assert.equal(s.blocked,true);assert.equal(s.raw,null);assert.throws(()=>s.save(createSequence()));assert.equal(writes,0);
  assert.throws(()=>s.recoveryJson(),/raw|known|available/i);
});
test('stale tab refuses to replace another tab’s sequence; explicit replacement requires current review',()=>{
  const storage=memory(null),a=new api.SequenceDraftStore(()=>storage),b=new api.SequenceDraftStore(()=>storage);
  a.save({...createSequence(),title:'A'});assert.throws(()=>b.save({...createSequence(),title:'B'}),/changed|conflict|another/i);
  assert.equal(b.blocked,true);assert.equal(JSON.parse(storage.getItem(api.SEQUENCE_DRAFT_KEY)).title,'A');
  const observed=storage.getItem(api.SEQUENCE_DRAFT_KEY);assert.equal(b.raw,observed);
  assert.equal(JSON.parse(b.recoveryJson()).raw,observed);
  a.save({...createSequence(),title:'A changed while B reviewed'});
  assert.throws(()=>b.replace({...createSequence(),title:'B'}),/changed|review/i);
  assert.equal(b.raw,storage.getItem(api.SEQUENCE_DRAFT_KEY));
  assert.equal(JSON.parse(storage.getItem(api.SEQUENCE_DRAFT_KEY)).title,'A changed while B reviewed');
  b.replace({...createSequence(),title:'B'});assert.equal(b.blocked,false);
  assert.equal(JSON.parse(storage.getItem(api.SEQUENCE_DRAFT_KEY)).title,'B');
});
test('successful explicit replacement enables later writes; invalid candidates never write',()=>{
  const storage=memory('broken'),s=new api.SequenceDraftStore(()=>storage);s.replace(createSequence());assert.equal(s.blocked,false);assert.equal(s.raw,null);
  s.save({...createSequence(),title:'Next'});const before=storage.getItem(api.SEQUENCE_DRAFT_KEY);assert.throws(()=>s.save({...createSequence(),title:''}));assert.equal(storage.getItem(api.SEQUENCE_DRAFT_KEY),before);
});
