import assert from 'node:assert/strict';
import test from 'node:test';
import {splitNote} from '../src/note-split.ts';
import type {Composition} from '../src/types.ts';
const rollComposition=():Composition=>({version:1,title:'Split study',tempo:120,tracks:[{id:'fractional-track',name:'Voice',instrument:'sine',volume:.4,muted:false,notes:[{id:'fractional-low',pitch:60,start:1/3,duration:2/3,velocity:.5},{id:'other',pitch:67,start:2,duration:1,velocity:.7}]},{id:'untouched-track',name:'Other',instrument:'triangle',volume:.5,muted:false,notes:[{id:'untouched-note',pitch:48,start:0,duration:4,velocity:.8}]}]});

test('split retains original identity and exact fractional outer interval without touching other notes',()=>{
 const input=rollComposition(),before=structuredClone(input);
 const next=splitNote(input,'fractional-track','fractional-low',2/3,'new-attack');
 assert.deepEqual(next.tracks[0].notes.slice(0,2),[
  {...before.tracks[0].notes[0],duration:1/3},
  {...before.tracks[0].notes[0],id:'new-attack',start:2/3,duration:1-2/3},
 ]);
 assert.deepEqual(next.tracks[0].notes.slice(2),before.tracks[0].notes.slice(1));
 assert.deepEqual(next.tracks[1],before.tracks[1]);assert.deepEqual(input,before);
});
test('split refuses invalid points and identities atomically, including global ID collisions',()=>{
 const input=rollComposition(),before=structuredClone(input);
 for(const point of [NaN,Infinity,-1,1/3,.5,1,1.1])assert.throws(()=>splitNote(input,'fractional-track','fractional-low',point,'new'));
 for(const id of ['','fractional-track','fractional-low','untouched-note'])assert.throws(()=>splitNote(input,'fractional-track','fractional-low',2/3,id));
 assert.throws(()=>splitNote(input,'missing','fractional-low',2/3,'new'));
 assert.throws(()=>splitNote(input,'fractional-track','untouched-note',2/3,'new'));assert.deepEqual(input,before);
});
test('minimum quarter-beat halves and full note capacity remain explicit bounds',()=>{
 const input=rollComposition();input.tracks[0].notes=[{id:'n',pitch:69,start:511.5,duration:.5,velocity:0}];
 const next=splitNote(input,'fractional-track','n',511.75,'tail');assert.equal(next.tracks[0].notes[1].start+next.tracks[0].notes[1].duration,512);
 input.tracks[0].notes=Array.from({length:256},(_,i)=>({id:`n${i}`,pitch:60,start:i,duration:1,velocity:.5}));
 const before=structuredClone(input);assert.throws(()=>splitNote(input,'fractional-track','n0',.5,'new'),/256/);assert.deepEqual(input,before);
});
test('decimal song-beat conversion admits quarter halves within roundoff without loosening real minimum',()=>{
 const input=rollComposition();input.tracks[0].notes=[{id:'n',pitch:60,start:.1,duration:.5,velocity:.5}];
 const next=splitNote(input,'fractional-track','n',1.35-1,'second');
 assert.equal(next.tracks[0].notes[0].duration,.25);assert.equal(next.tracks[0].notes[1].duration,.25);
 assert.equal(next.tracks[0].notes[1].start+next.tracks[0].notes[1].duration,.1+.5);
 assert.throws(()=>splitNote(input,'fractional-track','n',.35-1e-8,'second'));
});
