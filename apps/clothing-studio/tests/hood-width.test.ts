import test from 'node:test';import assert from 'node:assert/strict';import Delaunator from 'delaunator';
import {template,validateProduct,patternPieces,teeMesh} from '../src/product.ts';
import {buildTechPack,fabricUsage} from '../src/techpack.ts';import {buildCloth} from '../src/garment-drape.ts';
test('hood side width changes linked pattern projection and POM while preserving base and other parts',()=>{
 const before=template('hoodie'),after=validateProduct({...before,fit:{hoodWidth:34}}),oldPieces=patternPieces(before),pieces=patternPieces(after);
 assert.equal(pieces.find(p=>p.part==='hood')!.width,34);assert.equal(pieces.find(p=>p.part==='hood')!.height,32);assert.deepEqual(pieces.filter(p=>p.part!=='hood'),oldPieces.filter(p=>p.part!=='hood'));
 const old=teeMesh(before,Delaunator),meshes=teeMesh(after,Delaunator);assert.deepEqual(meshes.filter(m=>m.part!=='hood'),old.filter(m=>m.part!=='hood'));
 // The same neck row; a deeper hood, front to back; its UVs span the wider pattern piece.
 const a=old.find(m=>m.part==='hood')!,b=meshes.find(m=>m.part==='hood')!,u=(m:typeof a)=>Math.max(...m.uvs.filter((_,i)=>i%2===0));
 assert.equal(b.positions.length,a.positions.length);assert.deepEqual(b.positions.slice(0,3),a.positions.slice(0,3));
 assert.notDeepEqual(b.positions,a.positions);assert.ok(Math.abs(u(b)-34)<1e-6&&Math.abs(u(a)-26)<1e-6);assert.equal(buildTechPack(after,'2026-10-24').poms.find(p=>p.code==='N')!.values.M,34);
 assert.ok(fabricUsage(after).reduce((n,r)=>n+r.areaM2,0)>fabricUsage(before).reduce((n,r)=>n+r.areaM2,0));assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(after))),after);
});
test('omitted and explicit26 preserve exact geometry and changed width reaches finite modelled cloth rest',()=>{
 const before=template('hoodie'),same=validateProduct({...before,fit:{hoodWidth:26}});assert.deepEqual(patternPieces(same),patternPieces(before));assert.deepEqual(teeMesh(same,Delaunator),teeMesh(before,Delaunator));
 const after=validateProduct({...before,fit:{hoodWidth:20,hoodHeight:40}}),a=buildCloth(before,teeMesh(before,Delaunator)),b=buildCloth(after,teeMesh(after,Delaunator));assert.equal(patternPieces(after).find(p=>p.part==='hood')!.width,20);assert.equal(patternPieces(after).find(p=>p.part==='hood')!.height,40);assert.equal(a.rest.length,b.rest.length);assert.notDeepEqual(a.rest,b.rest);assert.deepEqual(a.vertices.get('hood'),b.vertices.get('hood'));assert.ok(Array.from(b.rest).every(Number.isFinite));
});
test('hood width bounds and incompatible garment overrides refuse atomically',()=>{
 for(const hoodWidth of [20,34])assert.equal(patternPieces(validateProduct({...template('hoodie'),fit:{hoodWidth}})).find(p=>p.part==='hood')!.width,hoodWidth);
 for(const hoodWidth of [19.99,34.01,NaN,Infinity,'26',null])assert.throws(()=>validateProduct({...template('hoodie'),fit:{hoodWidth}}),/hood side width/i);
 for(const id of ['blank','crew-sweat','trousers']){const raw={...template(id),fit:{hoodWidth:26}},before=structuredClone(raw);assert.throws(()=>validateProduct(raw),/hood|tops/i);assert.deepEqual(raw,before);}
});
