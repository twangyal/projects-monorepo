import {decodeMidi} from './browser/continuation-fixtures.ts';
import test from 'node:test';import assert from 'node:assert/strict';
import {encodeMidi} from '../src/midi.ts';import type {Composition} from '../src/types.ts';import {parseMidi} from '../src/midi-import.ts';import {midiControls} from './midi-expression-fixtures.ts';
const encode=encodeMidi as unknown as (p:Composition,expression:boolean)=>Uint8Array;
const fixture=():Composition=>({version:1,title:'Expression',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.3,muted:false,notes:[{id:'n',pitch:69,start:0,duration:4,velocity:.5}],volumeCurve:[{beat:0,level:1},{beat:1,level:0},{beat:2,level:1}],volumeRamp:{start:0,end:4,from:1,to:.5}}]});
test('optional MIDI carries independently sampled expression while ordinary bytes and notes remain compatible',()=>{
 const p=fixture(),before=structuredClone(p),plain=encodeMidi(p),wet=encode(p,true),controls=midiControls(wet);assert.notDeepEqual(wet,plain);assert.deepEqual(encode(p,false),plain);assert.equal(controls.ppqn,480);const cc=controls.tracks[1];assert.equal(cc.find(c=>c.cc===7)?.value,38);const expression=cc.filter(c=>c.cc===11);assert.equal(expression[0].tick,0);assert.equal(expression[0].value,127);
 for(const tick of [0,480,960,1920]){const b=tick/480,g=b<=1?1-b:b<=2?b-1:1,r=1-b/8;assert.equal(expression.filter(c=>c.tick<=tick).at(-1)!.value,Math.round(g*r*127));}
 const a=decodeMidi(plain),b=decodeMidi(wet);assert.deepEqual(b.tracks.map(t=>t.notes),a.tracks.map(t=>t.notes));assert.deepEqual(p,before);
});
test('maximum expressive MIDI stays within existing byte/event limits and rejects nonboolean options',()=>{
 const p=fixture();assert.throws(()=>encode(p,'yes' as unknown as boolean));p.tracks=Array.from({length:8},(_,i)=>({...p.tracks[0],id:`t${i}`,notes:[{id:`n${i}`,pitch:60+i,start:496,duration:16,velocity:.5}],volumeCurve:Array.from({length:64},(_,j)=>({beat:j*512/63,level:j%2}))}));const bytes=encode(p,true),decoded=midiControls(bytes);assert.ok(bytes.length<=1048576);assert.ok(decoded.count<=32768);assert.doesNotThrow(()=>parseMidi(bytes));const no=fixture();delete no.tracks[0].volumeCurve;delete no.tracks[0].volumeRamp;assert.deepEqual(encode(no,true),encodeMidi(no));
});
