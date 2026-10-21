import {validateDocument} from '../src/reference-project.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validateComposition,serializeComposition,parseComposition} from '../src/model.ts';
import {renderComposition} from '../src/audio.ts';
import {renderMix,usesStereoMix} from '../src/mix.ts';
import {isolatedTrack} from '../src/track-render.ts';
import {auditionComposition,suggestEnding} from '../src/continuation.ts';
import type {Composition} from '../src/types.ts';
const fixture=():Composition=>({version:1,title:'Moving voice',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.2,muted:false,notes:[{id:'n',pitch:69,start:.125,duration:4,velocity:.5}]}]});
const points=[{beat:0,level:-1},{beat:1,level:1},{beat:2,level:0},{beat:3,level:-.5}];
test('pan points survive complete documents and reject malformed/accessor data atomically',()=>{
 const p=fixture();Object.assign(p.tracks[0],{panCurve:points});assert.deepEqual(parseComposition(serializeComposition(p)),p);assert.deepEqual(validateDocument({schemaVersion:1,composition:p,references:[]}).composition,p);
 for(const value of [[],new Array(1),[{beat:0,level:-1.01}],[{beat:0,level:1.01}],[{beat:513,level:0}],[{beat:0,level:NaN}],[{beat:0,level:0,extra:1}],[{beat:1,level:0},{beat:1,level:1}],Array.from({length:65},(_,beat)=>({beat,level:0}))])assert.throws(()=>validateComposition({...p,tracks:[{...p.tracks[0],panCurve:value}]}));
 let reads=0;const accessed=fixture();Object.defineProperty(accessed.tracks[0],'panCurve',{enumerable:true,get(){reads++;return points;}});assert.throws(()=>validateComposition(accessed));assert.equal(reads,0);
 const nested=fixture();Object.assign(nested.tracks[0],{panCurve:[{get beat(){reads++;return 0;},level:0}]});assert.throws(()=>validateComposition(nested));assert.equal(reads,0);
});
test('absolute-time pan replaces static balance through notes, release and echo with exact legacy bypass',()=>{
 const p=fixture();p.tracks[0].echo={beats:.5,decay:.4,repeats:2};const mono=renderComposition(p,8000);assert.deepEqual(renderMix(p,8000),[mono]);Object.assign(p.tracks[0],{pan:.8,panCurve:points});assert.equal(usesStereoMix(p),true);const channels=renderMix(p,8000);assert.equal(channels.length,2);assert.equal(channels[0].length,mono.length);
 for(let i=0;i<mono.length;i+=23){const b=i/4000,pos=b<=1?-1+2*b:b<=2?2-b:b<=3?-(b-2)/2:-.5;assert.ok(Math.abs(channels[0][i]-mono[i]*(pos>0?1-pos:1))<1e-7,`left ${i}`);assert.ok(Math.abs(channels[1][i]-mono[i]*(pos<0?1+pos:1))<1e-7,`right ${i}`);}
 assert.deepEqual(renderMix(isolatedTrack(p,'voice'),8000),channels);
 Object.assign(p.tracks[0],{panCurve:[{beat:0,level:0}]});assert.equal(usesStereoMix(p),false);assert.deepEqual(renderMix(p,8000),[mono]);
});
test('pan does not alter pre-pan reverb input and muted automation does not force stereo',()=>{
 const p=fixture();p.tracks[0].reverbSend=.4;p.reverb={size:.1,level:.4};const plain=renderMix(p,8000);Object.assign(p.tracks[0],{panCurve:[{beat:0,level:-1}]});const left=renderMix(p,8000);const dry=renderComposition(p,8000);for(let i=0;i<plain[1].length;i+=41){assert.ok(Math.abs(left[0][i]-plain[0][i])<1e-7);assert.ok(Math.abs(left[1][i]-(plain[1][i]-(dry[i]??0)))<1e-7);}
 p.tracks[0].muted=true;assert.equal(usesStereoMix(p),false);
});
test('continuation audition retains original song-time pan without mutating the source',()=>{
 const p=fixture();p.tracks[0].notes=Array.from({length:8},(_,i)=>({id:`s${i}`,pitch:60+i%3,start:8+i,duration:.5,velocity:.5}));Object.assign(p.tracks[0],{panCurve:[{beat:0,level:-1},{beat:10,level:1},{beat:16,level:0}]});const before=structuredClone(p);const audition=auditionComposition(suggestEnding(p,'voice',8,4,1));const shifted=(audition.tracks[0] as unknown as{panCurve:{beat:number;level:number}[]}).panCurve;assert.ok(Math.abs(shifted[0].level-.6)<1e-12);assert.deepEqual(shifted.map(p=>p.beat),[0,2,8]);assert.deepEqual(shifted.slice(1),[{beat:2,level:1},{beat:8,level:0}]);assert.deepEqual(p,before);
});

test('signed text round-trips fractional/subnormal values and maximum dense curves',async()=>{
 const {parsePanCurve,formatPanCurve,shiftPanCurve}=await import('../src/pan-curve.ts');
 const original=[{beat:0,level:-1},{beat:1e-20,level:-Number.MIN_VALUE},{beat:1/3,level:.5},{beat:512,level:1}];assert.deepEqual(parsePanCurve(formatPanCurve(original)),original);
 const maximum=Array.from({length:64},(_,i)=>({beat:(i+1)*Number.MIN_VALUE,level:-Number.MIN_VALUE}));const raw=formatPanCurve(maximum);assert.ok(raw.length<=65536);assert.deepEqual(parsePanCurve(raw),maximum);
 for(const raw of ['', '1 Infinity','1e2 0','0 -1','1 -1 0','1 0\n1 1','1 -1.1','1 1.1','1 --.5','1 .5garbage'])assert.throws(()=>parsePanCurve(raw));
 assert.deepEqual(parsePanCurve('1 -1\n2 +1'),[{beat:0,level:-1},{beat:1,level:1}]);assert.deepEqual(shiftPanCurve([{beat:8,level:-1},{beat:9,level:1}],2),[{beat:6,level:-1},{beat:7,level:1}]);assert.deepEqual(shiftPanCurve(original,512),[{beat:0,level:1}]);
});
