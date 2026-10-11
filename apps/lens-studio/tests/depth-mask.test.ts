import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {createProject,decodeMask,encodeMask} from '../src/model.ts';
import {photo} from './model-fixture.ts';
import {History} from '../src/history.ts';
const api=await import('../src/depth-mask.ts').catch(()=>null);
test('depth exchange API exists',()=>assert.ok(api,'Depth mask exchange is missing'));
test('opaque palette PNG round trips every label without modifying photo or settings',()=>{
 assert.ok(api);const original=createProject(photo(3,2));original.depth=encodeMask(new Uint8Array([0,1,2,2,1,0]),3,2);
 const decoded=PNG.sync.read(Buffer.from(api.maskPng(original)));
 assert.deepEqual([...decoded.data],[219,113,77,255,105,159,144,255,118,132,200,255,118,132,200,255,105,159,144,255,219,113,77,255]);
 const proposal=api.reviewMask(original,{width:3,height:2,rgba:new Uint8ClampedArray(decoded.data)});
 assert.deepEqual(proposal.counts,[2,2,2]);assert.equal(proposal.changed,0);assert.deepEqual(proposal.project,original);
});
test('complete replacement is one reversible edit and reports actual pixel changes',()=>{
 assert.ok(api);const original=createProject(photo(3,2));const imported={width:3,height:2,rgba:new Uint8ClampedArray([219,113,77,255,105,159,144,255,118,132,200,255,118,132,200,255,105,159,144,255,219,113,77,255])};
 const proposed=api.reviewMask(original,imported),history=new History(original);assert.equal(proposed.changed,4);assert.deepEqual(proposed.project,{...original,depth:proposed.project.depth});assert.ok(decodeMask(original.depth).every(v=>v===1));
 assert.equal(history.commit(proposed.project),true);assert.deepEqual(history.undo(),original);assert.deepEqual(history.redo(),proposed.project);
});
test('rejects resized, transparent and off-palette masks rather than guessing labels',()=>{
 assert.ok(api);const original=createProject(photo(1,1));for(const rgba of [[105,159,144,254],[105,159,145,255],[127,127,127,255]])assert.throws(()=>api.reviewMask(original,{width:1,height:1,rgba:new Uint8ClampedArray(rgba)}),/palette|opaque/);
 assert.throws(()=>api.reviewMask(original,{width:2,height:1,rgba:new Uint8ClampedArray(8)}),/dimensions/);assert.ok(decodeMask(original.depth).every(v=>v===1));
});
