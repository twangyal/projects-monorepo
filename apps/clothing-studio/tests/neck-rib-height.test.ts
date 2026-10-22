import test from 'node:test';import assert from 'node:assert/strict';import Delaunator from 'delaunator';
import {template,validateProduct,teeDimensions,patternPieces,teeMesh,neckSize,topMeasurements} from '../src/product.ts';
import {buildTechPack} from '../src/techpack.ts';import {buildCloth} from '../src/garment-drape.ts';
test('finished rib height changes the cut strip actual neckband and tech-pack K while preserving the opening and other pieces',()=>{
 for(const id of ['blank','ringer','crew-sweat']){
  const original=template(id),edited=validateProduct({...original,fit:{neckRibHeight:3.5}}),d=teeDimensions(edited),before=teeDimensions(original);
  assert.equal(d.ribHeight,3.5);assert.equal(d.ribLength,before.ribLength);assert.equal(neckSize(topMeasurements(edited),edited.neckline,edited.fit).width,3.5);
  const piece=patternPieces(edited).find(p=>p.part==='neckband')!;assert.equal(Math.max(...piece.outline.map(p=>p.y)),7);
  assert.deepEqual(patternPieces(edited).filter(p=>p.part!=='neckband'),patternPieces(original).filter(p=>p.part!=='neckband'));
  const meshes=teeMesh(edited,Delaunator),prior=teeMesh(original,Delaunator);assert.deepEqual(meshes.filter(m=>m.part!=='neckband'),prior.filter(m=>m.part!=='neckband'));
  const rib=meshes.find(m=>m.part==='neckband')!,old=prior.find(m=>m.part==='neckband')!;
  for(let v=0;v<rib.positions.length/3;v++){assert.equal(rib.positions[v*3],old.positions[v*3]);assert.equal(rib.positions[v*3+2],old.positions[v*3+2]);assert.ok(Math.abs(rib.positions[v*3+1]-old.positions[v*3+1]-(v%2?1.5:0))<1e-9);}
  assert.ok(Object.values(buildTechPack(edited,'2026-10-22').poms.find(p=>p.code==='K')!.values).every(v=>v===3.5));assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(edited))),edited);
 }
});
test('rib omission retains exact2cm legacy geometry and edited width reaches actual cloth rest construction',()=>{
 const original=template('blank'),same=validateProduct({...original,fit:{neckRibHeight:2}});assert.deepEqual(patternPieces(same),patternPieces(original));assert.deepEqual(teeMesh(same,Delaunator),teeMesh(original,Delaunator));
 const edited=validateProduct({...original,fit:{neckRibHeight:3.5}});const a=buildCloth(original,teeMesh(original,Delaunator)),b=buildCloth(edited,teeMesh(edited,Delaunator));
 const edge=(cloth:typeof a)=>{const [i,j]=cloth.vertices.get('neckband')!;const n=Array.from(cloth.a).findIndex((v,k)=>(v===i&&cloth.b[k]===j)||(v===j&&cloth.b[k]===i));assert.ok(n>=0);return cloth.rest[n]!;};assert.ok(edge(b)>edge(a)+1.4);
});
test('rib bounds and unsupported hood or bottom refuse atomically',()=>{
 for(const value of [1,4])assert.equal(teeDimensions(validateProduct({...template('blank'),fit:{neckRibHeight:value}})).ribHeight,value);
 for(const value of [0,0.99,4.01,NaN,Infinity,'3',null])assert.throws(()=>validateProduct({...template('blank'),fit:{neckRibHeight:value}}),/Neck rib height/);
 assert.throws(()=>validateProduct({...template('hoodie'),fit:{neckRibHeight:3}}),/neck rib|neckband/i);assert.throws(()=>validateProduct({...template('trousers'),fit:{neckRibHeight:3}}),/tops/);
});
