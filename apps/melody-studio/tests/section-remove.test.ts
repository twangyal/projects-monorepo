import assert from 'node:assert/strict';
import test from 'node:test';
import { removeSection } from '../src/section-arrangement.ts';
import type { Composition, Note } from '../src/types.ts';
const note = (id: string, start: number, duration = .5): Note => ({id, start, duration, pitch: 60, velocity: .7});
const fixture = (): Composition => ({version:1,title:'Trim arrangement',tempo:137,tracks:[
 {id:'lead',name:'Lead',instrument:'triangle',volume:.3,muted:false,notes:[note('before',0),note('inside',1.25,.75),note('edge',2.5,.5),note('later',3)]},
 {id:'bass',name:'Muted bass',instrument:'sawtooth',volume:.8,muted:true,notes:[note('bass-inside',1.5),note('bass-later',4)]},
]});
test('section removal closes exact all-track gap without mutating frozen source or surviving identities',()=>{
 const input=fixture(),before=structuredClone(input);
 for(const track of input.tracks){track.notes.forEach(Object.freeze);Object.freeze(track.notes);Object.freeze(track);}Object.freeze(input.tracks);Object.freeze(input);
 const output=removeSection(input,{start:'2',end:'4'}),expected=structuredClone(before);
 expected.tracks[0].notes=[before.tracks[0].notes[0],{...before.tracks[0].notes[3],start:1}];expected.tracks[1].notes=[{...before.tracks[1].notes[1],start:2}];
 assert.deepEqual(output,expected);assert.deepEqual(input,before);output.tracks[0].notes[0].pitch=72;assert.deepEqual(input,before);
});
test('fractional whole boundaries and an empty rest retain exact offsets',()=>{
 const input=fixture();input.tracks[0].notes=[note('left',0,1.125),note('inside',1.125,.75),note('right',2.375,.5)];input.tracks[1].notes=[];
 assert.deepEqual(removeSection(input,{start:'2.125',end:'3.375'}).tracks[0].notes,[input.tracks[0].notes[0],{...input.tracks[0].notes[2],start:1.125}]);
 input.tracks[0].notes=[note('left',0),note('later',4.125,.375)];
 assert.deepEqual(removeSection(input,{start:'2.125',end:'3.375'}).tracks[0].notes,[input.tracks[0].notes[0],{...input.tracks[0].notes[1],start:2.875}]);
});
test('crossings anywhere and invalid bounds refuse atomically',()=>{
 for(const crossing of [note('left-cross',.75,.5),note('right-cross',2.75,.5),note('covers',0,4)]){
  const input=fixture();input.tracks[1].notes.push(crossing);const before=structuredClone(input);assert.throws(()=>removeSection(input,{start:'2',end:'4'}),/crosses/);assert.deepEqual(input,before);
 }
 for(const range of [{start:'',end:'4'},{start:'4',end:'2'},{start:'1',end:'513'},{start:'NaN',end:'4'}]){const input=fixture(),before=structuredClone(input);assert.throws(()=>removeSection(input,range));assert.deepEqual(input,before);}
});
test('whole song removal keeps empty tracks and a rest past the song refuses without changes',()=>{
 const input=fixture(),output=removeSection(input,{start:'1',end:'5.5'});
 assert.deepEqual(output,{...input,tracks:input.tracks.map(track=>({...track,notes:[]}))});
 const empty=fixture();empty.tracks[0].notes=[note('early',0)];empty.tracks[1].notes=[];
 const before=structuredClone(empty);assert.throws(()=>removeSection(empty,{start:'2',end:'3'}),/fit/);assert.deepEqual(empty,before);
});
test('full2048-note512-beat arrangement cuts middle notes with exact later shifts',()=>{
 const input:Composition={version:1,title:'Long arrangement',tempo:40,tracks:Array.from({length:8},(_,t)=>({id:`track-${t}`,name:`Part ${t}`,instrument:'sine',volume:.1,muted:t===7,notes:Array.from({length:256},(_,i)=>note(`note-${t}-${i}`,i*2,2))}))};
 const before=structuredClone(input),output=removeSection(input,{start:'129',end:'385'});
 assert.deepEqual(input,before);
 for(let t=0;t<8;t++){assert.equal(output.tracks[t].notes.length,128);assert.deepEqual(output.tracks[t].notes.slice(0,64),input.tracks[t].notes.slice(0,64));assert.deepEqual(output.tracks[t].notes.slice(64),input.tracks[t].notes.slice(192).map(n=>({...n,start:n.start-256})));assert.equal(output.tracks[t].notes.at(-1)!.start+output.tracks[t].notes.at(-1)!.duration,256);}
});
