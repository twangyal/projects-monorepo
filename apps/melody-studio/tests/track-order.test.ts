import test from 'node:test';
import assert from 'node:assert/strict';
import * as order from '../src/track-order.ts';
import type {Composition} from '../src/types.ts';
type Move=(p:Composition,id:string,delta:unknown)=>Composition;
const move=(...args:Parameters<Move>)=>(order as unknown as{moveTrack:Move}).moveTrack(...args);
const fixture=():Composition=>({version:1,title:'Layer order',tempo:120,reverb:{size:.4,level:.2},tracks:[{id:'lead',name:'Lead',instrument:'sine',volume:.4,muted:false,panCurve:[{beat:0,level:-1},{beat:8,level:1}],envelope:{attack:.1,decay:.2,sustain:.7,release:.3},notes:[{id:'voice',pitch:60,start:1/3,duration:2/3,velocity:.6}]},{id:'drums',name:'Drums',instrument:'drums',volume:.3,muted:true,notes:[{id:'hit',pitch:36,start:.5,duration:.25,velocity:.8}]}]});
test('reordering changes only track sequence while retaining complete track and song data',()=>{
 assert.equal(typeof (order as Record<string,unknown>).moveTrack,'function');const p=fixture(),before=structuredClone(p),out=move(p,'lead',1);assert.deepEqual(out,{...before,tracks:[before.tracks[1],before.tracks[0]]});assert.deepEqual(move(out,'lead',-1),before);assert.deepEqual(p,before);
});
test('boundaries are no-ops and stale selections invalid steps and malformed graphs refuse atomically',()=>{
 const p=fixture(),before=structuredClone(p);assert.deepEqual(move(p,'lead',-1),p);assert.deepEqual(move(p,'drums',1),p);
 for(const delta of [0,2,-2,'1',NaN,Infinity,null])assert.throws(()=>move(p,'lead',delta));assert.throws(()=>move(p,'stale',1));assert.deepEqual(p,before);const bad=fixture();bad.tracks[1].notes[0].duration=0;assert.throws(()=>move(bad,'lead',1));
});
test('eight full tracks retain every note and automation through repeated adjacent moves',()=>{
 const p=fixture();p.tracks=Array.from({length:8},(_,i)=>({...p.tracks[0],id:`track${i}`,notes:Array.from({length:256},(_,j)=>({id:`note${i}-${j}`,pitch:60,start:j,duration:.5,velocity:.5}))}));const before=structuredClone(p);let out=p;for(let i=0;i<7;i++)out=move(out,'track0',1);assert.deepEqual(out.tracks.map(t=>t.id),['track1','track2','track3','track4','track5','track6','track7','track0']);for(const t of out.tracks)assert.deepEqual(t,before.tracks.find(x=>x.id===t.id));assert.deepEqual(p,before);
});
