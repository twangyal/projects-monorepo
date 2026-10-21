import test from 'node:test';import assert from 'node:assert/strict';
import * as chords from '../src/note-chord.ts';
import {validateDocument} from '../src/reference-project.ts';
import type {Composition} from '../src/types.ts';
type Command=(p:Composition,t:string,n:string,q:unknown,ids:[string,string])=>Composition;
const add=(...args:Parameters<Command>):Composition=>(chords as unknown as{addChord:Command}).addChord(...args);
const fixture=():Composition=>({version:1,title:'Chord authoring',tempo:120,tracks:[{id:'t',name:'Voice',instrument:'sine',volume:.3,muted:false,panCurve:[{beat:0,level:-1},{beat:8,level:1}],notes:[{id:'root',pitch:64,start:1/3,duration:2/3,velocity:.7}]},{id:'other',name:'Other',instrument:'triangle',volume:.2,muted:true,notes:[{id:'other-note',pitch:72,start:1,duration:.5,velocity:.5}]}]});
test('explicit chord qualities add exact editable intervals while preserving the root and complete document',()=>{
 assert.equal(typeof (chords as Record<string,unknown>).addChord,'function');
 for(const [quality,third]of [['major',4],['minor',3],['sus2',2],['sus4',5]] as const){const p=fixture(),before=structuredClone(p),result=add(p,'t','root',quality,['third','fifth']);assert.deepEqual(result.tracks[0].notes,[p.tracks[0].notes[0],{...p.tracks[0].notes[0],id:'third',pitch:64+third},{...p.tracks[0].notes[0],id:'fifth',pitch:71}]);assert.deepEqual({...result.tracks[0],notes:[]},{...p.tracks[0],notes:[]});assert.deepEqual(result.tracks[1],p.tracks[1]);assert.deepEqual(validateDocument({schemaVersion:1,composition:result,references:[]}).composition,result);assert.deepEqual(p,before);}
});
test('range capacity stale selection drums and invalid IDs refuse without partial edits',()=>{
 const p=fixture(),before=structuredClone(p);for(const args of [['missing','root','major'],['t','missing','major'],['t','root','diminished'],['t','root',null]] as const)assert.throws(()=>add(p,args[0],args[1],args[2],['third','fifth']));
 for(const ids of [['root','new'],['x','x'],['other-note','new'],['','new']] as [string,string][])assert.throws(()=>add(p,'t','root','major',ids));
 assert.deepEqual(p,before);p.tracks[0].instrument='drums';assert.throws(()=>add(p,'t','root','major',['third','fifth']),/melodic|drum/i);p.tracks[0].instrument='sine';p.tracks[0].notes[0].pitch=90;assert.throws(()=>add(p,'t','root','major',['third','fifth']),/C7|96|pitch/i);p.tracks[0].notes[0].pitch=89;assert.equal(add(p,'t','root','major',['third','fifth']).tracks[0].notes.at(-1)!.pitch,96);
 const max=fixture();max.tracks[0].notes.push(...Array.from({length:253},(_,i)=>({id:`extra${i}`,pitch:36,start:2+i,duration:.25,velocity:.2})));assert.equal(add(max,'t','root','major',['third','fifth']).tracks[0].notes.length,256);max.tracks[0].notes.push({id:'last',pitch:36,start:300,duration:.25,velocity:.2});assert.throws(()=>add(max,'t','root','major',['third','fifth']),/256|space|capacity/i);
});
test('overlapping target voices refuse while touching nonoverlapping notes remain intact',()=>{
 const p=fixture(),root=p.tracks[0].notes[0];for(const pitch of [68,71]){const conflict=structuredClone(p);conflict.tracks[0].notes.push({id:'conflict',pitch,start:.5,duration:.25,velocity:.2});const before=structuredClone(conflict);assert.throws(()=>add(conflict,'t','root','major',['third','fifth']),/overlap|already/i);assert.deepEqual(conflict,before);}
 p.tracks[0].notes.push({id:'touch',pitch:68,start:root.start+root.duration,duration:.25,velocity:.2});assert.equal(add(p,'t','root','major',['third','fifth']).tracks[0].notes.length,4);
});
