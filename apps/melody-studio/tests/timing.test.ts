import test from 'node:test';
import assert from 'node:assert/strict';
import { quantizeTrack } from '../src/timing.ts';
import type { Composition } from '../src/types.ts';
const project = (starts = [.12, .375, .87]): Composition => ({version:1,title:'Loose phrase',tempo:120,tracks:[{id:'lead',name:'Lead',instrument:'sine',volume:.4,muted:false,notes:starts.map((start,i)=>({id:`n${i}`,pitch:60+i,start,duration:.25,velocity:.5}))},{id:'other',name:'Other',instrument:'triangle',volume:.5,muted:true,notes:[]}]});
test('straight quantization moves onsets to nearest grid with later ties, preserving all other fields',()=>{
 const source=project(); const original=structuredClone(source);
 Object.freeze(source);Object.freeze(source.tracks);for(const t of source.tracks){Object.freeze(t);Object.freeze(t.notes);for(const n of t.notes)Object.freeze(n);}
 const result=quantizeTrack(source,'lead',{grid:.25,strength:1,swing:0});
 assert.deepEqual(result.composition.tracks[0].notes.map(n=>n.start),[0,.5,.75]);
 assert.deepEqual(result.changes.map(c=>[c.id,c.before,c.after]),[['n0',.12,0],['n1',.375,.5],['n2',.87,.75]]);
 const expected=structuredClone(original);expected.tracks[0].notes.forEach((n,i)=>n.start=[0,.5,.75][i]);
 assert.deepEqual(result.composition,expected);assert.deepEqual(source,original);
});
test('swing delays odd pair subdivisions and strength blends without quantizing note lengths',()=>{
 const input=project([.4,.8125,1.12]);input.tracks[0].notes[0].duration=2/3;
 const swung=quantizeTrack(input,'lead',{grid:.5,strength:1,swing:.25});
 assert.deepEqual(swung.composition.tracks[0].notes.map(n=>n.start),[.625,1,1]);
 const partial=quantizeTrack(input,'lead',{grid:.5,strength:.5,swing:.25});
 assert.deepEqual(partial.composition.tracks[0].notes.map(n=>n.start),[.5125,.90625,1.06]);
 assert.equal(partial.composition.tracks[0].notes[0].duration,2/3);
 assert.equal(quantizeTrack(input,'lead',{grid:.5,strength:0,swing:.5}).changes.length,0);
});
test('every supported grid works at distant song positions and exact endpoint is admitted',()=>{
 for(const [grid,start,end] of [[1,300.6,301],[.5,300.3,300.5],[.25,300.15,300.25],[.125,300.08,300.125]])assert.equal(quantizeTrack(project([start]),'lead',{grid,strength:1,swing:0}).composition.tracks[0].notes[0].start,end);
 const exact=project([511.74]);assert.equal(quantizeTrack(exact,'lead',{grid:.25,strength:1,swing:0}).composition.tracks[0].notes[0].start,511.75);
 const overflow=project([511.74]);overflow.tracks[0].notes[0].duration=.26;
 assert.throws(()=>quantizeTrack(overflow,'lead',{grid:.25,strength:1,swing:0}),/end by beat/);
 assert.equal(overflow.tracks[0].notes[0].start,511.74);
});
test('invalid settings, unknown track, empty part and malformed composition refuse atomically',()=>{
 for(const options of [{grid:0,strength:1,swing:0},{grid:.3,strength:1,swing:0},{grid:.25,strength:NaN,swing:0},{grid:.25,strength:-.1,swing:0},{grid:.25,strength:1.1,swing:0},{grid:.25,strength:1,swing:.51},{grid:.25,strength:1,swing:Infinity}])assert.throws(()=>quantizeTrack(project(),'lead',options));
 assert.throws(()=>quantizeTrack(project(),'missing',{grid:.25,strength:1,swing:0}));
 assert.throws(()=>quantizeTrack(project(),'other',{grid:.25,strength:1,swing:0}));
 assert.throws(()=>quantizeTrack(project([-1]),'lead',{grid:.25,strength:1,swing:0}));
});
