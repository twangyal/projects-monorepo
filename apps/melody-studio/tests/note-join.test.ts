import assert from 'node:assert/strict';
import test from 'node:test';
import {joinNextNote} from '../src/note-join.ts';
import type {Composition} from '../src/types.ts';
const fixture=():Composition=>({version:1,title:'Sustain study',tempo:120,tracks:[{id:'t',name:'Voice',instrument:'sine',volume:.4,muted:false,notes:[{id:'next',pitch:60,start:1,duration:.5,velocity:.5},{id:'selected',pitch:60,start:.25,duration:.75,velocity:.5},{id:'other',pitch:67,start:1,duration:1,velocity:.7}]},{id:'bass',name:'Bass',instrument:'triangle',volume:.3,muted:true,notes:[{id:'bass-note',pitch:48,start:0,duration:2,velocity:.4}]}]});
test('join uniquely touching pitch and velocity retains selected identity and other order',()=>{
 const input=fixture(),before=structuredClone(input),next=joinNextNote(input,'t','selected');
 assert.deepEqual(next.tracks[0].notes,[{...before.tracks[0].notes[1],duration:1.25},before.tracks[0].notes[2]]);
 assert.deepEqual(next.tracks[1],before.tracks[1]);assert.deepEqual(input,before);
});
test('gaps overlap velocity mismatch ambiguity and maximum duration refuse atomically',()=>{
 for(const change of [(p:Composition)=>p.tracks[0].notes[0].start+=.001,(p:Composition)=>p.tracks[0].notes[0].start-=.001,(p:Composition)=>p.tracks[0].notes[0].velocity=.6,(p:Composition)=>p.tracks[0].notes.push({...p.tracks[0].notes[0],id:'ambiguous'}),(p:Composition)=>p.tracks[0].notes[0].duration=16]) {
  const input=fixture();change(input);const before=structuredClone(input);assert.throws(()=>joinNextNote(input,'t','selected'));assert.deepEqual(input,before);
 }
 assert.throws(()=>joinNextNote(fixture(),'missing','selected'));assert.throws(()=>joinNextNote(fixture(),'t','bass-note'));
});
test('decimal boundary roundoff is accepted without relaxing meaningful gap or changing outer end',()=>{
 const input=fixture();input.tracks[0].notes[1].start=.2;input.tracks[0].notes[1].duration=.25;input.tracks[0].notes[0].start=.7-.25;input.tracks[0].notes[0].duration=.25;
 const result=joinNextNote(input,'t','selected');assert.equal(result.tracks[0].notes[0].start,.2);assert.equal(result.tracks[0].notes[0].start+result.tracks[0].notes[0].duration,.7);
 input.tracks[0].notes[0].start+=1e-8;assert.throws(()=>joinNextNote(input,'t','selected'));
});
test('exact sixteen-beat decimal join respects duration boundary roundoff but refuses real overflow',()=>{
 const input=fixture();input.tracks[0].notes[1].start=16.2;input.tracks[0].notes[1].duration=8;input.tracks[0].notes[0].start=24.2;input.tracks[0].notes[0].duration=8;
 const next=joinNextNote(input,'t','selected');assert.equal(next.tracks[0].notes[0].duration,16);assert.equal(next.tracks[0].notes[0].start+next.tracks[0].notes[0].duration,32.2);
 input.tracks[0].notes[0].duration+=1e-8;assert.throws(()=>joinNextNote(input,'t','selected'));
});
