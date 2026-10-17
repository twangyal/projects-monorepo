import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {template,validateProduct,teeDimensions,patternPieces,teeMesh,topMeasurements,neckSize,NECK_RIB_RATIO} from '../src/product.ts';
import {buildTechPack} from '../src/techpack.ts';

test('back-neck edits change the real back opening, rib and point H independently of the front',()=>{
 for(const id of ['blank','crew-sweat','hoodie']){
  const original=template(id), edited=validateProduct({...original,fit:{frontNeckDrop:10,backNeckDrop:6}}),d=teeDimensions(edited);
  assert.equal(d.neckDepthBack,6);assert.equal(d.neckDepthFront,10);
  const back=patternPieces(edited).find(p=>p.part==='back')!;
  const centre=back.width/2;assert.ok(back.outline.some(p=>Math.abs(p.x-centre)<1e-9&&p.y===6));
  const mesh=teeMesh(edited,Delaunator).find(p=>p.part==='back')!;
  const centreHeights=mesh.positions.filter((_,i)=>i%3===1&&Math.abs(mesh.positions[i-1])<1e-9);
  assert.ok(Math.abs(Math.max(...centreHeights)-(topMeasurements(edited).length-6))<1e-9);
  const frontOnly=validateProduct({...original,fit:{frontNeckDrop:10}});
  assert.deepEqual(teeMesh(edited,Delaunator).find(p=>p.part==='front'),teeMesh(frontOnly,Delaunator).find(p=>p.part==='front'));
  const pack=buildTechPack(edited,'2026-10-17');assert.equal(pack.poms.find(p=>p.code==='H')!.values.M,6);assert.equal(pack.poms.find(p=>p.code==='G')!.values.M,10);
 }
 const tee=validateProduct({...template('blank'),fit:{backNeckDrop:6}}),d=teeDimensions(tee);
 const curve=(depth:number)=>Array.from({length:9},(_,i)=>({x:d.neckHalf*Math.cos(Math.PI*i/8),y:depth*Math.sin(Math.PI*i/8)}));
 const expected=[curve(8),curve(6)].reduce((sum,p)=>sum+p.slice(1).reduce((n,q,i)=>n+Math.hypot(q.x-p[i].x,q.y-p[i].y),0),0)*NECK_RIB_RATIO;
 assert.ok(Math.abs(neckSize(topMeasurements(tee),'crew',tee.fit).length-expected)<1e-9);
 assert.ok(Math.abs(patternPieces(tee).find(p=>p.part==='neckband')!.width-expected)<1e-9);
});
test('omitted back-neck settings retain exact existing geometry and strict portable data',()=>{
 for(const id of ['blank','ringer','crew-sweat','hoodie']){
  const original=template(id),explicit=validateProduct({...original,fit:{backNeckDrop:2}});
  assert.deepEqual(patternPieces(original),patternPieces(explicit));assert.deepEqual(teeMesh(original,Delaunator),teeMesh(explicit,Delaunator));
  assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(explicit))),explicit);assert.ok(!original.fit||!Object.hasOwn(original.fit,'backNeckDrop'));
 }
});
test('back-neck admission accepts exact bounds and refuses invalid or bottom settings',()=>{
 for(const depth of [1,12])assert.equal(teeDimensions(validateProduct({...template('blank'),fit:{backNeckDrop:depth}})).neckDepthBack,depth);
 for(const depth of [0,12.01,-1,NaN,Infinity,'6',null])assert.throws(()=>validateProduct({...template('blank'),fit:{backNeckDrop:depth}}));
 assert.throws(()=>validateProduct({...template('trousers'),fit:{backNeckDrop:6}}),/tops/);
});
