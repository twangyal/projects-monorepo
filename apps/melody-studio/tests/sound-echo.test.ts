import assert from 'node:assert/strict';
import test from 'node:test';
import {validateComposition} from '../src/model.ts';
import {renderComposition} from '../src/audio.ts';
import {isolatedTrack} from '../src/track-render.ts';
import {backingComposition} from '../src/backing.ts';
import {notesOnly,validateDocument} from '../src/reference-project.ts';
import type {Composition} from '../src/types.ts';
const fixture=():Composition=>({version:1,title:'Echo study',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.2,muted:false,notes:[{id:'note',pitch:69,start:.125,duration:.25,velocity:.5}]}]});
test('echo settings validate and detach without changing legacy graphs',()=>{
 const p=fixture();Object.assign(p.tracks[0],{echo:{beats:1,decay:.5,repeats:3}});const q=validateComposition(p);assert.deepEqual(q.tracks[0].echo,{beats:1,decay:.5,repeats:3});p.tracks[0].echo!.beats=2;assert.equal(q.tracks[0].echo!.beats,1);assert.deepEqual(validateDocument(notesOnly(q)),notesOnly(q));assert.deepEqual(validateComposition(fixture()),fixture());
});
test('echo refuses malformed, nonfinite and accessor settings atomically',()=>{
 for(const echo of [null,undefined,{}, {beats:.24,decay:.5,repeats:2},{beats:4.01,decay:.5,repeats:2},{beats:1,decay:0,repeats:2},{beats:1,decay:1,repeats:2},{beats:1,decay:.5,repeats:1.5},{beats:1,decay:.5,repeats:9},{beats:NaN,decay:.5,repeats:2},{beats:'1',decay:.5,repeats:2},{beats:1,decay:.5,repeats:2,extra:1}]){const p=fixture();Object.assign(p.tracks[0],{echo});assert.throws(()=>validateComposition(p));}
 let reads=0;const p=fixture();Object.assign(p.tracks[0],{echo:{get beats(){reads++;return 1;},decay:.5,repeats:2}});assert.throws(()=>validateComposition(p));assert.equal(reads,0);
});
test('nonoverlapping repeats have independently computed beat positions and geometric amplitudes',()=>{
 const p=fixture(),rate=8000,dry=renderComposition(p,rate);Object.assign(p.tracks[0],{echo:{beats:1,decay:.5,repeats:3}});const wet=renderComposition(p,rate);assert.equal(wet.length,Math.ceil(((.125+.25+3)*.5+.08)*rate));
 const start=Math.round(.125*.5*rate),length=Math.ceil((.25*.5+.08)*rate);for(let tap=0;tap<=3;tap++){const offset=Math.round((.125+tap)*.5*rate);for(let i=0;i<length;i+=17)assert.ok(Math.abs(wet[offset+i]-(dry[start+i]??0)*.5**tap)<1e-7);}
 assert.equal(wet[0],0);assert.equal(wet[start+length+20],0);
});
test('overlapping filtered/enveloped echoes sum complete voices and preserve other tracks',()=>{
 const p=fixture();p.tracks[0].notes[0].duration=2;p.tracks[0].envelope={attack:.05,decay:.1,sustain:.4,release:.3};p.tracks[0].filter={cutoff:900,resonance:1};const rate=8000,dry=renderComposition(p,rate);Object.assign(p.tracks[0],{echo:{beats:.375,decay:.6,repeats:2}});const wet=renderComposition(p,rate),offset=Math.round(.125*.5*rate),expected=new Float64Array(wet.length);
 for(let tap=0;tap<=2;tap++){const at=Math.round((.125+tap*.375)*.5*rate);for(let i=0;i<dry.length-offset;i++)expected[at+i]+=dry[offset+i]*.6**tap;}
 for(let i=0;i<wet.length;i+=13)assert.ok(Math.abs(wet[i]-expected[i])<1e-7);
 const other=fixture().tracks[0];other.id='other';other.notes[0].id='other-note';other.instrument='triangle';other.notes[0].start=2;const combined=renderComposition({...p,tracks:[p.tracks[0],other]},rate),otherPcm=renderComposition({...p,tracks:[other]},rate);for(let i=0;i<combined.length;i+=19)assert.ok(Math.abs(combined[i]-(wet[i]??0)-(otherPcm[i]??0))<1e-7);
});
test('echo tail, mute, peak limiting, aligned stems and backing retain shared behavior',()=>{
 const p=fixture();Object.assign(p.tracks[0],{echo:{beats:4,decay:.95,repeats:8}});p.tracks[0].muted=true;const muted=renderComposition(p,8000);assert.equal(muted.length,Math.ceil(((.125+.25+32)*.5+.08)*8000));assert.ok(muted.every(x=>x===0));p.tracks[0].muted=false;
 const target=fixture().tracks[0];target.id='target';target.notes[0].id='target-note';const both={...p,tracks:[p.tracks[0],target]};assert.deepEqual(isolatedTrack(both,'voice').tracks[0].echo,p.tracks[0].echo);assert.deepEqual(backingComposition(both,'target').tracks[0].echo,p.tracks[0].echo);
 p.tracks[0].volume=1;p.tracks[0].notes=Array.from({length:256},(_,i)=>({...p.tracks[0].notes[0],id:`loud-${i}`}));const loud=renderComposition(p,8000);assert.ok(loud.every(x=>Number.isFinite(x)&&Math.abs(x)<=.950001));
 const large=fixture();large.tempo=40;large.tracks[0].notes[0].start=511;large.tracks[0].notes[0].duration=1;Object.assign(large.tracks[0],{echo:{beats:4,decay:.5,repeats:8}});assert.throws(()=>renderComposition(large,192000),/frame budget/);
});
