import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateDrawingLayer } from '../src/layer-copy.ts';
import { MAX_JSON_BYTES, validateProject, type DrawingLayer } from '../src/model.ts';
import { originalStrokeProject } from './stroke-edit-fixtures.ts';
test('copy retains complete authored motion and exposures with detached ownership',()=>{
 const p=validateProject(originalStrokeProject()),before=structuredClone(p);const n=duplicateDrawingLayer(p,'paint','new-art');const expected=structuredClone(p),copy=structuredClone(p.layers[0]);copy.id='new-art';copy.name='Paint copy';expected.layers.splice(1,0,copy);assert.deepEqual(n,expected);assert.deepEqual(p,before);
 const layer=n.layers[1] as DrawingLayer;layer.cels[0].strokes[0].points[0].x=999;layer.cels[1].strokes[0].width=40;layer.keys[0].x=0;assert.deepEqual(n.layers[0],p.layers[0]);assert.deepEqual(p,before);
});
test('invalid identities, non-drawing targets and full layer/stroke/point capacity refuse atomically',()=>{
 const p=validateProject(originalStrokeProject()),before=structuredClone(p);for(const id of ['paint','bad id',''])assert.throws(()=>duplicateDrawingLayer(p,'paint',id));for(const id of ['missing','image'])assert.throws(()=>duplicateDrawingLayer(p,id,'new'));assert.deepEqual(p,before);
 const full=structuredClone(p);for(let i=0;i<5;i++)full.layers.push({...structuredClone(p.layers[1]),id:`other-${i}`});const original=structuredClone(full);assert.throws(()=>duplicateDrawingLayer(full,'paint','new'),/layers/i);assert.deepEqual(full,original);
 const crowded=structuredClone(p);crowded.layers.splice(1);(crowded.layers[0] as DrawingLayer).cels=[{frame:0,strokes:Array.from({length:51},()=>({color:'#010203',width:1,points:[{x:0,y:0}]}))}];assert.throws(()=>duplicateDrawingLayer(crowded,'paint','new'),/strokes/i);
 (crowded.layers[0] as DrawingLayer).cels[0].strokes=Array.from({length:6},()=>({color:'#010203',width:1,points:Array.from({length:1000},(_,i)=>({x:i,y:0}))}));assert.throws(()=>duplicateDrawingLayer(crowded,'paint','new'),/points/i);
});
test('copy name preserves Unicode and fits the existing name limit',()=>{
 const p=validateProject(originalStrokeProject());p.layers[0].name='😀'.repeat(20);const n=duplicateDrawingLayer(p,'paint','copy');assert.equal(n.layers[1].name,'😀'.repeat(17)+' copy');assert.ok(n.layers[1].name.length<=40);
 const ids=new Set([p.layers[0].id]);for(let i=0;i<5;i++){const id=duplicateDrawingLayer(p,'paint').layers[1].id;assert.ok(!ids.has(id));ids.add(id);}
});
test('exact eighth layer is usable; full canonical byte capacity refuses without mutating the source',()=>{
 const p=validateProject(originalStrokeProject());for(let i=0;i<4;i++)p.layers.push({...structuredClone(p.layers[1]),id:`other-${i}`});assert.equal(duplicateDrawingLayer(p,'paint','eighth').layers.length,8);
 const large=validateProject(originalStrokeProject());const pose=structuredClone(large.layers[0].keys[0]);large.layers.splice(1);large.layers.push(...Array.from({length:4},(_,i)=>({id:`image-${i}`,name:'Image',kind:'image' as const,keys:[pose],image:{dataUrl:'data:image/png;base64,'+'A'.repeat(1552840),width:1,height:1}})));
 const gap=MAX_JSON_BYTES-new TextEncoder().encode(JSON.stringify(validateProject(large))).length;let remaining=Math.floor(gap/4)*4;
 for(const layer of large.layers){if(layer.kind==='image'){const add=Math.min(remaining,20000);layer.image.dataUrl+='A'.repeat(add);remaining-=add;}}
 assert.equal(remaining,0);large.title+='x'.repeat(gap%4);const source=validateProject(large),before=structuredClone(source);assert.equal(new TextEncoder().encode(JSON.stringify(source)).length,MAX_JSON_BYTES);assert.throws(()=>duplicateDrawingLayer(source,'paint','copy'),/JSON.*limit/i);assert.deepEqual(source,before);
});
