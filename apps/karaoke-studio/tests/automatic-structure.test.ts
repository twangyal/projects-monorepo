import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewedSplit, applyReviewedMerge } from '../src/automatic-review.ts';

const rows=()=>[{start:'1.000',end:'4.',text:'Hello 🎵\r\nworld'}, {start:'6',end:'8e0',text:'Next lyric'}, {start:'',end:'',text:'Unfinished outside',excluded:true}];
test('a reviewed split keeps literal Unicode/CRLF, outside lyrics and raw review drafts',()=>{
  const draft=rows(),before=structuredClone(draft),current=[{start:0,end:.5,text:'Corrected intro'},{start:1,end:4,text:'Old words'},{start:9,end:10,text:'Corrected outro'}];
  const result=applyReviewedSplit(current,draft,0,9,2.5,16);
  assert.deepEqual(result.cues,[current[0],{start:1,end:2.5,text:'Hello 🎵\r\n'},{start:2.5,end:4,text:'world'},current[2]]);
  assert.equal(result.index,1);assert.equal(result.removed,1);assert.equal(result.changed,true);assert.deepEqual(draft,before);
});
test('a reviewed merge includes the gap, replaces only the window and preserves other review drafts',()=>{
  const draft=rows(),before=structuredClone(draft),current=[{start:1,end:2,text:'Wrong one'},{start:3,end:4,text:'Wrong two'},{start:5,end:5.5,text:'Inside gap'},{start:6,end:8,text:'Wrong three'},{start:10,end:11,text:'Outside correction'}];
  const result=applyReviewedMerge(current,draft,0,16);
  assert.deepEqual(result.cues,[{start:1,end:8,text:'Hello 🎵\r\nworld\nNext lyric'},current[4]]);
  assert.equal(result.removed,4);assert.deepEqual(draft,before);
});
test('excluded lines, invalid caret/playhead and partial current boundaries refuse without mutation',()=>{
  const draft=rows(),before=structuredClone(draft),current=[{start:0,end:2,text:'Crossing boundary'}];
  assert.throws(()=>applyReviewedSplit([],draft,0,7,2,16),/Unicode/);
  for(const caret of [0,99])assert.throws(()=>applyReviewedSplit([],draft,0,caret,2,16),/caret/);
  for(const time of [1,4,NaN])assert.throws(()=>applyReviewedSplit([],draft,0,6,time,16),/playhead/);
  assert.throws(()=>applyReviewedMerge([],draft,1,16),/Include.*3/);
  assert.throws(()=>applyReviewedSplit([],draft,2,3,2,16),/Include.*3/);
  assert.throws(()=>applyReviewedMerge(current,draft,0,16),/cuts through current line 1/);
  assert.throws(()=>applyReviewedSplit(current,draft,0,6,2,16),/cuts through current line 1/);
  assert.deepEqual(draft,before);assert.deepEqual(current,[{start:0,end:2,text:'Crossing boundary'}]);
});
test('oversized merges and a final 201-cue split refuse the complete edit',()=>{
  const long=[{start:'1',end:'2',text:'a'.repeat(130)},{start:'3',end:'4',text:'b'.repeat(130)}];
  assert.throws(()=>applyReviewedMerge([],long,0,16),/240/);
  const current=Array.from({length:200},(_,i)=>({start:i*2,end:i*2+1,text:'Line words'}));
  const draft=[{start:'0',end:'1',text:'First words'}];
  assert.throws(()=>applyReviewedSplit(current,draft,0,5,.5,400),/200/);
});
