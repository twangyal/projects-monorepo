import assert from 'node:assert/strict';
import test from 'node:test';
import * as quantize from '../src/quantize.ts';
import type {Composition} from '../src/types.ts';
import type {SectionRange} from '../src/section.ts';
import {CompositionHistory} from '../src/history.ts';
import {rollComposition} from './roll-edit-fixtures.ts';
const apply=(quantize as unknown as {quantizeSectionDurations:(p:Composition,id:string,r:SectionRange,g:number,s:number)=>Composition}).quantizeSectionDurations;
const range={start:'1',end:'4.5'};
test('duration quantization changes only held lengths and preserves detached complete track data',()=>{
 assert.equal(typeof apply,'function');const p=rollComposition();p.tracks[0].volumeRamp={start:0,end:4,from:1,to:0};p.tracks[0].echo={beats:1,decay:.5,repeats:3};const before=structuredClone(p),expected=structuredClone(p);[.5,1,.5].forEach((d,i)=>expected.tracks[0].notes[i].duration=d);
 const n=apply(p,p.tracks[0].id,range,.5,1);assert.deepEqual(n,expected);assert.deepEqual(p,before);n.tracks[0].volumeRamp!.from=0;assert.deepEqual(p,before);
});
test('partial strength, positive coarse targets and midpoint ties preserve original onset selection',()=>{
 assert.equal(typeof apply,'function');const p=rollComposition();const n=apply(p,p.tracks[0].id,range,.5,.5);assert.equal(n.tracks[0].notes[0].duration,2/3+(.5-2/3)*.5);assert.equal(n.tracks[0].notes[1].duration,.875);assert.equal(n.tracks[0].notes[2].duration,.4375);
 p.tracks[0].notes[0].duration=.25;const limited=apply(p,p.tracks[0].id,{start:'1',end:'1.5'},1,1);assert.equal(limited.tracks[0].notes[0].duration,1);assert.deepEqual(limited.tracks[0].notes.slice(1),p.tracks[0].notes.slice(1));
 for(const grid of [1,.5,.25,.125]){p.tracks[0].notes[0].duration=16;assert.equal(apply(p,p.tracks[0].id,range,grid,1).tracks[0].notes[0].duration,16);}
});
test('zero and aligned output retain Redo and successful duration edit is one history step',()=>{
 assert.equal(typeof apply,'function');const p=rollComposition(),h=new CompositionHistory(p);assert.equal(h.commit(apply(p,p.tracks[0].id,range,.5,1)),true);const changed=structuredClone(h.current);h.undo();assert.deepEqual(h.current,p);assert.equal(h.commit(apply(p,p.tracks[0].id,range,.5,0)),false);assert.equal(h.canRedo,true);h.redo();assert.deepEqual(h.current,changed);assert.equal(h.commit(apply(h.current,p.tracks[0].id,range,.5,1)),false);
});
test('invalid settings empty selection and timeline overflow refuse atomically',()=>{
 assert.equal(typeof apply,'function');const p=rollComposition(),before=structuredClone(p);for(const g of [0,.3,NaN,Infinity])assert.throws(()=>apply(p,p.tracks[0].id,range,g,1));for(const s of [-1,1.01,NaN,Infinity])assert.throws(()=>apply(p,p.tracks[0].id,range,.5,s));assert.throws(()=>apply(p,'missing',range,.5,1));assert.throws(()=>apply(p,p.tracks[0].id,{start:'2',end:'3'},.5,1),/no note/);assert.throws(()=>apply(p,p.tracks[0].id,{start:'',end:'4'},.5,1));assert.deepEqual(p,before);
 p.tracks[0].notes.push({id:'edge',pitch:60,start:511.7,duration:.3,velocity:.5});const h=new CompositionHistory(p);const changed=structuredClone(p);changed.title='redo';h.commit(changed);h.undo();assert.throws(()=>h.commit(apply(h.current,p.tracks[0].id,{start:'1',end:'513'},1,1)),/512/);assert.deepEqual(h.current,p);assert.equal(h.canRedo,true);
});
test('exclusive end onset stays intact while selected held notes may extend across that end',()=>{
 assert.equal(typeof apply,'function');const p=rollComposition(),before=structuredClone(p);const n=apply(p,p.tracks[0].id,{start:'1',end:'1.5'},1,1),expected=structuredClone(p);expected.tracks[0].notes[0].duration=1;assert.deepEqual(n,expected);assert.equal(n.tracks[0].notes[1].start,.5);assert.equal(n.tracks[0].notes[1].duration,.75);assert.ok(n.tracks[0].notes[0].start+n.tracks[0].notes[0].duration>.5);assert.deepEqual(p,before);
});
