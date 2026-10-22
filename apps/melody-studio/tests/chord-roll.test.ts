import test from 'node:test';
import assert from 'node:assert/strict';
import { rollChord } from '../src/chord-roll.ts';
import type { Composition } from '../src/types.ts';
const fixture = (): Composition => ({version:1,title:'Rolled attacks',tempo:120,tracks:[{id:'t',name:'Voice',instrument:'sine',volume:.4,muted:false,panCurve:[{beat:0,level:-1},{beat:8,level:1}],notes:[{id:'middle',pitch:64,start:1,duration:.5,velocity:.7},{id:'high',pitch:67,start:1,duration:.75,velocity:.3},{id:'low',pitch:60,start:1,duration:1,velocity:.5},{id:'near',pitch:79,start:1+Number.EPSILON,duration:.25,velocity:.2}]},{id:'other',name:'Other',instrument:'triangle',volume:.2,muted:true,notes:[{id:'other-note',pitch:72,start:1,duration:.5,velocity:.5}]}]});
test('roll orders exact-onset attacks by pitch without changing note identity length or expression', () => {
  for(const [direction,starts] of [['up',[1.5,2,1]],['down',[1.5,1,2]]] as const){
    const p=fixture(),before=structuredClone(p),result=rollChord(p,'t','middle',direction,.5),expected=structuredClone(p);
    expected.tracks[0].notes.slice(0,3).forEach((note,i)=>{note.start=starts[i];});
    assert.deepEqual(result,expected);assert.deepEqual(p,before);
  }
});
test('supported spacings preserve ordering and admit the complete 256-note graph', () => {
  for(const spacing of [.25,.5,1]){const p=fixture();p.tracks[0].notes.push(...Array.from({length:252},(_,i)=>({id:`extra${i}`,pitch:80,start:8+i,duration:.25,velocity:.2})));const out=rollChord(p,'t','middle','up',spacing);assert.equal(out.tracks[0].notes.length,256);assert.equal(out.tracks[0].notes[1].start,1+2*spacing);}
});
test('stale selection single notes unisons drums and malformed full graphs refuse atomically', () => {
  const p=fixture(),before=structuredClone(p);
  for(const [t,n] of [['missing','middle'],['t','missing'],['t','near']])assert.throws(()=>rollChord(p,t,n,'up',.25));
  const unison=fixture();unison.tracks[0].notes[1].pitch=64;assert.throws(()=>rollChord(unison,'t','middle','up',.25),/unison|distinct|duplicate/i);
  const drums=fixture();drums.tracks[0].instrument='drums';assert.throws(()=>rollChord(drums,'t','middle','up',.25),/melodic|drum/i);
  const invalid=fixture();invalid.tracks[1].notes[0].duration=0;assert.throws(()=>rollChord(invalid,'t','middle','up',.25));assert.deepEqual(p,before);
});
test('invalid direction and spacing never change the source', () => {
  const p=fixture(),before=structuredClone(p);
  for(const direction of ['sideways','',null,1])assert.throws(()=>rollChord(p,'t','middle',direction,.25));
  for(const spacing of [0,-.25,.125,2,NaN,Infinity,'0.5',null])assert.throws(()=>rollChord(p,'t','middle','up',spacing));
  assert.deepEqual(p,before);
});
test('the last shifted release must fit the unchanged512-beat bound', () => {
  const p=fixture();p.tracks[0].notes=p.tracks[0].notes.slice(0,3).map(note=>({...note,start:510.5,duration:.5}));
  assert.equal(rollChord(p,'t','middle','up',.5).tracks[0].notes[1].start+ .5,512);
  assert.throws(()=>rollChord(p,'t','middle','up',1),/512|end|timeline|beat/i);
});
test('a newly overlapping external unison refuses while exact touching remains valid', () => {
  const p=fixture();p.tracks[0].notes.push({id:'later-unison',pitch:64,start:1.75,duration:.5,velocity:.2});
  const before=structuredClone(p);assert.throws(()=>rollChord(p,'t','middle','up',.5),/overlap|voice/i);assert.deepEqual(p,before);
  p.tracks[0].notes.at(-1)!.start=2;assert.equal(rollChord(p,'t','middle','up',.5).tracks[0].notes.at(-1)!.start,2);
});
test('preexisting external unison overlaps are kept rather than silently repaired or treated as new', () => {
  const p=fixture();p.tracks[0].notes.push({id:'existing-overlap',pitch:64,start:1.25,duration:1,velocity:.2});
  const out=rollChord(p,'t','middle','up',.5);assert.equal(out.tracks[0].notes.find(n=>n.id==='middle')!.start,1.5);assert.deepEqual(out.tracks[0].notes.at(-1),p.tracks[0].notes.at(-1));
});
