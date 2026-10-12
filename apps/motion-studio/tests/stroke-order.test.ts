import test from 'node:test';
import assert from 'node:assert/strict';
import {reorderStroke} from '../src/stroke-edit.ts';
import {validateProject,type DrawingLayer} from '../src/model.ts';
import {History} from '../src/history.ts';
import {originalStrokeProject} from './stroke-edit-fixtures.ts';
const target={layerId:'paint',celFrame:0,strokeIndex:0};
test('forward and backward swap one paint neighbor without altering any retained artwork',()=>{
 const p=validateProject(originalStrokeProject(true)),before=structuredClone(p),next=reorderStroke(p,target,'forward'),expected=structuredClone(p),strokes=(expected.layers[0] as DrawingLayer).cels[0].strokes;
 [strokes[0],strokes[1]]=[strokes[1],strokes[0]];assert.deepEqual(next,expected);assert.deepEqual(p,before);assert.deepEqual(reorderStroke(next,{...target,strokeIndex:1},'backward'),p);
});
test('paint boundary no-ops keep redo and invalid selections refuse atomically',()=>{
 const p=validateProject(originalStrokeProject(true)),before=structuredClone(p),h=new History(p);h.commit({...p,title:'Future'});h.undo();
 assert.equal(h.commit(reorderStroke(p,target,'backward')),false);assert.equal(h.canRedo,true);
 assert.deepEqual(reorderStroke(p,{...target,strokeIndex:3},'forward'),p);
 for(const t of [{...target,celFrame:1},{...target,layerId:'image'},{...target,strokeIndex:99}])assert.throws(()=>reorderStroke(p,t,'forward'));
 assert.throws(()=>reorderStroke(p,target,'top' as 'forward'));assert.deepEqual(p,before);
});
