import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewedPassage as apply } from '../src/automatic-review.ts';
const current = () => [{start:0,end:1,text:'Corrected intro'},{start:2,end:3,text:'old A'},{start:3,end:5,text:'old B'},{start:7,end:8,text:'Corrected ending'}];
const rows = () => [{start:'',end:'1',text:'Invalid outside draft'},{start:'2',end:'4',text:'New chorus A'},{start:'4',end:'5',text:'New chorus B'}];
test('a regrouped passage replaces several current cues and leaves outside corrections detached and unchanged', () => {
  const cues = current(), draft = rows(), before = structuredClone({cues,draft});
  const result = apply(cues,draft,1,2,10);
  assert.deepEqual(result,{cues:[{start:0,end:1,text:'Corrected intro'},{start:2,end:4,text:'New chorus A'},{start:4,end:5,text:'New chorus B'},{start:7,end:8,text:'Corrected ending'}],index:1,removed:2,start:2,end:5,changed:true});
  result.cues[0].text='changed detached result';
  assert.deepEqual({cues,draft},before);
});
test('passage refuses to cut through either current boundary but accepts touching endpoints', () => {
  for (const [start,end] of [['2.5','5'],['2','4.5']]) assert.throws(()=>apply(current(),[{start,end,text:'cut'}],0,0,10),/cuts through.*current line/i);
  assert.equal(apply(current(),[{start:'1',end:'2',text:'gap'}],0,0,10).removed,0);
});
test('excluded rows do not enlarge replacement range and all-excluded passages cannot delete cues', () => {
  const draft=[{start:'',end:'',text:'',excluded:true},{start:'2',end:'5',text:'Chorus'},{start:'7',end:'9',text:'not included',excluded:true}];
  const result=apply(current(),draft,0,2,10);
  assert.equal(result.start,2);assert.equal(result.end,5);assert.equal(result.cues.at(-1)?.text,'Corrected ending');
  assert.throws(()=>apply(current(),draft,0,0,10),/Include at least one/);
});
test('selected invalid rows and invalid selections refuse without normalizing raw drafts', () => {
  for (const [first,last] of [[-1,1],[1,4],[2,1],[0.5,1]]) assert.throws(()=>apply(current(),rows(),first,last,10),/Choose.*passage/);
  for (const patch of [{start:''},{end:'11'},{text:''},{end:'2'}]) {
    const draft=rows(); Object.assign(draft[1],patch); const before=structuredClone(draft);
    assert.throws(()=>apply(current(),draft,1,2,10),/Line 2/);assert.deepEqual(draft,before);
  }
  assert.throws(()=>apply([{start:0,end:2,text:'a'},{start:1,end:3,text:'b'}],rows(),1,2,10),/current lyrics/);
});
test('unchanged passage does not create an edit and insertions respect final cue count limits', () => {
  const unchanged=apply(current(),[{start:'2',end:'3',text:'old A'},{start:'3',end:'5',text:'old B'}],0,1,10);
  assert.equal(unchanged.changed,false);
  const cues=Array.from({length:200},(_,i)=>({start:i*2,end:i*2+1,text:`Line ${i}`}));
  assert.throws(()=>apply(cues,[{start:'1',end:'2',text:'extra'}],0,0,400),/200/);
});
