import assert from 'node:assert/strict';
import test from 'node:test';
import { validateComposition, createNote } from '../src/model.ts';
import { renderComposition } from '../src/audio.ts';
import { encodeMidi } from '../src/midi.ts';
import { parseMidi } from '../src/midi-import.ts';
import { buildMidiReview } from '../src/midi-review.ts';
import { sectionWindow } from '../src/section.ts';
import { duplicateSection } from '../src/section-arrangement.ts';
import { suggestEnding } from '../src/continuation.ts';
import type { Composition } from '../src/types.ts';
const song = (): Composition => ({version:1,title:'Complete song',tempo:120,tracks:[{id:'lead',name:'Lead',instrument:'sine',volume:.2,muted:false,notes:[{id:'late',pitch:69,start:511,duration:1,velocity:.5}]}]});
test('late exact512 notes validate without altering timing and overflow refuses',()=>{
 const input=song();assert.deepEqual(validateComposition(input),input);assert.equal(createNote(60,511).start,511);
 input.tracks[0].notes[0].start=511.75;input.tracks[0].notes[0].duration=.25;assert.deepEqual(validateComposition(input),input);
 input.tracks[0].notes[0].duration=.25001;assert.throws(()=>validateComposition(input));
});
test('slowest browser tempo renders the complete512 beats and public over-budget allocation refuses',()=>{
 const input=song();input.tempo=40;const samples=renderComposition(input,22050);
 assert.equal(samples.length,Math.ceil((512*1.5+.08)*22050));
 assert.equal(samples[0],0);assert.ok(samples.subarray(Math.round(511*1.5*22050)).some(v=>v!==0));
 assert.throws(()=>renderComposition(input,192000),/frame budget/);
});
test('full-song MIDI review accepts512-beat source window without moving late notes',()=>{
 const input=song(),preview=parseMidi(encodeMidi(input));
 const review=buildMidiReview(input,preview,{title:'Imported song',startBeat:0,endBeat:512,lanes:preview.lanes.map(l=>({laneId:l.id,name:'Lead',instrument:'sine'}))});
 assert.equal(review.candidate.tracks[0].notes[0].start,511);
 assert.equal(review.candidate.tracks[0].notes[0].duration,1);
 assert.throws(()=>buildMidiReview(input,preview,{title:'Too long',startBeat:0,endBeat:513,lanes:preview.lanes.map(l=>({laneId:l.id,name:'Lead',instrument:'sine'}))}));
});
test('section and continuation use expanded song bounds with existing local extension depth',()=>{
 const input=song();input.tracks[0].notes=Array.from({length:8},(_,i)=>({id:`n-${i}`,pitch:i%2?62:60,start:300+i*.5,duration:.5,velocity:.7}));
 const suggested=suggestEnding(input,'lead',8,4,987);
 assert.ok(suggested.notes.every(n=>n.start>=304&&n.start+n.duration<=320));
 const repeated=duplicateSection(input,{start:'301',end:'305'});
 assert.equal(Math.max(...repeated.tracks[0].notes.map(n=>n.start+n.duration)),308);
 assert.equal(sectionWindow('511','513',120,512,22050).endFrame,Math.round(256*22050));
});
