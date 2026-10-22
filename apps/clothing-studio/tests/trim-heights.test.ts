import test from 'node:test';import assert from 'node:assert/strict';import Delaunator from 'delaunator';
import{template,validateProduct,teeDimensions,patternPieces,teeMesh,topMeasurements}from'../src/product.ts';
import{buildTechPack}from'../src/techpack.ts';import{buildCloth}from'../src/garment-drape.ts';
test('independent cuffs and hem heights reach actual pattern mesh cloth and tech-pack while outer lengths remain',()=>{
 for(const id of ['crew-sweat','hoodie']){
  const old=template(id),changed=validateProduct({...old,fit:{cuffHeight:4,hemBandHeight:9}}),d=teeDimensions(changed),prior=teeDimensions(old),pieces=patternPieces(changed),previous=patternPieces(old);
  assert.equal(d.cuffHeight,4);assert.equal(d.band,9);assert.equal(d.length,prior.length);assert.equal(d.sleeveLength,prior.sleeveLength);
  for(const part of ['cuffLeft','cuffRight'] as const){assert.equal(pieces.find(p=>p.part===part)!.height,8);assert.equal(pieces.find(p=>p.part===part)!.width,previous.find(p=>p.part===part)!.width);}
  assert.equal(pieces.find(p=>p.part==='hemBand')!.height,18);assert.equal(pieces.find(p=>p.part==='front')!.height,topMeasurements(old).length-9);
  assert.equal(pieces.find(p=>p.part==='sleeveLeft')!.height,previous.find(p=>p.part==='sleeveLeft')!.height+2);
  const meshes=teeMesh(changed,Delaunator),legacy=teeMesh(old,Delaunator);assert.notDeepEqual(meshes.find(m=>m.part==='cuffLeft')!.positions,legacy.find(m=>m.part==='cuffLeft')!.positions);
  const ys=(part:string,ms=meshes)=>ms.find(m=>m.part===part)!.positions.filter((_,i)=>i%3===1);assert.ok(Math.abs(Math.max(...ys('hemBand'))-9)<1e-9);assert.ok(Math.abs(Math.min(...ys('hemBand')))<1e-9);
  for(const part of ['neckband','hood'] as const)assert.deepEqual(meshes.find(m=>m.part===part),legacy.find(m=>m.part===part));
  if(id==='hoodie'){assert.equal(d.pocketTop,prior.pocketTop-3);assert.ok(Math.abs(Math.min(...ys('pocket'))-9.01)<1e-9);}
  const pack=buildTechPack(changed,'2026-10-22');for(const[code,value]of[['L',4],['M',9]]as const)assert.ok(Object.values(pack.poms.find(p=>p.code===code)!.values).every(v=>v===value));
  const cloth=buildCloth(changed,meshes);assert.ok(cloth.vertices.get('cuffLeft')!.length>0);assert.notDeepEqual(cloth.rest,buildCloth(old,legacy).rest);assert.ok(Array.from(cloth.rest).every(Number.isFinite));assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(changed))),changed);
 }
});
test('each trim control leaves the independent other trim exact and omitted6cm preserves full legacy geometry',()=>{
 for(const id of ['crew-sweat','hoodie']){
  const old=template(id),same=validateProduct({...old,fit:{cuffHeight:6,hemBandHeight:6}});assert.deepEqual(patternPieces(same),patternPieces(old));assert.deepEqual(teeMesh(same,Delaunator),teeMesh(old,Delaunator));
  for(const[key,unchanged]of[['cuffHeight','hemBand'],['hemBandHeight','cuffLeft']]as const){const next=validateProduct({...old,fit:{[key]:4}});assert.deepEqual(patternPieces(next).find(p=>p.part===unchanged),patternPieces(old).find(p=>p.part===unchanged));assert.deepEqual(teeMesh(next,Delaunator).find(m=>m.part===unchanged),teeMesh(old,Delaunator).find(m=>m.part===unchanged));}
 }
});
test('trim bounds incompatible bases and degenerate short sleeves refuse atomically',()=>{
 for(const key of ['cuffHeight','hemBandHeight']as const){for(const value of [2,12])assert.equal(validateProduct({...template('crew-sweat'),fit:{[key]:value}}).fit![key],value);for(const value of [1.99,12.01,NaN,Infinity,'4',null])assert.throws(()=>validateProduct({...template('crew-sweat'),fit:{[key]:value}}));for(const id of ['blank','trousers'])assert.throws(()=>validateProduct({...template(id),fit:{[key]:4}}));}
 const p=template('crew-sweat');assert.throws(()=>validateProduct({...p,measurements:{...topMeasurements(p),sleeve:10},fit:{cuffHeight:9}}),/cuff|sleeve/i);
});
test('a tall cuff cannot consume the shorter actual underarm sleeve edge',()=>{
 const p=template('crew-sweat'),measurements={...topMeasurements(p),sleeve:14};assert.throws(()=>validateProduct({...p,measurements,fit:{cuffHeight:12}}),/cuff|sleeve/i);assert.doesNotThrow(()=>validateProduct({...p,measurements,fit:{cuffHeight:9.2}}));assert.throws(()=>validateProduct({...p,measurements,fit:{cuffHeight:9.21}}),/actual sleeve edges/);
});
