import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,decodeMask} from '../src/model.ts';
import {History} from '../src/history.ts';
import {prepareColorRegion} from '../src/color-regions.ts';
import {photo} from './model-fixture.ts';
import type {Raster} from '../src/types.ts';
const raster=(width:number,height:number,values:number[]):Raster=>({width,height,rgba:Uint8ClampedArray.from(values.flatMap(v=>[v,v,v,255]))});
const project=(source:Raster)=>createProject(photo(source.width,source.height));
test('seed color selects only its four-connected component; diagonal and disconnected copies stay intact',()=>{
 const source=raster(4,3,[10,10,200,10,10,200,10,10,10,10,200,10]),before=project(source),prepared=prepareColorRegion(before,source,0,{x:0,y:0},0);assert.deepEqual([...prepared.selection],[1,1,0,0,1,0,0,0,1,1,0,0]);assert.deepEqual([...decodeMask(prepared.project.depth)],[0,0,1,1,0,1,1,1,0,0,1,1]);assert.deepEqual(prepared.project,{...before,depth:prepared.project.depth});assert.ok(decodeMask(before.depth).every(v=>v===1));
});
test('inclusive per-channel tolerance compares each candidate to fixed seed without gradual drift',()=>{
 const source=raster(5,1,[10,20,30,40,10]);const next=prepareColorRegion(project(source),source,2,{x:0,y:0},10);assert.deepEqual([...next.selection],[1,1,0,0,0]);const alpha=raster(3,1,[10,10,10]);alpha.rgba[7]=245;alpha.rgba[11]=244;assert.deepEqual([...prepareColorRegion(project(alpha),alpha,0,{x:0,y:0},10).selection],[1,1,0]);
});
test('all RGBA channels participate and input pixels are unchanged',()=>{
 const source=raster(3,1,[10,10,10]);source.rgba[4]=11;source.rgba[9]=11;const original=source.rgba.slice();assert.deepEqual([...prepareColorRegion(project(source),source,2,{x:0,y:0},0).selection],[1,0,0]);assert.deepEqual(source.rgba,original);
});
test('one complete depth edit is undoable and a same-plane no-op preserves redo',()=>{
 const source=raster(4,1,[10,10,200,10]),before=project(source),history=new History(before),next=prepareColorRegion(before,source,0,{x:0,y:0},0).project;assert.equal(history.commit(next),true);assert.deepEqual(history.undo(),before);assert.equal(history.commit(prepareColorRegion(before,source,1,{x:0,y:0},0).project),false);assert.equal(history.canRedo,true);assert.deepEqual(history.redo(),next);
});
test('invalid tolerance seed plane and incompatible rasters refuse before publication',()=>{
 const source=raster(3,1,[10,20,30]),before=project(source);assert.throws(()=>prepareColorRegion(before,source,3 as never,{x:0,y:0},0));for(const tolerance of [-1,256,NaN,Infinity,.5])assert.throws(()=>prepareColorRegion(before,source,0,{x:0,y:0},tolerance));for(const seed of [{x:-1,y:0},{x:3,y:0},{x:.5,y:0},{x:0,y:NaN}])assert.throws(()=>prepareColorRegion(before,source,0,seed,0));assert.throws(()=>prepareColorRegion(before,raster(2,1,[10,10]),0,{x:0,y:0},0));assert.throws(()=>prepareColorRegion(before,{...source,rgba:new Uint8ClampedArray(0)},0,{x:0,y:0},0));let getters=0;assert.throws(()=>prepareColorRegion(before,source,0,{get x(){getters++;return 0},y:0},0));assert.equal(getters,0);assert.ok(decodeMask(before.depth).every(v=>v===1));
});
test('maximum admitted raster selects every source pixel without recursion or input mutation',()=>{
 const source={width:1280,height:1280,rgba:new Uint8ClampedArray(1280*1280*4)},before=project(source),result=prepareColorRegion(before,source,2,{x:1279,y:1279},255);assert.equal(result.selection.length,1638400);assert.ok(result.selection.every(v=>v===1));assert.ok(decodeMask(result.project.depth).every(v=>v===2));assert.ok(source.rgba.every(v=>v===0));assert.deepEqual(result.project,{...before,depth:result.project.depth});
});
