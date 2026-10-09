import assert from 'node:assert/strict';
import test from 'node:test';
import {quantizeSection} from '../src/quantize.ts';
import {CompositionHistory} from '../src/history.ts';
import {rollComposition} from './roll-edit-fixtures.ts';
const range={start:'1',end:'4.5'};
test('full strength quantizes original onsets and preserves detached notes, sounds and other tracks',()=>{
 const p=rollComposition();p.tracks[0].echo={beats:1,decay:.5,repeats:3};p.tracks[0].filter={cutoff:500,resonance:.7};const before=structuredClone(p),n=quantizeSection(p,p.tracks[0].id,range,.25,1),expected=structuredClone(p);expected.tracks[0].notes[0].start=.25;expected.tracks[0].notes[2].start=2.25;assert.deepEqual(n,expected);assert.deepEqual(p,before);n.tracks[0].notes[0].pitch=40;n.tracks[0].echo!.beats=2;assert.deepEqual(p,before);
});
test('partial strength, midpoint ties and exclusive original-onset selection keep complete durations',()=>{
 const p=rollComposition(),n=quantizeSection(p,p.tracks[0].id,range,.25,.5);assert.equal(n.tracks[0].notes[0].start,1/3+(.25-1/3)*.5);assert.equal(n.tracks[0].notes[2].start,2.1875);
 p.tracks[0].notes[0].start=.375;p.tracks[0].notes[0].duration=2;const limited=quantizeSection(p,p.tracks[0].id,{start:'1.375',end:'1.5'},.25,1);assert.equal(limited.tracks[0].notes[0].start,.5);assert.equal(limited.tracks[0].notes[0].duration,2);assert.equal(limited.tracks[0].notes[1].start,.5);assert.equal(limited.tracks[0].notes[2].start,2.125);
});
test('zero strength and aligned output preserve a redo branch',()=>{
 const p=rollComposition(),h=new CompositionHistory(p);h.commit(quantizeSection(p,p.tracks[0].id,range,.25,1));h.undo();assert.equal(h.commit(quantizeSection(p,p.tracks[0].id,range,.25,0)),false);assert.equal(h.canRedo,true);h.redo();assert.equal(h.commit(quantizeSection(h.current,p.tracks[0].id,range,.25,1)),false);
});
test('invalid settings, empty selections and timeline overflow refuse the complete operation',()=>{
 const p=rollComposition(),before=structuredClone(p);for(const grid of [0,.3,NaN,Infinity])assert.throws(()=>quantizeSection(p,p.tracks[0].id,range,grid,1));for(const strength of [-.1,1.01,NaN,Infinity])assert.throws(()=>quantizeSection(p,p.tracks[0].id,range,.25,strength));assert.throws(()=>quantizeSection(p,'missing',range,.25,1));assert.throws(()=>quantizeSection(p,p.tracks[0].id,{start:'2',end:'3'},.25,1),/no note/);assert.throws(()=>quantizeSection(p,p.tracks[0].id,{start:'',end:'4'},.25,1));assert.deepEqual(p,before);
 const edge=rollComposition();edge.tracks[0].notes.push({id:'edge',pitch:60,start:511.7,duration:.3,velocity:.5});const original=structuredClone(edge);assert.throws(()=>quantizeSection(edge,edge.tracks[0].id,{start:'1',end:'513'},1,1),/512/);assert.deepEqual(edge,original);
});
