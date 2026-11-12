import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewedPreview } from '../src/automatic-review.ts';
test('preview validates only included selected rows and maps them back to review indices',()=>{
  const rows=[{start:'',end:'',text:''},{start:'1',end:'2',text:'Excluded',excluded:true},{start:'3.125',end:'4',text:'First 🎵'},{start:'6',end:'7.5',text:'Next line'},{start:'',end:'',text:''}];
  const before=structuredClone(rows),preview=reviewedPreview(rows,16,1,3);
  assert.deepEqual(preview,{cues:[{start:3.125,end:4,text:'First 🎵'},{start:6,end:7.5,text:'Next line'}],indices:[2,3]});
  assert.deepEqual(rows,before);
});
test('invalid selected words, times, indices and all-excluded selection refuse preview',()=>{
  const row={start:'1',end:'2',text:'Good words'};
  for(const text of ['', 'x'.repeat(241), '\u0000'])assert.throws(()=>reviewedPreview([{...row,text}],16,0,0));
  assert.throws(()=>reviewedPreview([{...row,start:'0x1'}],16,0,0));
  assert.throws(()=>reviewedPreview([row],16,0,1));
  assert.throws(()=>reviewedPreview([{...row,excluded:true}],16,0,0),/Include/);
});
