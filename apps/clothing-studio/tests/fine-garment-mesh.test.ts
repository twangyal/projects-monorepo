import {refineGarmentMeshes} from '../src/garment-mesh.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {teeMesh,template} from '../src/product.ts';
import {buildCloth} from '../src/garment-drape.ts';

for(const name of ['ringer','pleated-skirt','jeans','blazer'])test(`${name}: fine pattern triangles preserve coordinates, sewing and mass`,()=>{
 const product=template(name),before=JSON.stringify(product),standard=teeMesh(product,Delaunator),fine=teeMesh(product,Delaunator,'fine');
 assert.deepEqual(fine.map(p=>p.part),standard.map(p=>p.part));
 for(let i=0;i<standard.length;i++){
  const a=standard[i]!,b=fine[i]!;assert.equal(b.indices.length,4*a.indices.length);
  assert.deepEqual(b.positions.slice(0,a.positions.length),a.positions);assert.deepEqual(b.uvs.slice(0,a.uvs.length),a.uvs);
  assert.equal(b.modelled,a.modelled);assert.ok(b.positions.every(Number.isFinite));
  if(a.grainMirrors)assert.deepEqual(b.grainMirrors,a.grainMirrors.flatMap(v=>[v,v,v,v]));
  if(a.creases?.length)assert.ok((b.creases?.length??0)>a.creases.length);
  if(a.inside?.length){assert.deepEqual(b.inside?.slice(0,a.inside.length),a.inside);assert.equal(b.layerSurface,true);}
 }
 const coarseCloth=buildCloth(product,standard),cloth=buildCloth(product,fine);
 assert.ok(cloth.positions.length>coarseCloth.positions.length*2);
 const mass=(values:Float32Array)=>Array.from(values).reduce((sum,w)=>sum+1/w,0);
 assert.ok(Math.abs(mass(cloth.inverseMass)/mass(coarseCloth.inverseMass)-1)<1e-4);
 assert.ok(cloth.inverseMass.every(n=>n>0&&Number.isFinite(n)));
 assert.ok(cloth.positions.length/3<fine.reduce((n,m)=>n+m.positions.length/3,0),'refined seams still sew together');
 assert.equal(JSON.stringify(product),before);assert.deepEqual(teeMesh(product,Delaunator),standard);
});
test('unknown preview quality cannot silently create a different cloth',()=>{
 assert.throws(()=>teeMesh(template('ringer'),Delaunator,'ultra' as never),/quality/i);
});

test('shared midpoint UVs, crease edges and paired pleat layers retain their exact meaning',()=>{
 const [mesh]=refineGarmentMeshes([{part:'front',modelled:true,positions:[0,0,0,2,0,0,2,2,0,0,2,0,0,0,.1,2,0,.1,2,2,.1,0,2,.1],uvs:[0,0,2,0,2,2,0,2,0,0,2,0,2,2,0,2],indices:[0,1,2,0,2,3,4,5,6,4,6,7],creases:[0,2,4,6],layers:[1,1,1,1,0,0,0,0],inside:[0,4,1,5,2,6,3,7],grainMirrors:[1,1,-1,-1]}]);
 assert.equal(mesh!.positions.length/3,18);assert.equal(mesh!.indices.length,48);
 assert.deepEqual(mesh!.positions.slice(24,27),[1,0,0]);assert.deepEqual(mesh!.uvs.slice(16,18),[1,0]);
 assert.deepEqual(mesh!.creases,[0,10,10,2,4,15,15,6]);
 assert.deepEqual(mesh!.inside,[0,4,1,5,2,6,3,7]);assert.equal(mesh!.layerSurface,true);
 assert.deepEqual(mesh!.layers,[1,1,1,1,0,0,0,0,1,1,1,1,1,0,0,0,0,0]);
 assert.deepEqual(mesh!.grainMirrors,[1,1,1,1,1,1,1,1,-1,-1,-1,-1,-1,-1,-1,-1]);
});
