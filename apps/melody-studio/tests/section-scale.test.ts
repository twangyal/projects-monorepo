import assert from 'node:assert/strict';
import test from 'node:test';
import * as arrangement from '../src/section-arrangement.ts';
import {CompositionHistory} from '../src/history.ts';
import {rollComposition} from './roll-edit-fixtures.ts';
import type {Composition} from '../src/types.ts';
import type {SectionRange} from '../src/section.ts';
const scale=(arrangement as unknown as {scaleSection(p:Composition,id:string,r:SectionRange,factor:number):Composition}).scaleSection;
function fixture(){const p=rollComposition();p.tracks[0].notes=[{id:'fractional-low',pitch:60,start:.5,duration:.5,velocity:.5},{id:'chord',pitch:67,start:.5,duration:1,velocity:.25},{id:'later',pitch:64,start:2,duration:.5,velocity:.75},{id:'following',pitch:65,start:3,duration:1,velocity:.4}];return p;}
const range={start:'1.5',end:'3.5'};
test('section scaling exists and doubles intervals, internal rests and only selected-track later notes',()=>{
 assert.equal(typeof scale,'function');const p=fixture();p.tracks[0].volumeRamp={start:0,end:4,from:1,to:0};p.tracks[0].echo={beats:1,decay:.5,repeats:3};const before=structuredClone(p),expected=structuredClone(p);
 expected.tracks[0].notes[0].duration=1;expected.tracks[0].notes[1].duration=2;expected.tracks[0].notes[2].start=3.5;expected.tracks[0].notes[2].duration=1;expected.tracks[0].notes[3].start=5;
 const next=scale(p,p.tracks[0].id,range,2);assert.deepEqual(next,expected);next.tracks[0].notes[0].pitch=40;next.tracks[0].volumeRamp!.to=.5;assert.deepEqual(p,before);
});
test('compression respects fractional anchor, closes the gap and reverses a stretched phrase exactly',()=>{
 const p=fixture(),expected=structuredClone(p);expected.tracks[0].notes[0].duration=.25;expected.tracks[0].notes[1].duration=.5;expected.tracks[0].notes[2].start=1.25;expected.tracks[0].notes[2].duration=.25;expected.tracks[0].notes[3].start=2;
 assert.deepEqual(scale(p,p.tracks[0].id,range,.5),expected);
 const larger=scale(p,p.tracks[0].id,range,2);assert.deepEqual(scale(larger,p.tracks[0].id,{start:'1.5',end:'5.5'},.5),p);
 const h=new CompositionHistory(p);h.commit(larger);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),larger);
});
test('crossing notes, invalid and empty selections refuse atomically',()=>{
 const p=fixture(),before=structuredClone(p);for(const r of [{start:'1.75',end:'3.5'},{start:'1.5',end:'3.25'},{start:'',end:'3.5'},{start:'4',end:'2'},{start:'1',end:'513'},{start:'2.5',end:'3'}])assert.throws(()=>scale(p,p.tracks[0].id,r,2));
 for(const factor of [0,1,-1,NaN,Infinity])assert.throws(()=>scale(p,p.tracks[0].id,range,factor));assert.throws(()=>scale(p,'missing',range,2));assert.deepEqual(p,before);
});
test('duration and later-note timeline overflow retain complete source and redo',()=>{
 const p=fixture();p.tracks[0].notes[0].duration=.25;const before=structuredClone(p);assert.throws(()=>scale(p,p.tracks[0].id,range,.5),/duration/);assert.deepEqual(p,before);
 const long=fixture();long.tracks[0].notes=[{id:'long',pitch:60,start:0,duration:9,velocity:.5}];assert.throws(()=>scale(long,long.tracks[0].id,{start:'1',end:'10'},2),/duration/);
 const end=fixture();end.tracks[0].notes.push({id:'late',pitch:60,start:510,duration:2,velocity:.5});const h=new CompositionHistory(end),changed=structuredClone(end);changed.title='Changed';h.commit(changed);h.undo();assert.throws(()=>scale(h.current,end.tracks[0].id,range,2),/end by beat/);assert.equal(h.canRedo,true);assert.deepEqual(h.current,end);
 const tooLate=structuredClone(end);tooLate.tracks[0].notes.at(-1)!.start=511;tooLate.tracks[0].notes.at(-1)!.duration=1;assert.throws(()=>scale(tooLate,tooLate.tracks[0].id,range,2),/start must/);
});
test('all 2048 notes remain complete while the selected muted track scales independently',()=>{
 const p=fixture();p.tracks=Array.from({length:8},(_,t)=>({...structuredClone(p.tracks[0]),id:`track-${t}`,name:`Part ${t}`,muted:t%2===0,notes:Array.from({length:256},(_,i)=>({id:`track-${t}-note-${i}`,pitch:60+i%12,start:i/4,duration:.25,velocity:.5}))}));
 const before=structuredClone(p),next=scale(p,'track-0',{start:'1',end:'65'},2);
 assert.equal(next.tracks[0].notes.length,256);assert.deepEqual(next.tracks.slice(1),p.tracks.slice(1));
 assert.deepEqual(next.tracks[0].notes.map(n=>[n.start,n.duration]),Array.from({length:256},(_,i)=>[i/2,.5]));
 assert.deepEqual(scale(next,'track-0',{start:'1',end:'129'},.5),p);assert.deepEqual(p,before);
});
test('adjacent boundary notes and unrelated crossing voices retain exact section semantics',()=>{
 const p=fixture();p.tracks[0].notes=[{id:'before',pitch:60,start:0,duration:.5,velocity:.5},{id:'inside',pitch:61,start:.5,duration:.5,velocity:.6},{id:'after',pitch:62,start:2.5,duration:.5,velocity:.7}];p.tracks[1].notes=[{id:'other-crossing',pitch:72,start:0,duration:4,velocity:.6}];
 const expected=structuredClone(p);expected.tracks[0].notes[1].duration=1;expected.tracks[0].notes[2].start=4.5;
 assert.deepEqual(scale(p,p.tracks[0].id,range,2),expected);
});
