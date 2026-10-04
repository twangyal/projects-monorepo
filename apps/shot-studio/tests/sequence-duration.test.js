import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../src/model.js';
import {createSequence,captureSource,appendClip,moveClip,validateSequence,sequenceDuration,sequenceFrameAt,SequenceHistory} from '../src/sequence.js';

function fullSequence(second=4.7){
  const film=createProject();film.shots[0].duration=1.3;film.shots[1].duration=second;
  let cut=captureSource(createSequence(),{id:'source',name:'Fractional shots',film});
  for(let i=0;i<20;i++)cut=appendClip(cut,'source',i%2);
  return cut;
}

test('moving an unchanged sixty-second fractional cut remains admitted and reversible',()=>{
  const original=fullSequence(),before=JSON.stringify(original);
  assert.equal(sequenceDuration(original),60);
  const moved=moveClip(original,11,1);
  assert.equal(sequenceDuration(moved),60);
  assert.deepEqual(validateSequence(moved),moved);
  assert.equal(JSON.stringify(original),before);
  const history=new SequenceHistory(original);history.commit(moved);
  assert.deepEqual(history.undo(),original);assert.deepEqual(history.redo(),moved);
});

test('duration admission is unchanged through every adjacent move and arbitrary clip order',()=>{
  const original=fullSequence();
  for(let i=0;i<19;i++){
    const moved=moveClip(original,i,1);
    assert.equal(sequenceDuration(moved),60);
    assert.equal(sequenceFrameAt(moved,60).local,original.sources[0].film.shots[moved.clips[19].shotIndex].duration);
  }
  const grouped={...original,clips:[...original.clips].sort((a,b)=>a.shotIndex-b.shotIndex)};
  assert.equal(sequenceDuration(grouped),60);
  assert.equal(sequenceDuration({...grouped,clips:[...grouped.clips].reverse()}),60);
});

test('accurate fractional totals preserve smaller values and refuse an actual represented excess',()=>{
  const exact=fullSequence(),film=structuredClone(exact.sources[0].film);
  film.shots[1].duration=4.700000000000001;
  const excess={...exact,sources:[{...exact.sources[0],film}]};
  for(const clips of [excess.clips,[...excess.clips].reverse(),[...excess.clips].sort((a,b)=>a.shotIndex-b.shotIndex)]){
    assert.throws(()=>validateSequence({...excess,clips}),/60 seconds/);
  }
  assert.equal(sequenceDuration({...exact,clips:exact.clips.slice(0,2)}),6);
});
