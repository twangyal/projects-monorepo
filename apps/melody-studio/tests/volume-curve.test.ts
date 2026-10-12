import test from 'node:test';
import assert from 'node:assert/strict';
import * as curve from '../src/volume-curve.ts';
import {validateComposition,serializeComposition,parseComposition} from '../src/model.ts';
import {renderComposition} from '../src/audio.ts';
import {auditionComposition,suggestEnding} from '../src/continuation.ts';
import type {Composition} from '../src/types.ts';
const api=curve as unknown as {parseVolumeCurve:(text:string)=>{beat:number;level:number}[];validateVolumeCurve:(value:unknown)=>{beat:number;level:number}[]};
const fixture=():Composition=>({version:1,title:'Curve',tempo:120,tracks:[{id:'voice',name:'Voice',instrument:'sine',volume:.3,muted:false,notes:[{id:'n',pitch:69,start:.125,duration:4,velocity:.5}]}]});
test('strict breakpoints retain complete projects and parse one-based text without partial edits',()=>{
 assert.equal(typeof api.parseVolumeCurve,'function');const points=[{beat:0,level:1},{beat:1.25,level:.2},{beat:3,level:.8}];assert.deepEqual(api.parseVolumeCurve('1 1\n2.25 .2\n4 .8'),points);
 const p=fixture();Object.assign(p.tracks[0],{volumeCurve:points});assert.deepEqual(validateComposition(p),p);assert.deepEqual(parseComposition(serializeComposition(p)),p);
 for(const v of [[],Array.from({length:65},(_,beat)=>({beat,level:1})),[{beat:0,level:1},{beat:0,level:0}],[{beat:2,level:1},{beat:1,level:0}],[{beat:-1,level:0}],[{beat:513,level:0}],[{beat:1,level:NaN}],[{beat:1,level:2}],[{beat:1,level:1,extra:true}],new Array(1)])assert.throws(()=>api.validateVolumeCurve(v));
 let reads=0;assert.throws(()=>api.validateVolumeCurve([{get beat(){reads++;return 1;},level:1}]));assert.equal(reads,0);
 for(const raw of ['', '1 1 2','2 1\n1 0','0 0','1 Infinity','1 .2\n1 .5','1e2 1'])assert.throws(()=>api.parseVolumeCurve(raw));
});
test('piecewise gain reaches multiple turns and multiplies sustained releases echoes and existing ramp',()=>{
 const p=fixture();p.tracks[0].echo={beats:.5,decay:.4,repeats:2};const dry=renderComposition(p,8000);
 const points=[{beat:.5,level:1},{beat:1.5,level:0},{beat:2.5,level:.5},{beat:3.5,level:.25}];Object.assign(p.tracks[0],{volumeCurve:points});p.tracks[0].volumeRamp={start:0,end:5,from:1,to:.5};const wet=renderComposition(p,8000);
 for(let i=0;i<dry.length;i+=23){const b=i/4000,g=b<=.5?1:b<=1.5?1-(b-.5):b<=2.5?.5*(b-1.5):b<=3.5?.5-.25*(b-2.5):.25,r=b>=5?.5:1-.1*b;assert.ok(Math.abs(wet[i]-dry[i]*g*r)<1e-7,`frame${i}`);}
 const unity=fixture(),legacy=renderComposition(unity,8000);Object.assign(unity.tracks[0],{volumeCurve:[{beat:0,level:1}]});assert.deepEqual(renderComposition(unity,8000),legacy);
});
test('continuation audition shifts automation while retaining original absolute-time levels',()=>{
 const p=fixture();p.tracks[0].notes=Array.from({length:8},(_,i)=>({id:`s${i}`,pitch:60+i%3,start:8+i,duration:.5,velocity:.5}));Object.assign(p.tracks[0],{volumeCurve:[{beat:0,level:1},{beat:10,level:0},{beat:16,level:.6}]});
 const proposal=suggestEnding(p,'voice',8,4,1),audition=auditionComposition(proposal);
 const points=(audition.tracks[0] as unknown as {volumeCurve:{beat:number;level:number}[]}).volumeCurve;assert.ok(Math.abs(points[0].level-.2)<1e-12);assert.deepEqual(points.map(p=>p.beat),[0,2,8]);assert.deepEqual(points.slice(1),[{beat:2,level:0},{beat:8,level:.6}]);
});
test('identical voices with complementary curves keep independent gain rather than sharing one curve',()=>{
 const p=fixture(),dry=renderComposition(p,8000),a=[{beat:0,level:1},{beat:1,level:0},{beat:2,level:1}],b=[{beat:0,level:0},{beat:1,level:1},{beat:2,level:0}];p.tracks[0].volumeCurve=a;
 const other=structuredClone(p.tracks[0]);other.id='other';other.notes[0].id='other-note';other.volumeCurve=b;p.tracks.push(other);const wet=renderComposition(p,8000);for(let i=0;i<wet.length;i+=17)assert.ok(Math.abs(wet[i]-dry[i])<1e-7);
});
test('maximum curve survives audition shifts before first or after last point without adding a65th point',()=>{
 const shift=(curve as unknown as {shiftVolumeCurve:(v:{beat:number;level:number}[],s:number)=>{beat:number;level:number}[]}).shiftVolumeCurve;
 const original=Array.from({length:64},(_,i)=>({beat:20+i,level:i%2}));assert.equal(shift(original,8).length,64);assert.deepEqual(shift(original,90),[{beat:0,level:1}]);assert.deepEqual(original[0],{beat:20,level:0});
});
test('committed decimal curve text round-trips tiny levels and fractional song beats without numeric drift',()=>{
 const format=(curve as unknown as {formatVolumeCurve:(v:{beat:number;level:number}[])=>string}).formatVolumeCurve;assert.equal(typeof format,'function');
 const points=[{beat:0,level:1e-7},{beat:1e-20,level:Number.MIN_VALUE},{beat:1/3,level:.5},{beat:512,level:0}];assert.deepEqual(api.parseVolumeCurve(format(points)),points);
 const maximum=Array.from({length:64},(_,i)=>({beat:i/100,level:Number.MIN_VALUE}));const text=format(maximum);assert.ok(text.length<=32768);assert.deepEqual(api.parseVolumeCurve(text),maximum);
});
test('top-level curve accessors are refused without reading while complete documents retain valid curves',()=>{
 const p=fixture();let reads=0;Object.defineProperty(p.tracks[0],'volumeCurve',{enumerable:true,get(){reads++;return[{beat:0,level:1}];}});assert.throws(()=>validateComposition(p));assert.equal(reads,0);
});
