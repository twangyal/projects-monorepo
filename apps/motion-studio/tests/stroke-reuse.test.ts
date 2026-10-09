import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateStroke, mirrorStroke } from '../src/stroke-edit.ts';
import { validateProject, type DrawingLayer } from '../src/model.ts';
import { originalStrokeProject } from './stroke-edit-fixtures.ts';
const target={layerId:'paint',celFrame:0,strokeIndex:0};
function fixture(){const p=validateProject(originalStrokeProject());(p.layers[0] as DrawingLayer).cels[0].strokes[0].points=[{x:-30,y:-20},{x:5,y:10},{x:50,y:40}];return p;}
test('duplicate inserts a detached copy after selection and preserves the remaining graph',()=>{
 const p=fixture(),before=structuredClone(p),n=duplicateStroke(p,target),expected=structuredClone(p);
 (expected.layers[0] as DrawingLayer).cels[0].strokes.splice(1,0,structuredClone((expected.layers[0] as DrawingLayer).cels[0].strokes[0]));assert.deepEqual(n,expected);assert.deepEqual(p,before);
 const strokes=(n.layers[0] as DrawingLayer).cels[0].strokes;strokes[1].points[0].x=999;assert.equal(strokes[0].points[0].x,-30);assert.deepEqual(p,before);
});
test('local mirrors preserve point order, style, poses and independent cels',()=>{
 const p=fixture(),before=structuredClone(p);
 for(const [axis,points] of [['horizontal',[{x:50,y:-20},{x:15,y:10},{x:-30,y:40}]],['vertical',[{x:-30,y:40},{x:5,y:10},{x:50,y:-20}]]] as const){const n=mirrorStroke(p,target,axis),expected=structuredClone(p);(expected.layers[0] as DrawingLayer).cels[0].strokes[0].points=points.map(x=>({...x}));assert.deepEqual(n,expected);assert.deepEqual(mirrorStroke(n,target,axis),p);}assert.deepEqual(p,before);
});
test('one-point paths mirror unchanged and invalid axes/targets refuse without mutation',()=>{
 const p=fixture(),before=structuredClone(p);assert.deepEqual(mirrorStroke(p,{...target,strokeIndex:2},'horizontal'),p);
 assert.throws(()=>mirrorStroke(p,target,'diagonal' as 'horizontal'));for(const t of [{...target,celFrame:1},{...target,strokeIndex:999},{...target,layerId:'image'}]){assert.throws(()=>duplicateStroke(p,t));assert.throws(()=>mirrorStroke(p,t,'vertical'));}assert.deepEqual(p,before);
});
test('stroke and point capacity refusal is atomic and maximum admitted clone is independent',()=>{
 const p=fixture();p.layers.splice(1);const cel=(p.layers[0] as DrawingLayer).cels[0];(p.layers[0] as DrawingLayer).cels.splice(1);
 cel.strokes=Array.from({length:99},()=>({color:'#010203',width:1,points:[{x:0,y:0}]}));const n=duplicateStroke(p,target);assert.equal((n.layers[0] as DrawingLayer).cels[0].strokes.length,100);const before=structuredClone(n);assert.throws(()=>duplicateStroke(n,target),/strokes/i);assert.deepEqual(n,before);
 cel.strokes=Array.from({length:10},()=>({color:'#010203',width:1,points:Array.from({length:1000},(_,i)=>({x:i,y:0}))}));const original=structuredClone(p);assert.throws(()=>duplicateStroke(p,target),/points/i);assert.deepEqual(p,original);
});
