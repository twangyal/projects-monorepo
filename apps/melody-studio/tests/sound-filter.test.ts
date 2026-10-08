import assert from 'node:assert/strict';
import test from 'node:test';
import {validateComposition} from '../src/model.ts';
import {renderComposition} from '../src/audio.ts';
import {notesOnly,validateDocument} from '../src/reference-project.ts';
import type {Composition} from '../src/types.ts';
const fixture=():Composition=>({version:1,title:'Filter study',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.4,muted:false,notes:[{id:'note',pitch:84,start:0,duration:4,velocity:.5}]}]});
test('filter settings validate, detach and survive complete documents without adding legacy fields',()=>{
 const p=fixture();Object.assign(p.tracks[0],{filter:{cutoff:500,resonance:.707}});const valid=validateComposition(p);assert.deepEqual(valid.tracks[0].filter,{cutoff:500,resonance:.707});p.tracks[0].filter!.cutoff=900;assert.equal(valid.tracks[0].filter!.cutoff,500);assert.deepEqual(validateDocument(notesOnly(valid)),notesOnly(valid));assert.deepEqual(validateComposition(fixture()),fixture());
});
test('invalid filter objects reject without reading accessors',()=>{
 for(const filter of [null,undefined,{}, {cutoff:19,resonance:1},{cutoff:10001,resonance:1},{cutoff:500,resonance:.49},{cutoff:500,resonance:8.01},{cutoff:NaN,resonance:1},{cutoff:'500',resonance:1},{cutoff:500,resonance:1,extra:1}]){const p=fixture();Object.assign(p.tracks[0],{filter});assert.throws(()=>validateComposition(p));}
 let reads=0;const p=fixture();Object.assign(p.tracks[0],{filter:{get cutoff(){reads++;return 500;},resonance:1}});assert.throws(()=>validateComposition(p));assert.equal(reads,0);
});
function rms(samples:Float32Array){return Math.sqrt(samples.reduce((sum,s)=>sum+s*s,0)/samples.length);}
// Independent complex transfer-function magnitude of a bilinear two-pole low-pass.
function response(hz:number,cutoff:number,q:number,rate:number){const w=2*Math.PI*cutoff/rate,c=Math.cos(w),s=Math.sin(w),alpha=s/(2*q),b=[(1-c)/2,1-c,(1-c)/2],a=[1+alpha,-2*c,1-alpha],angle=2*Math.PI*hz/rate;const magnitude=(v:number[])=>Math.hypot(v.reduce((sum,x,i)=>sum+x*Math.cos(-i*angle),0),v.reduce((sum,x,i)=>sum+x*Math.sin(-i*angle),0));return magnitude(b)/magnitude(a);}
test('rendered low and high tones match an independent frequency response',()=>{
 for(const pitch of [36,69,84,96])for(const resonance of [.5,.707,2,8]){const p=fixture();p.tracks[0].notes[0].pitch=pitch;const before=renderComposition(p);Object.assign(p.tracks[0],{filter:{cutoff:500,resonance}});const after=renderComposition(p);assert.equal(after.length,before.length);const actual=rms(after.subarray(10000,40000))/rms(before.subarray(10000,40000)),expected=response(440*2**((pitch-69)/12),500,resonance,22050);assert.ok(Math.abs(actual-expected)<.01,`gain ${actual} vs ${expected}`);}
});
test('same-note voices with different filters remain independent when grouped',()=>{const a=fixture(),b=fixture();Object.assign(a.tracks[0],{filter:{cutoff:500,resonance:.707}});Object.assign(b.tracks[0],{filter:{cutoff:1500,resonance:.8}});b.tracks[0].id='second';b.tracks[0].notes[0].id='second-note';const joined={...a,tracks:[...a.tracks,...b.tracks]},mixed=renderComposition(joined),left=renderComposition(a),right=renderComposition(b);for(let i=0;i<mixed.length;i+=37)assert.ok(Math.abs(mixed[i]-left[i]-right[i])<1e-6);});
test('filter stays finite at low sample rates and the supported resonance extremes',()=>{const p=fixture();Object.assign(p.tracks[0],{filter:{cutoff:10000,resonance:8}});const samples=renderComposition(p,8000);assert.ok(samples.length);assert.ok(samples.every(Number.isFinite));assert.ok(samples.some(x=>x!==0));});
