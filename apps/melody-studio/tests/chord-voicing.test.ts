import test from 'node:test';
import assert from 'node:assert/strict';
import { cycleChordVoicing } from '../src/chord-voicing.ts';
import type { Composition } from '../src/types.ts';
const fixture = (): Composition => ({version:1,title:'Octave positions',tempo:120,tracks:[{id:'t',name:'Voice',instrument:'sine',volume:.4,muted:false,panCurve:[{beat:0,level:-1},{beat:8,level:1}],notes:[{id:'middle',pitch:64,start:1,duration:.5,velocity:.7},{id:'high',pitch:67,start:1,duration:.75,velocity:.3},{id:'low',pitch:60,start:1,duration:1,velocity:.5},{id:'near',pitch:79,start:1+Number.EPSILON,duration:.25,velocity:.2}]},{id:'other',name:'Other',instrument:'triangle',volume:.2,muted:true,notes:[{id:'other-note',pitch:72,start:1,duration:.5,velocity:.5}]}]});
test('cycle changes only the boundary pitch while retaining the complete graph and input', () => {
  for (const [direction,id,pitch] of [['up','low',72],['down','high',55]] as const) {
    const p=fixture(),before=structuredClone(p),expected=structuredClone(p); expected.tracks[0].notes.find(n=>n.id===id)!.pitch=pitch;
    assert.deepEqual(cycleChordVoicing(p,'t','middle',direction),expected); assert.deepEqual(p,before);
  }
});
test('wide and exact octave voicings pass the opposite boundary by whole octaves', () => {
  const p=fixture();p.tracks[0].notes=p.tracks[0].notes.slice(0,3);p.tracks[0].notes[1].pitch=84;
  assert.equal(cycleChordVoicing(p,'t','middle','up').tracks[0].notes[2].pitch,96);
  p.tracks[0].notes[0].pitch=72;p.tracks[0].notes[1].pitch=84;
  assert.equal(cycleChordVoicing(p,'t','middle','down').tracks[0].notes[1].pitch,48);
});
test('C2 and C7 admit exact limits and refuse overflow without clamping or partial edits', () => {
  const p=fixture();p.tracks[0].notes=p.tracks[0].notes.slice(0,3);p.tracks[0].notes[0].pitch=86;p.tracks[0].notes[1].pitch=95;p.tracks[0].notes[2].pitch=84;
  assert.equal(cycleChordVoicing(p,'t','middle','up').tracks[0].notes[2].pitch,96);
  p.tracks[0].notes[2].pitch=85;const before=structuredClone(p);assert.throws(()=>cycleChordVoicing(p,'t','middle','up'));assert.deepEqual(p,before);
  p.tracks[0].notes[0].pitch=43;p.tracks[0].notes[1].pitch=48;p.tracks[0].notes[2].pitch=40;
  assert.equal(cycleChordVoicing(p,'t','middle','down').tracks[0].notes[1].pitch,36);
  p.tracks[0].notes[1].pitch=47;assert.throws(()=>cycleChordVoicing(p,'t','middle','down'));
});
test('unrelated external overlaps remain; new moved-voice collision refuses but exact touching is allowed', () => {
  const p=fixture();p.tracks[0].notes.push({id:'external',pitch:72,start:1.5,duration:.5,velocity:.2});
  const before=structuredClone(p);assert.throws(()=>cycleChordVoicing(p,'t','middle','up'),/overlap/i);assert.deepEqual(p,before);
  p.tracks[0].notes.at(-1)!.start=2;assert.equal(cycleChordVoicing(p,'t','middle','up').tracks[0].notes[2].pitch,72);
  p.tracks[0].notes.push({id:'old-unison',pitch:64,start:1.25,duration:1,velocity:.1});
  assert.equal(cycleChordVoicing(p,'t','middle','up').tracks[0].notes[2].pitch,72);
});
test('stale choices singleton unisons drums malformed graphs and unsupported directions refuse', () => {
  const p=fixture(),before=structuredClone(p);
  for(const [t,n] of [['bad','middle'],['t','bad'],['t','near']])assert.throws(()=>cycleChordVoicing(p,t,n,'up'));
  for(const d of ['',null,'sideways',1])assert.throws(()=>cycleChordVoicing(p,'t','middle',d));
  const unison=fixture();unison.tracks[0].notes[1].pitch=64;assert.throws(()=>cycleChordVoicing(unison,'t','middle','up'),/distinct|unison/i);
  const drums=fixture();drums.tracks[0].instrument='drums';assert.throws(()=>cycleChordVoicing(drums,'t','middle','up'),/drum|melodic/i);
  const invalid=fixture();invalid.tracks[1].notes[0].duration=0;assert.throws(()=>cycleChordVoicing(invalid,'t','middle','up'));assert.deepEqual(p,before);
});
test('full256 note graph cycles without allocating IDs or consuming additional note capacity', () => {
 const p=fixture();p.tracks[0].notes.push(...Array.from({length:252},(_,i)=>({id:`extra${i}`,pitch:80,start:8+i,duration:.25,velocity:.2})));
 const out=cycleChordVoicing(p,'t','middle','up');assert.equal(out.tracks[0].notes.length,256);assert.deepEqual(out.tracks[0].notes.map(n=>n.id),p.tracks[0].notes.map(n=>n.id));
});
