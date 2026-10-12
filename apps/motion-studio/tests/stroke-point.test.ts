import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../src/stroke-edit.ts';
import {validateProject,type DrawingLayer} from '../src/model.ts';
import {History} from '../src/history.ts';
import {originalStrokeProject} from './stroke-edit-fixtures.ts';
const target={layerId:'paint',celFrame:0,strokeIndex:0};
const edit=()=> (edits as unknown as {setStrokePoint:(p:ReturnType<typeof validateProject>,t:typeof target,i:number,v:{x:number;y:number})=>ReturnType<typeof validateProject>}).setStrokePoint;
test('point correction changes one literal vertex and preserves full detached artwork and history',()=>{
 assert.equal(typeof edit(),'function');
 const p=validateProject(originalStrokeProject(true)),before=structuredClone(p),expected=structuredClone(p);
 (expected.layers[0] as DrawingLayer).cels[0].strokes[0].points[1]={x:60,y:40};
 const next=edit()(p,target,1,{x:60,y:40});assert.deepEqual(next,expected);assert.deepEqual(p,before);
 const h=new History(p);assert.equal(h.commit(next),true);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),expected);
});
test('point no-op retains redo; malformed indices and coordinates refuse without mutation',()=>{
 assert.equal(typeof edit(),'function');
 const p=validateProject(originalStrokeProject(true)),before=structuredClone(p),h=new History(p);h.commit({...p,title:'Future'});h.undo();
 assert.equal(h.commit(edit()(p,target,0,{x:-60,y:0})),false);assert.equal(h.canRedo,true);
 for(const index of [-1,.5,2,NaN,Infinity])assert.throws(()=>edit()(p,target,index,{x:0,y:0}));
 for(const value of [{x:1281,y:0},{x:0,y:-1281},{x:NaN,y:0},{x:0,y:Infinity},{x:1,y:1,z:2}])assert.throws(()=>edit()(p,target,0,value));
 let accessed=false;const getter={get x(){accessed=true;return 0;},y:0};assert.throws(()=>edit()(p,target,0,getter));assert.equal(accessed,false);
 for(const t of [{...target,celFrame:1},{...target,layerId:'image'},{...target,strokeIndex:99}])assert.throws(()=>edit()(p,t,0,{x:0,y:0}));
 assert.deepEqual(p,before);
});
