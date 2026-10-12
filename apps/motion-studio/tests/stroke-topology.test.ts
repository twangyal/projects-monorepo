import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../src/stroke-edit.ts';
import {validateProject,type Project,type DrawingLayer} from '../src/model.ts';
import {History} from '../src/history.ts';
import {originalStrokeProject} from './stroke-edit-fixtures.ts';
const target={layerId:'paint',celFrame:0,strokeIndex:0};
const api=edits as unknown as {insertStrokeMidpoint:(p:Project,t:typeof target,i:number)=>Project;deleteStrokePoint:(p:Project,t:typeof target,i:number)=>Project};
test('insert a literal midpoint and remove it with complete detached artwork preservation',()=>{
 assert.equal(typeof api.insertStrokeMidpoint,'function');assert.equal(typeof api.deleteStrokePoint,'function');
 const p=validateProject(originalStrokeProject(true)),before=structuredClone(p),expected=structuredClone(p);
 (expected.layers[0] as DrawingLayer).cels[0].strokes[0].points=[{x:-60,y:0},{x:0,y:0},{x:60,y:0}];
 const next=api.insertStrokeMidpoint(p,target,0);assert.deepEqual(next,expected);assert.deepEqual(api.deleteStrokePoint(next,target,1),p);assert.deepEqual(p,before);
 const h=new History(p);h.commit(next);assert.deepEqual(h.undo(),p);assert.deepEqual(h.redo(),next);
});
test('endpoint, sole point, malformed indices and stroke/project capacities refuse atomically',()=>{
 assert.equal(typeof api.insertStrokeMidpoint,'function');assert.equal(typeof api.deleteStrokePoint,'function');
 const p=validateProject(originalStrokeProject(true)),before=structuredClone(p);
 assert.throws(()=>api.insertStrokeMidpoint(p,target,1));assert.throws(()=>api.deleteStrokePoint(p,{...target,strokeIndex:2},0));
 for(const i of [-1,.5,NaN,Infinity,99]){assert.throws(()=>api.insertStrokeMidpoint(p,target,i));assert.throws(()=>api.deleteStrokePoint(p,target,i));}
 const full=structuredClone(p);(full.layers[0] as DrawingLayer).cels[0].strokes[0].points=Array.from({length:1000},(_,i)=>({x:i,y:0}));assert.throws(()=>api.insertStrokeMidpoint(full,target,0));
 const total=structuredClone(p);total.layers=total.layers.slice(0,1);const drawing=total.layers[0] as DrawingLayer;drawing.cels=drawing.cels.slice(0,1);drawing.cels[0].strokes=Array.from({length:11},(_,i)=>({color:'#ff0000',width:1,points:Array.from({length:i===10?10:999},()=>({x:0,y:0}))}));
 const admitted=validateProject(total),exact=structuredClone(admitted);assert.throws(()=>api.insertStrokeMidpoint(admitted,target,0));assert.deepEqual(admitted,exact);assert.deepEqual(p,before);
});
