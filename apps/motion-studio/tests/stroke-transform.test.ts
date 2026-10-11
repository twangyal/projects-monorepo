import test from 'node:test';
import assert from 'node:assert/strict';
import * as edits from '../src/stroke-edit.ts';
import {validateProject,MAX_JSON_BYTES,type DrawingLayer,type Project} from '../src/model.ts';
import {History} from '../src/history.ts';
import {originalStrokeProject} from './stroke-edit-fixtures.ts';
type Action='grow'|'shrink'|'clockwise'|'counterclockwise';
const apply=(edits as unknown as {transformStroke:(p:Project,t:edits.StrokeTarget,a:Action)=>Project}).transformStroke;
const target={layerId:'paint',celFrame:0,strokeIndex:0};
function fixture(){const p=validateProject(originalStrokeProject());(p.layers[0] as DrawingLayer).cels[0].strokes[0].points=[{x:-60,y:-30},{x:-60,y:30},{x:60,y:30}];return p;}
test('local resize and quarter turns preserve exact complete unrelated artwork and style',()=>{
 assert.equal(typeof apply,'function');const p=fixture(),before=structuredClone(p);
 for(const [action,points] of [['grow',[{x:-120,y:-60},{x:-120,y:60},{x:120,y:60}]],['shrink',[{x:-30,y:-15},{x:-30,y:15},{x:30,y:15}]],['clockwise',[{x:30,y:-60},{x:-30,y:-60},{x:-30,y:60}]],['counterclockwise',[{x:-30,y:60},{x:30,y:60},{x:30,y:-60}]]] as const){const expected=structuredClone(p);(expected.layers[0] as DrawingLayer).cels[0].strokes[0].points=points.map(x=>({...x}));assert.deepEqual(apply(p,target,action),expected);}assert.deepEqual(p,before);
});
test('fractional nonzero center, inverse transforms and detached results',()=>{
 assert.equal(typeof apply,'function');const p=fixture();(p.layers[0] as DrawingLayer).cels[0].strokes[0].points=[{x:1.25,y:2.5},{x:5.25,y:4.5}];const expected=structuredClone(p);(expected.layers[0] as DrawingLayer).cels[0].strokes[0].points=[{x:4.25,y:1.5},{x:2.25,y:5.5}];const n=apply(p,target,'clockwise');assert.deepEqual(n,expected);assert.deepEqual(apply(n,target,'counterclockwise'),p);assert.deepEqual(apply(apply(p,target,'grow'),target,'shrink'),p);(n.layers[0] as DrawingLayer).cels[0].strokes[0].points[0].x=0;assert.equal((p.layers[0] as DrawingLayer).cels[0].strokes[0].points[0].x,1.25);
});
test('single-point no-op retains Redo; invalid actions and targets refuse',()=>{
 assert.equal(typeof apply,'function');const p=fixture(),h=new History(p);h.commit(apply(p,target,'grow'));h.undo();for(const action of ['grow','shrink','clockwise','counterclockwise'] as const){assert.equal(h.commit(apply(p,{...target,strokeIndex:2},action)),false);assert.equal(h.canRedo,true);}assert.throws(()=>apply(p,target,'diagonal' as Action));for(const t of [{...target,celFrame:1},{...target,strokeIndex:999},{...target,layerId:'image'}])assert.throws(()=>apply(p,t,'grow'));
});
test('coordinate overflow refuses earlier proposed vertices without mutation or lost Redo',()=>{
 assert.equal(typeof apply,'function');const p=fixture();(p.layers[0] as DrawingLayer).cels[0].strokes[0].points=[{x:-1200,y:0},{x:1200,y:0}];const before=structuredClone(p),h=new History(p);h.commit({...p,title:'Future'});h.undo();assert.throws(()=>h.commit(apply(p,target,'grow')),/point|coordinate/i);assert.deepEqual(p,before);assert.equal(h.canRedo,true);
});

test('longer transformed coordinate digits refuse at the exact canonical byte cap and preserve Redo',()=>{
 const p=fixture();p.layers.splice(1);const key=structuredClone(p.layers[0].keys[0]);p.layers.push(...Array.from({length:4},(_,i)=>({id:`image-${i}`,name:'Image',kind:'image' as const,keys:[key],image:{dataUrl:'data:image/png;base64,'+'A'.repeat(1552840),width:1,height:1}})));const gap=MAX_JSON_BYTES-new TextEncoder().encode(JSON.stringify(validateProject(p))).length;let remaining=Math.floor(gap/4)*4;for(const layer of p.layers)if(layer.kind==='image'){const add=Math.min(remaining,20000);layer.image.dataUrl+='A'.repeat(add);remaining-=add;}assert.equal(remaining,0);p.title+='x'.repeat(gap%4);const safe=validateProject(p),before=structuredClone(safe),h=new History(safe);h.commit({...safe,title:safe.title.slice(0,-1)});h.undo();assert.equal(new TextEncoder().encode(JSON.stringify(safe)).length,MAX_JSON_BYTES);assert.throws(()=>h.commit(apply(safe,target,'grow')),/JSON.*limit/i);assert.deepEqual(safe,before);assert.equal(h.canRedo,true);
});
