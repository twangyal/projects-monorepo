import assert from 'node:assert/strict';
import test from 'node:test';
import {transposeSection,invertSection} from '../src/section-pitch.ts';
import {CompositionHistory} from '../src/history.ts';
import {rollComposition} from './roll-edit-fixtures.ts';
const range={start:'1',end:'4.5'};
test('section transpose preserves complete detached sounds, lengths and other tracks',()=>{
 const p=rollComposition();p.tracks[0].echo={beats:1,decay:.5,repeats:3};p.tracks[0].filter={cutoff:500,resonance:.7};const before=structuredClone(p),expected=structuredClone(p);expected.tracks[0].notes[2].pitch=65;const n=transposeSection(p,p.tracks[0].id,{start:'2',end:'4.5'},1);assert.deepEqual(n,expected);n.tracks[0].echo!.beats=2;n.tracks[0].notes[2].start=0;assert.deepEqual(p,before);
 for(const step of [-12,-1,1,12])assert.deepEqual(transposeSection(p,p.tracks[0].id,range,step).tracks[0].notes.map(n=>n.pitch),[60+step,67+step,64+step]);
});
test('inversion uses lowest pitch of earliest included chord independent of storage order',()=>{
 const p=rollComposition();p.tracks[0].notes[0].start=.5;const n=invertSection(p,p.tracks[0].id,range);assert.deepEqual(n.tracks[0].notes.map(n=>n.pitch),[60,53,56]);p.tracks[0].notes.reverse();assert.deepEqual(invertSection(p,p.tracks[0].id,range).tracks[0].notes.map(n=>n.pitch),[56,53,60]);
});
test('exclusive original onsets include crossing notes whole and exclude the end',()=>{
 const p=rollComposition();p.tracks[0].notes[0].duration=2;const n=transposeSection(p,p.tracks[0].id,{start:String(1+1/3),end:'1.5'},1);assert.deepEqual(n.tracks[0].notes.map(n=>n.pitch),[61,67,64]);assert.equal(n.tracks[0].notes[0].duration,2);
});
test('unison inversion is a no-op and retains redo',()=>{
 const p=rollComposition();for(const n of p.tracks[0].notes)n.pitch=60;const h=new CompositionHistory(p);h.commit(transposeSection(p,p.tracks[0].id,range,1));h.undo();assert.equal(h.commit(invertSection(h.current,p.tracks[0].id,range)),false);assert.equal(h.canRedo,true);
});
test('invalid operations, empty ranges and any out-of-range pitch refuse atomically',()=>{
 const p=rollComposition(),before=structuredClone(p);for(const step of [0,2,NaN,Infinity])assert.throws(()=>transposeSection(p,p.tracks[0].id,range,step));assert.throws(()=>invertSection(p,'missing',range));assert.throws(()=>invertSection(p,p.tracks[0].id,{start:'2',end:'3'}),/no note/);assert.throws(()=>invertSection(p,p.tracks[0].id,{start:'',end:'3'}));assert.deepEqual(p,before);
 p.tracks[0].notes[2].pitch=96;const edge=structuredClone(p);assert.throws(()=>transposeSection(p,p.tracks[0].id,range,1),/pitch/i);assert.deepEqual(p,edge);p.tracks[0].notes[0].pitch=36;const low=structuredClone(p);assert.throws(()=>invertSection(p,p.tracks[0].id,range),/pitch/i);assert.deepEqual(p,low);
});
