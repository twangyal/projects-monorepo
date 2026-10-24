import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../src/cue-edit.ts';
import type {Cue} from '../src/lyrics.ts';
type Result={cues:Cue[];occurrences:number;changed:number[]};
function replace(cues:Cue[],duration:number,find:string,replacement:string):Result{
 const fn=Reflect.get(edits,'replaceCueWords') as ((c:Cue[],d:number,f:string,r:string)=>Result)|undefined;
 assert.equal(typeof fn,'function','Batch literal lyric replacement is not implemented.');return fn!(cues,duration,find,replacement);
}
const cues=[{start:0,end:1,text:'café 🌓 [x] [x] $&'},{start:2,end:3,text:'Other café 🌓'},{start:4,end:5,text:'CAFÉ 🌓'}];
test('literal case-sensitive nonoverlapping replacement retains Unicode, times and detached source',()=>{
 const before=structuredClone(cues),r=replace(cues,6,'café 🌓','$&');assert.equal(r.occurrences,2);assert.deepEqual(r.changed,[0,1]);assert.equal(r.cues[0].text,'$& [x] [x] $&');assert.equal(r.cues[2].text,'CAFÉ 🌓');assert.deepEqual(cues,before);assert.notEqual(r.cues[2],cues[2]);
 assert.equal(replace(cues,6,'[x]','.*').cues[0].text,'café 🌓 .* .* $&');
 assert.equal(replace([{start:0,end:1,text:'aaa'}],6,'aa','b').cues[0].text,'ba');
});
test('no match and identical replacement report no changed lines without invented edits',()=>{
 assert.deepEqual(replace(cues,6,'missing','new').changed,[]);const same=replace(cues,6,'café','café');assert.equal(same.occurrences,2);assert.deepEqual(same.changed,[]);
});
test('empty replacement removes fragments but empty resulting cues and invalid whole graphs refuse',()=>{
 assert.equal(replace(cues,6,' café','').cues[1].text,'Other 🌓');
 for(const [source,find,to] of [[[{start:0,end:1,text:'all'}],'all',''],[[{start:NaN,end:1,text:'all'}],'all','word'],[cues,'','word'],[cues,'  ','word'],[cues,'café','\u0000'],[cues,'🌓','\ud800']] as [Cue[],string,string][])assert.throws(()=>replace(source,6,find,to));
});
test('full proposal enforces per-line and aggregate code-point caps atomically',()=>{
 const source=[{start:0,end:1,text:'x'.repeat(120)}];assert.equal(replace(source,6,'x','🌓🌓').cues[0].text.length,480);assert.throws(()=>replace(source,6,'x','xxx'));assert.equal(source[0].text.length,120);
 const many=Array.from({length:200},(_,i)=>({start:i,end:i+1,text:'x'.repeat(100)}));assert.throws(()=>replace(many,600,'x','xx'));assert.equal(many[0].text.length,100);
});
