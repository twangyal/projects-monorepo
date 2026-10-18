import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {template,teeMesh} from '../src/product.ts';
import {buildCloth,simulateGarment} from '../src/garment-drape.ts';
import {captureNativeGarment} from '../src/native-garment-snapshot.ts';
import {captureGarmentWarmStart} from '../src/native-garment-warm-start.ts';

test('native warm start preserves every captured field except explicitly prepared positions',()=>{
 const product=template('blank'),before=structuredClone(product),cold=captureNativeGarment(product,94,{},Delaunator);
 const result=captureGarmentWarmStart(product,94,{},Delaunator);
 assert.deepEqual(product,before);
 assert.equal(result.preparation.frames,45);
 assert.equal(result.preparation.gravity_frames,0);
 assert.equal(result.preparation.substeps,10);
 assert.notDeepEqual(result.positions_m,cold.positions_m);
 assert.ok(result.positions_m.every(Number.isFinite));
 assert.deepEqual(result.source_packet,cold);
 assert.ok(result.metrics.maxStrain<.5);
 assert.ok(result.metrics.residualSpeed>10,'a growth-stage result must not be called settled');
});

test('native warm start uses the real growth endpoint in original particle namespace',()=>{
 const product=template('blank'),meshes=teeMesh(product,Delaunator),cloth=buildCloth(product,meshes);
 const expected=simulateGarment(product,meshes,94,{frames:46,substeps:10,progress:f=>f<45});
 const result=captureGarmentWarmStart(product,94,{},Delaunator);
 for(const part of expected.parts){
  const ids=cloth.vertices.get(part.part)!;
  for(let v=0;v<ids.length;v++)for(let a=0;a<3;a++)assert.equal(result.positions_m[ids[v]!*3+a],part.positions[v*3+a]!/100);
 }
 assert.deepEqual(result.metrics,expected.metrics);
});
