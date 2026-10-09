import assert from 'node:assert/strict';
import test from 'node:test';
import {reverseSection} from '../src/section-reverse.ts';
import {CompositionHistory} from '../src/history.ts';
import {rollComposition} from './roll-edit-fixtures.ts';
const range={start:'1',end:'4.5'};
test('reverse whole note intervals and rests with complete detached sounds and other tracks',()=>{
 const p=rollComposition();p.tracks[0].echo={beats:1,decay:.5,repeats:3};p.tracks[0].filter={cutoff:500,resonance:.7};const before=structuredClone(p),n=reverseSection(p,p.tracks[0].id,range),expected=structuredClone(p);expected.tracks[0].notes[0].start=2.5;expected.tracks[0].notes[1].start=2.25;expected.tracks[0].notes[2].start=1;assert.deepEqual(n,expected);n.tracks[0].echo!.beats=2;n.tracks[0].notes[0].pitch=40;assert.deepEqual(p,before);
});
test('fractional section origin, whole lengths, exact boundary and outside notes',()=>{
 const p=rollComposition();p.tracks[0].notes=[{id:'before',pitch:60,start:0,duration:.25,velocity:.5},{id:'first',pitch:61,start:.5,duration:.5,velocity:.6},{id:'middle',pitch:62,start:1.25,duration:.75,velocity:.7},{id:'last',pitch:63,start:2,duration:.5,velocity:.8}];const n=reverseSection(p,p.tracks[0].id,{start:'1.5',end:'3'});assert.deepEqual(n.tracks[0].notes.map(n=>n.start),[0,1.5,.5,2]);assert.deepEqual(reverseSection(n,p.tracks[0].id,{start:'1.5',end:'3'}),p);
});
test('crossing selected-track notes refuse before any edit; other-track crossings remain untouched',()=>{
 const p=rollComposition(),before=structuredClone(p);assert.throws(()=>reverseSection(p,p.tracks[0].id,{start:'1.5',end:'3.5'}),/crosses/);assert.throws(()=>reverseSection(p,p.tracks[0].id,{start:'1',end:'2'}),/crosses/);assert.deepEqual(p,before);p.tracks[1].notes[0].start=0;p.tracks[1].notes[0].duration=4;const n=reverseSection(p,p.tracks[0].id,range);assert.deepEqual(n.tracks[1],p.tracks[1]);
});
test('symmetric interval no-op retains redo',()=>{
 const p=rollComposition();p.tracks[0].notes=[{id:'symmetric',pitch:60,start:1.5,duration:.5,velocity:.5}];const h=new CompositionHistory(p),changed=structuredClone(p);changed.title='Changed';h.commit(changed);h.undo();assert.equal(h.commit(reverseSection(h.current,p.tracks[0].id,range)),false);assert.equal(h.canRedo,true);
});
test('missing/empty/invalid selections retain the source',()=>{
 const p=rollComposition(),before=structuredClone(p);assert.throws(()=>reverseSection(p,'missing',range));assert.throws(()=>reverseSection(p,p.tracks[0].id,{start:'2.5',end:'3'}),/no note/);for(const r of [{start:'',end:'3'},{start:'4',end:'2'},{start:'1',end:'513'}])assert.throws(()=>reverseSection(p,p.tracks[0].id,r));assert.deepEqual(p,before);
});
