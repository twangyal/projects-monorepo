import test from 'node:test';
import assert from 'node:assert/strict';
import * as placement from '../src/artwork-placement.ts';
import {template,type Artwork} from '../src/product.ts';
const art:Artwork={part:'front',name:'mark',dataUrl:'',width:160,height:80,xCm:0,yCm:10,widthCm:20,rotation:30};
test('picked fabric centre becomes outside-view horizontal and top-edge shoulder coordinates',()=>{
 assert.equal(typeof placement.placementFromSurface,'function');
 const product=template('blank'),before=structuredClone(product),original=structuredClone(art);
 assert.deepEqual(placement.placementFromSurface(product,art,{part:'front',x:5,y:40},20),{xCm:5,yCm:23});
 assert.deepEqual(placement.placementFromSurface(product,{...art,part:'back'},{part:'back',x:-5,y:40},10),{xCm:-5,yCm:25.5});
 assert.deepEqual(product,before);assert.deepEqual(art,original);
});
test('picking refuses invalid width, nonfinite or unsupported points instead of inventing placement',()=>{
 assert.equal(typeof placement.placementFromSurface,'function');
 const product=template('blank');
 for(const width of [0,2,41,NaN,Infinity])assert.throws(()=>placement.placementFromSurface(product,art,{part:'front',x:0,y:40},width));
 for(const point of [{part:'back',x:0,y:40},{part:'front',x:Infinity,y:40},{part:'front',x:0,y:NaN},{part:'front',x:100,y:40},{part:'front',x:0,y:100}])assert.throws(()=>placement.placementFromSurface(product,art,point as {part:'front';x:number;y:number},20));
});
