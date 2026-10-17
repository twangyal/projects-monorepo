import test from 'node:test';
import assert from 'node:assert/strict';
import * as placement from '../src/artwork-placement.ts';
import Delaunator from 'delaunator';
import {teeMesh,topMeasurements,template,type Artwork} from '../src/product.ts';
const art:Artwork={part:'front',name:'mark',dataUrl:'',width:160,height:80,xCm:0,yCm:10,widthCm:20,rotation:30};
test('picked fabric centre becomes outside-view horizontal and top-edge shoulder coordinates',()=>{
 assert.equal(typeof placement.placementFromSurface,'function');
 const product=template('blank'),before=structuredClone(product),original=structuredClone(art);
 assert.deepEqual(placement.placementFromSurface(product,art,{part:'front',x:5,y:40},20),{xCm:5,yCm:31});
 assert.deepEqual(placement.placementFromSurface(product,{...art,part:'back'},{part:'back',x:-5,y:40},10),{xCm:-5,yCm:33.5});
 assert.deepEqual(product,before);assert.deepEqual(art,original);
});
test('picking refuses invalid width, nonfinite or unsupported points instead of inventing placement',()=>{
 assert.equal(typeof placement.placementFromSurface,'function');
 const product=template('blank');
 for(const width of [0,2,41,NaN,Infinity])assert.throws(()=>placement.placementFromSurface(product,art,{part:'front',x:0,y:40},width));
 for(const point of [{part:'back',x:0,y:40},{part:'front',x:Infinity,y:40},{part:'front',x:0,y:NaN},{part:'front',x:100,y:40},{part:'front',x:0,y:100}])assert.throws(()=>placement.placementFromSurface(product,art,point as {part:'front';x:number;y:number},20));
});

test('picked mesh UVs round-trip to the actual front and back world height',()=>{
 const product=template('blank'), length=topMeasurements(product).length;
 for(const side of ['front','back'] as const){
  const mesh=teeMesh(product,Delaunator).find(mesh=>mesh.part===side)!;let checked=0;
  for(let i=0;i<mesh.positions.length/3;i++){
   const fabricY=mesh.uvs[i*2+1];if(fabricY<15||fabricY>25)continue;
   const picked=placement.placementFromSurface(product,{...art,part:side},{part:side,x:mesh.uvs[i*2],y:fabricY},20);
   const renderedCentre=length-placement.ARTWORK_SHOULDER_OFFSET-picked.yCm-5;
   assert.ok(Math.abs(renderedCentre-mesh.positions[i*3+1])<=.0051,`${side}: clicked ${mesh.positions[i*3+1]}, rendered ${renderedCentre}`);checked++;
  }
  assert.ok(checked>10);
 }
});
