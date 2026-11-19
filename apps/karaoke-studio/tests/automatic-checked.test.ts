import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCheckedReviewedLines } from '../src/automatic-review.ts';
import type { Cue } from '../src/lyrics.ts';
const current = (): Cue[] => [{start:1,end:3,text:'First',singer:1},{start:4,end:6,text:'Keep my chorus',singer:2},{start:9,end:11,text:'Last',singer:'both'}];
const rows = () => [{start:'1.000',end:'3',text:'Fixed first'},{start:'',end:'bad',text:''},{start:'9',end:'11.5',text:'Fixed last'}];

test('checked nonadjacent corrections form one detached result and preserve unselected source mapping and singers', () => {
  const cues=current(),draft=rows(),before=structuredClone({cues,draft});
  const result=applyCheckedReviewedLines(cues,draft,[2,0],16);
  assert.deepEqual(result.cues,[{start:1,end:3,text:'Fixed first',singer:1},cues[1],{start:9,end:11.5,text:'Fixed last',singer:'both'}]);
  assert.deepEqual(result.sources,[null,1,null]); assert.equal(result.replaced,2); assert.equal(result.added,0); assert.equal(result.changed,true);
  assert.deepEqual({cues,draft},before);result.cues[1].text='Detached';assert.deepEqual(cues,before.cues);
});
test('checked inserts keep gaps and touching endpoints; excluded checked rows and unfinished neighbors are left alone', () => {
  const draft=[{start:'3',end:'4',text:'Gap'},{start:'',end:'',text:'',excluded:true},{start:'6',end:'7',text:'Gap two'},...rows()];
  const result=applyCheckedReviewedLines(current(),draft,[0,1,2],16);
  assert.deepEqual(result.cues.map(cue=>cue.text),['First','Gap','Keep my chorus','Gap two','Last']);
  assert.deepEqual(result.sources,[0,null,1,null,2]); assert.equal(result.added,2); assert.equal(result.replaced,0);
  assert.throws(()=>applyCheckedReviewedLines(current(),draft,[1],16),/included/i);
});
test('the entire checked edit refuses multiple-current or shared-current overlaps without changing either input', () => {
  for(const draft of [[{start:'1',end:'3',text:'Good'},{start:'5',end:'10',text:'Too broad'}], [{start:'1',end:'2',text:'A'},{start:'2',end:'3',text:'B'}]]) {
    const cues=current(),before=structuredClone({cues,draft});
    assert.throws(()=>applyCheckedReviewedLines(cues,draft,[0,1],16),/more than one|same current line/);
    assert.deepEqual({cues,draft},before);
  }
});
test('selected rows validate together in review order and report their original row number', () => {
  const draft=rows(); draft[2].start='';
  assert.throws(()=>applyCheckedReviewedLines(current(),draft,[0,2],16),/Line 3/);
  for(const pair of [[{start:'1',end:'3',text:'A'},{start:'2',end:'4',text:'B'}],[{start:'8',end:'9',text:'A'},{start:'1',end:'2',text:'B'}]]) assert.throws(()=>applyCheckedReviewedLines([],pair,[0,1],16),/Line 2/);
  for(const indices of [[],[-1],[3],[.5],[NaN],[0,0]]) assert.throws(()=>applyCheckedReviewedLines(current(),rows(),indices,16));
});
test('no-op checked rows preserve literal current timing sources and do not request a history edit', () => {
  const cues=current(),draft=cues.map(cue=>({start:cue.start.toFixed(4),end:String(cue.end),text:cue.text}));
  const result=applyCheckedReviewedLines(cues,draft,[0,2],16);
  assert.deepEqual(result.cues,cues);assert.deepEqual(result.sources,[0,1,2]);assert.equal(result.changed,false);
});
test('invalid current lyrics and final cue/text limits refuse before returning a partial edit', () => {
  const cues=current();cues[1].start=NaN; assert.throws(()=>applyCheckedReviewedLines(cues,rows(),[0,2],16),/current lyrics/);
  const full=Array.from({length:200},(_,i)=>({start:i*2,end:i*2+1,text:'Line'}));
  assert.throws(()=>applyCheckedReviewedLines(full,[{start:'1',end:'2',text:'New'}],[0],600),/200/);
  const long=Array.from({length:100},(_,i)=>({start:i*2,end:i*2+1,text:'x'.repeat(200)}));
  assert.throws(()=>applyCheckedReviewedLines(long,[{start:'0',end:'1',text:'y'.repeat(201)}],[0],600),/20,000/);
});


test('an unchanged checked cue keeps hand-set word times when another checked cue changes', () => {
  const cues: Cue[]=[{start:0,end:2,text:'Two words',wordStarts:[.2,1.4],singer:2},{start:3,end:4,text:'Old'}];
  const result=applyCheckedReviewedLines(cues,[{start:'0.000',end:'2',text:'Two words'},{start:'3',end:'4',text:'New'}],[0,1],16);
  assert.equal(result.changed,true);assert.deepEqual(result.sources,[0,null]);
  assert.deepEqual(result.cues[0],cues[0]);assert.deepEqual(result.cues[0].wordStarts,[.2,1.4]);
  assert.deepEqual(cues[1],{start:3,end:4,text:'Old'});
});
