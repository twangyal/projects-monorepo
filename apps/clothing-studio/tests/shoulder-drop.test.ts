import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {template,validateProduct,teeDimensions,patternPieces,teeMesh,teeSilhouette} from '../src/product.ts';
import {buildTechPack,measurementDiagram} from '../src/techpack.ts';

test('shoulder drop controls both actual shoulder seams while width and armhole depth stay independent',()=>{
 for(const id of ['blank','crew-sweat','hoodie']){
  const original=template(id), edited=validateProduct({...original,fit:{shoulderDrop:7}}),d=teeDimensions(edited),prior=teeDimensions(original);
  assert.equal(d.shoulderDrop,7);assert.equal(d.shoulderX,prior.shoulderX);assert.equal(d.armDepth,prior.armDepth);
  for(const side of ['front','back'] as const){
   const piece=patternPieces(edited).find(p=>p.part===side)!;
   assert.ok(piece.outline.some(p=>Math.abs(p.x-(d.half+d.shoulderX))<1e-9&&p.y===7));
   const silhouette=teeSilhouette(edited,side);assert.deepEqual(silhouette.armholes[0],[{x:d.shoulderX,y:7},{x:d.half,y:7+d.armDepth}]);
   assert.notDeepEqual(teeMesh(edited,Delaunator).find(p=>p.part===side),teeMesh(original,Delaunator).find(p=>p.part===side));
  }
  const pack=buildTechPack(edited,'2026-10-21'),pom=pack.poms.find(p=>p.code==='U')!;
  assert.equal(pom.name,'Shoulder drop');assert.ok(Object.values(pom.values).every(v=>v===7));assert.match(measurementDiagram(edited),/>U<\/text>/);
 }
});
test('absent shoulder drop retains exact legacy patterns and meshes and roundtrips sparse data',()=>{
 for(const id of ['blank','ringer','crew-sweat','hoodie']){
  const original=template(id),explicit=validateProduct({...original,fit:{shoulderDrop:4}});
  assert.deepEqual(patternPieces(original),patternPieces(explicit));assert.deepEqual(teeMesh(original,Delaunator),teeMesh(explicit,Delaunator));
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(explicit))),explicit);assert.ok(!original.fit||!Object.hasOwn(original.fit,'shoulderDrop'));
 }
});
test('shoulder drop admits exact bounds and rejects invalid, bottom and impossible relative geometry',()=>{
 for(const value of [1,8])assert.equal(teeDimensions(validateProduct({...template('blank'),fit:{shoulderDrop:value}})).shoulderDrop,value);
 for(const value of [0,8.01,-1,NaN,Infinity,'7',null])assert.throws(()=>validateProduct({...template('blank'),fit:{shoulderDrop:value}}),/Shoulder drop/);
 assert.throws(()=>validateProduct({...template('trousers'),fit:{shoulderDrop:7}}),/tops/);
 assert.throws(()=>validateProduct({...template('blank'),fit:{shoulderDrop:1,armholeDepth:15,frontNeckDrop:15}}),/above the underarm/);
 const short=template('blank');short.measurements={chest:104,length:55,sleeve:21};
 assert.throws(()=>validateProduct({...short,fit:{shoulderDrop:8,armholeDepth:36}}),/above the hem/);
});
