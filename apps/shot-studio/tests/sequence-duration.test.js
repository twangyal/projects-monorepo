// Adapted public-API regressions for the independently reviewed concurrent
// duration repair; source clock/prefix expectations remain in sequence-oracle.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/model.js';
import {SequenceHistory} from '../src/sequence-store.js';
import {validateSequence,sequenceDuration,moveSequenceClip,prepareSequence} from '../src/sequence.js';

function fullSequence(first=1.3,second=4.7){
  const film=createProject();film.shots[0].duration=first;film.shots[1].duration=second;
  return {schemaVersion:3,kind:'shot-studio-sequence',title:'Exact fractional sixty',
    sources:[{id:'source',label:'Fractional shots',film}],
    clips:Array.from({length:20},(_,i)=>({id:`clip-${i}`,sourceId:'source',shotIndex:i%2,label:`Clip ${i}`,inTime:0,outTime:i%2?second:first}))};
}

test('moving an unchanged sixty-second fractional cut remains admitted and reversible',()=>{
  const original=fullSequence(),before=JSON.stringify(original);
  assert.equal(sequenceDuration(original),60);
  const moved=moveSequenceClip(original,'clip-11',1);
  assert.equal(sequenceDuration(moved),60);assert.deepEqual(validateSequence(moved),moved);
  assert.equal(JSON.stringify(original),before);
  const history=new SequenceHistory(original);history.commit(moved);
  history.undo();assert.deepEqual(history.current,original);
  history.redo();assert.deepEqual(history.current,moved);
});

test('duration admission is unchanged through every adjacent move and arbitrary clip order',()=>{
  const original=fullSequence();
  for(let i=0;i<19;i++){
    const moved=moveSequenceClip(original,`clip-${i}`,1);
    assert.equal(sequenceDuration(moved),60);
    const prepared=prepareSequence(moved),last=moved.clips[19];
    assert.equal(prepared.duration,60);
    assert.equal(prepared.frameAt(60).clipLocal,original.sources[0].film.shots[last.shotIndex].duration);
    assert.equal(prepared.frameAt(60).sequenceTime,60);
  }
  const grouped={...original,clips:[...original.clips].sort((a,b)=>a.shotIndex-b.shotIndex)};
  assert.equal(sequenceDuration(grouped),60);
  assert.equal(sequenceDuration({...grouped,clips:[...grouped.clips].reverse()}),60);
});

test('accurate fractional totals preserve smaller values and refuse an actual represented excess',()=>{
  const exact=fullSequence(),film=structuredClone(exact.sources[0].film);
  film.shots[1].duration=4.700000000000001;
  const excess={...exact,sources:[{...exact.sources[0],film}],clips:exact.clips.map(clip=>clip.shotIndex===1?{...clip,outTime:4.700000000000001}:{...clip})};
  for(const clips of [excess.clips,[...excess.clips].reverse(),[...excess.clips].sort((a,b)=>a.shotIndex-b.shotIndex)]){
    assert.throws(()=>validateSequence({...excess,clips}),/60 seconds/);
  }
  assert.equal(sequenceDuration({...exact,clips:exact.clips.slice(0,2)}),6);
});

test('independent grouped 3.1/2.9 oracle: both orders have exact sixty and final authored endpoints',()=>{
  const input=fullSequence(3.1,2.9),grouped={...input,
    clips:[...input.clips].sort((a,b)=>a.shotIndex-b.shotIndex)};
  for(const value of [grouped,{...grouped,clips:[...grouped.clips].reverse()}]){
    const before=JSON.stringify(value);assert.equal(sequenceDuration(value),60);
    const prepared=prepareSequence(value),last=value.clips.at(-1);
    assert.equal(prepared.duration,60);assert.equal(prepared.frameAt(60).sequenceTime,60);
    assert.equal(prepared.frameAt(60).clipLocal,last.shotIndex===0?3.1:2.9);
    assert.equal(JSON.stringify(value),before);
  }
});
