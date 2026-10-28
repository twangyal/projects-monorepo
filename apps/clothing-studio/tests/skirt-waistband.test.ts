import { test } from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import * as products from '../src/product.ts';
import { buildTechPack, fabricUsage } from '../src/techpack.ts';
import { buildCloth, simulateGarment, garmentBody } from '../src/garment-drape.ts';
import { patternSvg, patternDxf } from '../src/pattern-export.ts';

const skirt = () => products.template('flared-skirt');
// Without the optional-parts/model change, a valid band is rejected or disappears from geometry.
function banded(height = 4) {
  const p = skirt();
  return products.validateProduct({...p, measurements:{...p.measurements,waistbandHeight:height},parts:{...p.parts,waistband:structuredClone(p.parts.front)}});
}
test('optional skirt band validates without changing legacy designs and refuses invalid measurements/styles', () => {
  const old=skirt(); assert.deepEqual(products.validateProduct(JSON.parse(JSON.stringify(old))),old);
  const p=banded(); assert.deepEqual(products.partsOf(p),['front','back','waistband']);
  assert.equal((p.measurements as {waistbandHeight:number}).waistbandHeight,4);
  for(const height of [2,10]) banded(height);
  for(const height of [0,1.9,10.1,NaN,Infinity,'4',null,undefined]) assert.throws(()=>products.validateProduct({...p,measurements:{...p.measurements,waistbandHeight:height}}));
  assert.throws(()=>products.validateProduct({...old,measurements:{...old.measurements,waistbandHeight:4}}));
  assert.throws(()=>products.validateProduct({...p,measurements:old.measurements}));
  let reads=0; const measurements={...old.measurements}; Object.defineProperty(measurements,'waistbandHeight',{enumerable:true,get(){reads++;return 4;}});
  assert.throws(()=>products.validateProduct({...p,measurements}));assert.equal(reads,0);
});

test('a folded band cuts twice the finished height and adds its own fabric consumption and tech-pack measurements',()=>{
  const p=banded(6),piece=products.patternPieces(p).find(x=>x.part==='waistband')!;
  assert.equal(piece.width,80);assert.equal(piece.height,12);assert.equal(piece.areaCm2,960);assert.equal(piece.cutCount,1);
  p.parts.waistband={material:'denim-340',color:'#112233',print:null};
  const use=fabricUsage(p).find(x=>x.parts.includes('waistband'))!;assert.ok(Math.abs(use.areaM2-0.1104)<1e-9);
  const pack=buildTechPack(p,'2026-10-28');assert.equal(pack.poms.find(x=>x.name==='Waistband height')!.values.M,6);
  assert.match(JSON.stringify(pack.construction),/fold/i);assert.match(JSON.stringify(pack.notes),/closure/i);
  assert.match(patternSvg(p),/data-piece="waistband"/);assert.match(patternDxf(p),/Waistband/);
  assert.deepEqual(piece.foldLine,[{x:0,y:6},{x:80,y:6}]);assert.match(patternSvg(p),/data-fold="waistband"/);assert.match(patternDxf(p),/8\nFOLD\n/);
});

test('band seam joins the complete waist ring, increases height and stays finite in the real cloth solve',()=>{
  const p=banded(),meshes=products.teeMesh(p,Delaunator),band=meshes.find(x=>x.part==='waistband')!;
  const panel=meshes[0],seamY=Math.max(...panel.positions.filter((_,i)=>i%3===1));
  assert.ok(Math.abs(products.garmentHeight(p)-seamY-4)<1e-9);
  assert.equal(Math.min(...band.positions.filter((_,i)=>i%3===1)),seamY);
  assert.equal(Math.max(...band.positions.filter((_,i)=>i%3===1)),seamY+4);
  const cloth=buildCloth(p,meshes),bandIds=new Set(cloth.vertices.get('waistband'));
  for(const part of ['front','back'] as const){const mesh=meshes.find(x=>x.part===part)!,ids=cloth.vertices.get(part)!;for(let i=0;i<ids.length;i++)if(Math.abs(mesh.positions[i*3+1]-seamY)<1e-8)assert.ok(bandIds.has(ids[i]),'every panel waist point is sewn to the band');}
  const body=garmentBody(p,90);assert.ok(Math.abs(body.torso[0].y-seamY-4)<1e-9);
  const result=simulateGarment(p,meshes,90,{frames:90});
  assert.ok(result.parts.every(part=>part.positions.every(Number.isFinite)));
  const draped=result.parts.find(x=>x.part==='waistband')!;
  // The held upper edge must remain at the intended total height after gravity.
  assert.ok(Math.abs(Math.max(...draped.positions.filter((_,i)=>i%3===1))-seamY-4)<0.001);
});

// Pinning a circular band through the stadium-shaped waist must not hold cloth inside the body.
test('a tall skirt band keeps its held edge outside the body',()=>{
  const p=banded(10),result=simulateGarment(p,products.teeMesh(p,Delaunator),90,{frames:90});
  assert.ok(result.metrics.minClearance>=0.34,`clearance ${result.metrics.minClearance}`);
});

// Dropping the band from saved colourways would invalidate the whole project on the next edit/reload.
test('adding, resizing and removing a band keeps each colourway independent',()=>{
  const old=skirt(),other=structuredClone(old.parts);other.front.color='#123456';
  old.colorways=[{id:'c1',name:'Other',parts:other,units:12}];const before=JSON.stringify(old);
  const added=products.withSkirtWaistband(old,4);assert.equal(JSON.stringify(old),before);
  assert.equal(added.parts.waistband.color,'#9fae91');assert.equal(added.colorways![0].parts.waistband.color,'#123456');
  added.parts.waistband.color='#ff0000';added.colorways![0].parts.waistband.color='#0000ff';
  const resized=products.withSkirtWaistband(added,8);assert.equal(resized.parts.waistband.color,'#ff0000');assert.equal(resized.colorways![0].parts.waistband.color,'#0000ff');
  assert.deepEqual(products.withSkirtWaistband(resized,0),old);
  assert.throws(()=>products.withSkirtWaistband(added,1));assert.throws(()=>products.withSkirtWaistband(products.template('blank'),4));
});
