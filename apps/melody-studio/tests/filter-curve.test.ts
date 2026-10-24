import test from 'node:test';
import assert from 'node:assert/strict';
import {validateComposition,parseComposition,serializeComposition} from '../src/model.ts';
import {renderComposition,renderDry} from '../src/audio.ts';
import {auditionComposition,suggestEnding} from '../src/continuation.ts';
import type {Composition} from '../src/types.ts';
const fixture=():Composition=>({version:1,title:'Cutoff movement',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.2,muted:false,notes:[{id:'n',pitch:69,start:0,duration:2,velocity:.5}],filter:{cutoff:8000,resonance:.707}}]});
const setCurve=(p:Composition,curve:unknown)=>Object.assign(p.tracks[0].filter!,{curve});
test('cutoff curves survive validation and reject malformed/accessor data atomically',()=>{
 const p=fixture(),points=[{beat:0,level:20},{beat:512,level:10000}];setCurve(p,points);assert.deepEqual(parseComposition(serializeComposition(p)),p);const saved=validateComposition(p);points[0].level=30;assert.notDeepEqual(saved,p);
 for(const curve of [undefined,[],new Array(1),[{beat:0,level:19}],[{beat:0,level:10001}],[{beat:513,level:100}],[{beat:0,level:NaN}],[{beat:0,level:100,extra:1}],[{beat:1,level:20},{beat:1,level:30}],Array.from({length:65},(_,beat)=>({beat,level:100}))]){const q=fixture();setCurve(q,curve);assert.throws(()=>validateComposition(q));}
 let reads=0;const q=fixture();Object.defineProperty(q.tracks[0].filter,'curve',{enumerable:true,get(){reads++;return points;}});assert.throws(()=>validateComposition(q));assert.equal(reads,0);
});
test('constant curves equal static PCM including drums and tails',()=>{
 for(const instrument of ['sine','drums'] as const){const p=fixture();p.tracks[0].instrument=instrument;p.tracks[0].notes[0].pitch=instrument==='drums'?38:69;p.tracks[0].filter!.cutoff=700;const plain=renderComposition(p,8000);setCurve(p,[{beat:0,level:700}]);assert.deepEqual(renderComposition(p,8000),plain);}
});
test('different onsets filter independently while echo repeats original filtered voices',()=>{
 const p=fixture();p.tracks[0].notes=[{id:'early',pitch:69,start:0,duration:.25,velocity:.5},{id:'late',pitch:69,start:3,duration:.25,velocity:.5}];setCurve(p,[{beat:0,level:100},{beat:1,level:100},{beat:2,level:3000}]);p.tracks[0].echo={beats:.5,decay:.5,repeats:2};const actual=renderComposition(p,8000),expected=new Float32Array(actual.length);
 for(const [index,cutoff] of [[0,100],[1,3000]]){const q=fixture();q.tracks[0].notes=[p.tracks[0].notes[index]];q.tracks[0].filter!.cutoff=cutoff;q.tracks[0].echo=p.tracks[0].echo;const voice=renderComposition(q,8000);for(let i=0;i<voice.length;i++)expected[i]+=voice[i];}
 for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-expected[i])<1e-7,`onset/echo sample${i}`);
});
test('sustained cutoff follows an independent trapezoidal integrator oracle',()=>{
 const p=fixture(),rate=8000;setCurve(p,[{beat:0,level:100},{beat:2,level:2000}]);const actual=renderComposition(p,rate);let s1=0,s2=0,maximum=0;
 for(let i=0;i<actual.length;i++){const cutoff=Math.min(2000,100+1900*i/rate),g=Math.tan(Math.PI*cutoff/rate),a=1/(1+g*(g+1/.707)),b=g*a,c=g*b,x=Math.sin(2*Math.PI*440*i/rate),u=x-s2,v=a*s1+b*u,y=s2+b*s1+c*u;s1=2*v-s1;s2=2*y-s2;const env=i<80?i/80:i<=rate?1:Math.max(0,1-(i-rate)/640);maximum=Math.max(maximum,Math.abs(actual[i]-y*env*.04));}
 assert.ok(maximum<1e-7,`maximum error ${maximum}`);
});
test('continuation shifts cutoff song time without mutating source',()=>{
 const p=fixture();p.tracks[0].notes=Array.from({length:8},(_,i)=>({id:`s${i}`,pitch:60+i%3,start:8+i,duration:.5,velocity:.5}));setCurve(p,[{beat:0,level:100},{beat:10,level:1100},{beat:16,level:500}]);const before=structuredClone(p),audition=auditionComposition(suggestEnding(p,'voice',8,4,1));assert.deepEqual((audition.tracks[0].filter as unknown as{curve:unknown}).curve,[{beat:0,level:900},{beat:2,level:1100},{beat:8,level:500}]);assert.deepEqual(p,before);
});
test('cutoff decimal text retains64tiny beats and refuses malformed inputs',async()=>{
 const {parseFilterCurve,formatFilterCurve}=await import('../src/filter-curve.ts');const maximum=Array.from({length:64},(_,i)=>({beat:(i+1)*Number.MIN_VALUE,level:20+i*100}));const text=formatFilterCurve(maximum);assert.ok(text.length<=32768);assert.deepEqual(parseFilterCurve(text),maximum);assert.deepEqual(parseFilterCurve('1 20\n1.3333333333333333 10000'),[{beat:0,level:20},{beat:1/3,level:10000}]);
 for(const raw of ['','1 19','1 10001','1 20\n1 40','1e2 500','1 500Hz','1 -20','0 100'])assert.throws(()=>parseFilterCurve(raw));
});
test('extreme cutoff and resonance remain finite at supported rates',()=>{
 const p=fixture();p.tracks[0].filter!.resonance=8;setCurve(p,Array.from({length:64},(_,i)=>({beat:i/100,level:i%2?10000:20})));for(const rate of [8000,22050])assert.ok(renderComposition(p,rate).every(Number.isFinite));
});
test('review regression: rapid sweeps do not explode or collapse later musical content',()=>{
 const p=fixture();p.tracks[0].filter!.resonance=8;setCurve(p,Array.from({length:64},(_,i)=>({beat:i*.00018,level:i%2?10000:20})));const raw=renderDry(p,22050),mixed=renderComposition(p,22050);let peak=0,later=0;for(const s of raw)peak=Math.max(peak,Math.abs(s));for(let i=11025;i<12025;i++)later=Math.max(later,Math.abs(mixed[i]));assert.ok(peak<1,`raw peak ${peak}`);assert.ok(later>.03,`later music ${later}`);
});
test('review regression: overlapping constant curves retain exact static grouping PCM',()=>{
 const p=fixture();p.tracks[0].filter!.cutoff=700;p.tracks[0].notes=[{id:'a',pitch:60,start:0,duration:2,velocity:.5},{id:'b',pitch:62,start:0,duration:2,velocity:.5},{id:'c',pitch:60,start:.25,duration:2,velocity:.5}];const before=renderComposition(p,8000);setCurve(p,[{beat:0,level:700}]);assert.deepEqual(renderComposition(p,8000),before);
});
