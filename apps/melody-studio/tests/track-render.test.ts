import test from 'node:test';
import assert from 'node:assert/strict';
import { isolatedTrack } from '../src/track-render.ts';
import { renderComposition } from '../src/audio.ts';
import type { Composition } from '../src/types.ts';
const project=():Composition=>({version:1,title:'Layered song',tempo:120,tracks:[{id:'a',name:'Early part',instrument:'sine',volume:.4,muted:false,notes:[{id:'n',pitch:69,start:.5,duration:.5,velocity:.5}]},{id:'b',name:'Late part',instrument:'triangle',volume:.6,muted:false,notes:[{id:'m',pitch:60,start:3,duration:.5,velocity:.6}]}]});
test('isolation is detached, preserves whole graph timing and changes only other mute flags',()=>{
 const input=project(),before=structuredClone(input);Object.freeze(input);Object.freeze(input.tracks);for(const t of input.tracks){Object.freeze(t);Object.freeze(t.notes);for(const n of t.notes)Object.freeze(n);}
 const result=isolatedTrack(input,'a');const expected=structuredClone(before);expected.tracks[1].muted=true;
 assert.deepEqual(result,expected);assert.deepEqual(input,before);
 const second=isolatedTrack(input,'b');assert.deepEqual(second.tracks.map(t=>t.muted),[true,false]);
});
test('isolated audio preserves leading rest and complete512-beat song duration with trailing silence',()=>{
 const input=project();input.tempo=40;input.tracks[1].notes[0].start=511.75;input.tracks[1].notes[0].duration=.25;
 const rendered=renderComposition(isolatedTrack(input,'a'),22050);
 assert.equal(rendered.length,16_936_164);assert.ok(rendered.subarray(0,16538).every(v=>v===0));
 assert.ok(rendered.subarray(16538,33075).some(v=>v!==0));assert.ok(rendered.subarray(35000).every(v=>v===0));
});
test('muted, zero-volume, empty, zero-velocity, missing and malformed selected tracks refuse without changes',()=>{
 const settings=[{muted:true},{volume:0},{notes:[]},{notes:[{id:'n',pitch:69,start:.5,duration:.5,velocity:0}]}];
 for(const change of settings){const input=project();Object.assign(input.tracks[0],change);const before=structuredClone(input);assert.throws(()=>isolatedTrack(input,'a'));assert.deepEqual(input,before);}
 assert.throws(()=>isolatedTrack(project(),'unknown'));const invalid=project();invalid.tempo=0;assert.throws(()=>isolatedTrack(invalid,'a'));
});
