import test from 'node:test';
import assert from 'node:assert/strict';
import {applyReviewedLine} from '../src/automatic-review.ts';
import type {Cue} from '../src/lyrics.ts';
const cues=():Cue[]=>[{start:1,end:3,text:'Keep first 🎵'},{start:4,end:6,text:'My corrected chorus'},{start:9,end:11,text:'Old words'}];
const rows=()=>[{start:'',end:'bad',text:''},{start:'8.900',end:'11.5',text:'Better last line'}];
test('one reviewed line replaces just its overlapping cue and ignores unrelated review drafts',()=>{
 const current=cues(),draft=rows(),before=structuredClone({current,draft});const result=applyReviewedLine(current,draft,1,16);
 assert.deepEqual(result,{cues:[{start:1,end:3,text:'Keep first 🎵'},{start:4,end:6,text:'My corrected chorus'},{start:8.9,end:11.5,text:'Better last line'}],index:2,replaced:true,changed:true});
 assert.deepEqual({current,draft},before);result.cues[0].text='Detached';assert.deepEqual(current,before.current);
});
test('a reviewed line inserts into an empty gap and touching endpoints are not overlaps',()=>{
 const draft=[{start:'3',end:'4',text:'Missed words'}];
 assert.deepEqual(applyReviewedLine(cues(),draft,0,16),{cues:[{start:1,end:3,text:'Keep first 🎵'},{start:3,end:4,text:'Missed words'},{start:4,end:6,text:'My corrected chorus'},{start:9,end:11,text:'Old words'}],index:1,replaced:false,changed:true});
 assert.equal(applyReviewedLine([],draft,0,16).index,0);
 assert.equal(applyReviewedLine(cues(),[{start:'12',end:'13',text:'Tail'}],0,16).index,3);
});
test('overlap with several current lines refuses without changing either draft',()=>{
 const current=cues(),draft=[{start:'2',end:'5',text:'Too broad'}],before=structuredClone({current,draft});
 assert.throws(()=>applyReviewedLine(current,draft,0,16),/more than one current line/);assert.deepEqual({current,draft},before);
});
test('excluded invalid and missing reviewed lines cannot be applied',()=>{
 for(const row of [{start:'1',end:'3',text:'Excluded',excluded:true},{start:'',end:'3',text:'Blank time'},{start:'1',end:'17',text:'Outside'},{start:'1',end:'3',text:''}])assert.throws(()=>applyReviewedLine(cues(),[row],0,16));
 for(const index of [-1,1,.5,NaN])assert.throws(()=>applyReviewedLine(cues(),[{start:'1',end:'3',text:'Words'}],index,16),/existing/);
});
test('invalid current lyrics and resulting clip limits refuse without fixing unrelated values',()=>{
 const current=cues();current[0].start=NaN;assert.throws(()=>applyReviewedLine(current,rows(),1,16),/current lyrics/i);assert.ok(Number.isNaN(current[0].start));
 const full=Array.from({length:200},(_,i)=>({start:i*2,end:i*2+1,text:'Line'}));assert.throws(()=>applyReviewedLine(full,[{start:'1',end:'2',text:'Insert'}],0,600),/200/);
 const long=Array.from({length:100},(_,i)=>({start:i*2,end:i*2+1,text:'x'.repeat(200)}));assert.throws(()=>applyReviewedLine(long,[{start:'0',end:'1',text:'y'.repeat(201)}],0,600),/20,000/);
});
test('an identical reviewed cue is a no-op even when its raw time spelling differs',()=>{
 const current=cues();assert.deepEqual(applyReviewedLine(current,[{start:'4.000',end:'6e0',text:'My corrected chorus'}],0,16),{cues:current,index:1,replaced:true,changed:false});
});
