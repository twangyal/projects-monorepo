import assert from 'node:assert/strict';
import test from 'node:test';
import { duplicateSection } from '../src/section-arrangement.ts';
import type { Composition, Note } from '../src/types.ts';
const note = (id: string, start: number, duration = .5): Note => ({id, start, duration, pitch: 60, velocity: .7});
const fixture = (): Composition => ({version: 1, title: 'Layered section', tempo: 137, tracks: [
  {id: 'lead', name: 'Lead', instrument: 'triangle', volume: .3, muted: false, notes: [note('before', 0), note('inside', 1.25, .75), note('edge', 2.5, .5), note('later', 3)]},
  {id: 'bass', name: 'Muted bass', instrument: 'sawtooth', volume: .8, muted: true, notes: [note('bass-inside', 1.5), note('bass-later', 4)]},
]});
const range = {start: '2', end: '4'};
test('duplicates contained notes on all tracks and shifts later notes by exact span', () => {
 const input = fixture(), before = structuredClone(input);
 for(const track of input.tracks) {track.notes.forEach(Object.freeze);Object.freeze(track.notes);Object.freeze(track);}Object.freeze(input.tracks);Object.freeze(input);
 const output = duplicateSection(input, range);
 assert.deepEqual(input, before);
 assert.deepEqual(output.tracks[0].notes.filter(n => ['before','inside','edge','later'].includes(n.id)).map(n=>[n.id,n.start]), [['before',0],['inside',1.25],['edge',2.5],['later',5]]);
 assert.deepEqual(output.tracks[0].notes.filter(n=>!input.tracks[0].notes.some(o=>o.id===n.id)).map(({start,duration,pitch,velocity})=>({start,duration,pitch,velocity})), [{start:3.25,duration:.75,pitch:60,velocity:.7},{start:4.5,duration:.5,pitch:60,velocity:.7}]);
 assert.deepEqual(output.tracks[1].notes.map(n=>n.start), [1.5,6,3.5]);
 assert.equal(output.tracks[1].muted,true);
 assert.equal(output.tracks[1].volume,.8);
 const ids=output.tracks.flatMap(t=>[t.id,...t.notes.map(n=>n.id)]); assert.equal(new Set(ids).size,ids.length);
 output.tracks[0].notes[0].pitch=72; assert.deepEqual(input,before);
});
test('fractional section preserves exact offsets and both adjacent boundaries', () => {
 const input=fixture();input.tracks[0].notes=[note('left',0,1.125),note('fractional',1.125,.75),note('right',2.375,.5)];input.tracks[1].notes=[];
 const output=duplicateSection(input,{start:'2.125',end:'3.375'});
 assert.deepEqual(output.tracks[0].notes.map(n=>[n.start,n.duration]),[[0,1.125],[1.125,.75],[3.625,.5],[2.375,.75]]);
});
test('crossing either boundary anywhere refuses without mutating earlier tracks', () => {
 for(const n of [note('cross-left',.75,.5),note('cross-right',2.75,.5),note('covers',0,4)]) {
  const input=fixture();input.tracks[1].notes.push(n);const before=structuredClone(input);
  assert.throws(()=>duplicateSection(input,range),/crosses/);assert.deepEqual(input,before);
 }
});
test('empty selected section and malformed range refuse atomically',()=>{
 const input=fixture();const before=structuredClone(input);
 assert.throws(()=>duplicateSection(input,{start:'1.6',end:'2'}),/no notes/);
 for(const r of [{start:'',end:'4'},{start:'4',end:'2'},{start:'1',end:'130'}])assert.throws(()=>duplicateSection(input,r));
 assert.deepEqual(input,before);
});
test('late-track quotas and global end guard refuse without partial edits',()=>{
 const input=fixture();input.tracks[1].notes=Array.from({length:256},(_,i)=>note(`many-${i}`,1.5));const before=structuredClone(input);
 assert.throws(()=>duplicateSection(input,range),/256/);assert.deepEqual(input,before);
 const far=fixture();far.tracks[1].notes.push(note('far',511,.5));const original=structuredClone(far);
 assert.throws(()=>duplicateSection(far,range),/512/);assert.deepEqual(far,original);
});

test('eight tracks expand to exactly2048 notes ending at128 with preserved originals', () => {
 const input:Composition={version:1,title:'Capacity section',tempo:120,tracks:Array.from({length:8},(_,t)=>({id:`track-${t}`,name:`Part ${t}`,instrument:'sine',volume:.1,muted:t===7,notes:Array.from({length:128},(_,i)=>({...note(`note-${t}-${i}`,i*.5),pitch:48+t}))}))};
 const before=structuredClone(input),output=duplicateSection(input,{start:'1',end:'65'});
 assert.deepEqual(input,before);
 for(let t=0;t<8;t++) {
  assert.equal(output.tracks[t].notes.length,256);
  assert.deepEqual(output.tracks[t].notes.slice(0,128),input.tracks[t].notes);
  assert.deepEqual(output.tracks[t].notes.slice(128).map(n=>[n.pitch,n.start,n.duration,n.velocity]),input.tracks[t].notes.map(n=>[n.pitch,n.start+64,n.duration,n.velocity]));
 }
 assert.equal(Math.max(...output.tracks.flatMap(t=>t.notes.map(n=>n.start+n.duration))),128);
 const full=structuredClone(output);assert.throws(()=>duplicateSection(output,{start:'1',end:'65'}),/256/);assert.deepEqual(output,full);
});
