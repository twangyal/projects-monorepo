import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVelocityRamp } from '../src/velocity-ramp.ts';
import { rollComposition } from './roll-edit-fixtures.ts';
const range = {start:'1',end:'4.5'};
test('ramp uses musical onsets, preserves all other data and returns a detached graph',()=>{
 const p=rollComposition();p.tracks[0].notes.push({...p.tracks[0].notes[1],id:'chord'});const before=structuredClone(p);
 const n=applyVelocityRamp(p,p.tracks[0].id,range,.2,.8);
 assert.deepEqual(p,before);assert.equal(n.tracks[0].notes[0].velocity,.2);assert.equal(n.tracks[0].notes[2].velocity,.8);
 assert.ok(Math.abs(n.tracks[0].notes[1].velocity-(.2+(.5-1/3)/(2.125-1/3)*.6))<1e-12);
 assert.equal(n.tracks[0].notes[1].velocity,n.tracks[0].notes[3].velocity);
 const restored=structuredClone(n);restored.tracks[0].notes.forEach((note,i)=>note.velocity=before.tracks[0].notes[i].velocity);assert.deepEqual(restored,before);
 n.tracks[1].notes[0].pitch=40;assert.deepEqual(p,before);
});
test('fractional bounds include onset at start, exclude onset at end and allow crossing durations',()=>{
 const p=rollComposition();p.tracks[0].notes[0].start=.25;const n=applyVelocityRamp(p,p.tracks[0].id,{start:'1.25',end:'3.125'},1,0);
 assert.deepEqual(n.tracks[0].notes.map(x=>x.velocity),[1,0,.75]);
});
test('descending and flat ramps preserve sound settings',()=>{
 const p=rollComposition();p.tracks[0].filter={cutoff:800,resonance:.7};p.tracks[0].envelope={attack:.01,decay:.1,sustain:.5,release:.2};
 const n=applyVelocityRamp(p,p.tracks[0].id,range,.9,.1);assert.equal(n.tracks[0].notes[0].velocity,.9);assert.equal(n.tracks[0].notes[2].velocity,.1);assert.deepEqual(n.tracks[0].filter,p.tracks[0].filter);assert.deepEqual(n.tracks[0].envelope,p.tracks[0].envelope);
 assert.deepEqual(applyVelocityRamp(p,p.tracks[0].id,range,.4,.4).tracks[0].notes.map(x=>x.velocity),[.4,.4,.4]);
});
test('invalid parameters, missing track, empty and one-onset selections refuse atomically',()=>{
 const p=rollComposition(),before=structuredClone(p);
 for(const v of [NaN,Infinity,-.1,1.1]){assert.throws(()=>applyVelocityRamp(p,p.tracks[0].id,range,v,.5));assert.throws(()=>applyVelocityRamp(p,p.tracks[0].id,range,.5,v));}
 assert.throws(()=>applyVelocityRamp(p,'missing',range,.2,.8),/track/i);
 for(const r of [{start:'1.6',end:'2'},{start:'3',end:'4'},{start:'',end:'4'}])assert.throws(()=>applyVelocityRamp(p,p.tracks[0].id,r,.2,.8));assert.deepEqual(p,before);
});
