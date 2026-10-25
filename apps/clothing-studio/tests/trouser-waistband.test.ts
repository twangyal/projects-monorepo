import test from 'node:test';import assert from 'node:assert/strict';import Delaunator from 'delaunator';
import{template,validateProduct,legMeasurements,trouserDimensions,patternPieces,teeMesh,garmentHeight}from'../src/product.ts';
import{buildTechPack,fabricUsage}from'../src/techpack.ts';
import{createProject,validateProject,ProjectHistory,serializeProject,parseProject}from'../src/model.ts';
test('edited trouser waistband links folded pattern actual band and POM without changing leg panels',()=>{
 for(const name of ['shorts','trousers']){
 const old=template(name),edited=validateProduct({...old,measurements:{...legMeasurements(old),waistbandHeight:7.5}}),d=trouserDimensions(edited),prior=trouserDimensions(old);
 assert.equal(d.waistbandHeight,7.5);assert.equal(d.outseam,prior.outseam+3.5);assert.equal(garmentHeight(edited),d.length+7.5);
 const patterns=patternPieces(edited),legacy=patternPieces(old);assert.equal(patterns.find(p=>p.part==='waistband')!.height,15);for(const part of ['front','back'])assert.deepEqual(patterns.find(p=>p.part===part),legacy.find(p=>p.part===part));
 const meshes=teeMesh(edited,Delaunator),before=teeMesh(old,Delaunator);for(const part of ['front','back'])assert.deepEqual(meshes.find(m=>m.part===part),before.find(m=>m.part===part));
 const band=meshes.find(m=>m.part==='waistband')!,ys=band.positions.filter((_,i)=>i%3===1);assert.equal(Math.min(...ys),d.length);assert.equal(Math.max(...ys),d.length+7.5);assert.ok(band.uvs.every(Number.isFinite));
 const pack=buildTechPack(edited,'2026-10-25');assert.ok(Object.values(pack.poms.find(p=>p.code==='J')!.values).every(v=>v===7.5));assert.equal(pack.poms.find(p=>p.code==='H')!.values.M,d.outseam);assert.match(pack.construction.find(c=>c.area==='Waistband')!.detail,/7\.5 cm finished/);assert.ok(fabricUsage(edited).reduce((n,p)=>n+p.areaM2,0)>fabricUsage(old).reduce((n,p)=>n+p.areaM2,0));
 }
});
test('legacy default absence and explicit4cm retain exact patterns meshes complete backups and history',()=>{
 const old=template('trousers'),same=validateProduct({...old,measurements:{...legMeasurements(old),waistbandHeight:4}});assert.deepEqual(patternPieces(same),patternPieces(old));assert.deepEqual(teeMesh(same,Delaunator),teeMesh(old,Delaunator));assert.equal(Object.hasOwn(legMeasurements(validateProduct(old)),'waistbandHeight'),false);
 const p=validateProject({...createProject(),product:validateProduct({...old,measurements:{...legMeasurements(old),waistbandHeight:10}})});assert.deepEqual(parseProject(serializeProject(p)),p);const h=new ProjectHistory(createProject());h.commit(p);assert.deepEqual(h.redo(),p);assert.ok(h.undo());assert.deepEqual(h.redo(),p);
});
test('waistband strict numeric bounds accessors unknown fields and tops refuse without reading getters',()=>{
 const old=template('shorts');for(const height of [undefined,null,3.9,10.1,NaN,Infinity,'6'])assert.throws(()=>validateProduct({...old,measurements:{...legMeasurements(old),waistbandHeight:height}}));
 for(const height of [4,10,6.5])assert.equal(trouserDimensions(validateProduct({...old,measurements:{...legMeasurements(old),waistbandHeight:height}})).waistbandHeight,height);
 let reads=0;assert.throws(()=>validateProduct({...old,measurements:{...legMeasurements(old),get waistbandHeight(){reads++;return 6;}}}));assert.equal(reads,0);
 assert.throws(()=>validateProduct({...template('blank'),measurements:{...template('blank').measurements,waistbandHeight:6}}));
});

test('trouser measurement diagram shows finished band and outseam from its top edge',async()=>{
 const {measurementDiagram}=await import('../src/techpack.ts');
 for(const height of [4,7.5,10]){
  const old=template('trousers'),p=validateProduct({...old,measurements:{...legMeasurements(old),waistbandHeight:height}}),svg=measurementDiagram(p),d=trouserDimensions(p);
  const line=(code:string)=>{const m=new RegExp('<line x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"[^>]*\\/><text[^>]*>'+code+'<\\/text>').exec(svg);assert.ok(m,code);return m.slice(1).map(Number);};
  const h=line('H');assert.equal(h[1],-height);assert.equal(h[3],d.length);assert.equal(h[3]-h[1],d.outseam);
  const j=line('J');assert.equal(j[1],-height);assert.equal(j[3],0);assert.match(svg,new RegExp('data-finished-waistband="true"[^>]*height="'+height+'"'));
 }
});
