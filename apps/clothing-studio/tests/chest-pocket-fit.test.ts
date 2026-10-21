import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {template,validateProduct,withOptions,teeDimensions,patternPieces,teeMesh,POCKET_FOLD_CM,type Product} from '../src/product.ts';
import {buildTechPack} from '../src/techpack.ts';
const pocket=(id='blank'):Product=>validateProduct(withOptions(template(id),{hem:'straight',chestPocket:true}));

test('authored pocket dimensions and signed placement reach actual patch, facing and tech pack',()=>{
 for(const id of ['blank','crew-sweat']){
  const original=pocket(id),edited=validateProduct({...original,fit:{chestPocketWidth:10,chestPocketHeight:16,chestPocketX:-8,chestPocketY:20}}),d=teeDimensions(edited);
  assert.deepEqual([d.chestPocketWidth,d.chestPocketHeight,d.chestPocketX,d.chestPocketY],[10,16,-8,20]);
  const piece=patternPieces(edited).find(p=>p.part==='chestPocket')!;assert.equal(piece.width,10);assert.equal(piece.height,16+POCKET_FOLD_CM);
  const mesh=teeMesh(edited,Delaunator).find(p=>p.part==='chestPocket')!,xs=mesh.positions.filter((_,i)=>i%3===0),ys=mesh.positions.filter((_,i)=>i%3===1);
  assert.ok(Math.abs(Math.min(...xs)+13)<1e-5);assert.ok(Math.abs(Math.max(...xs)+3)<1e-5);assert.ok(Math.abs(Math.max(...ys)-(d.length-20))<1e-5);assert.ok(Math.abs(Math.min(...ys)-(d.length-36))<1e-5);
  assert.deepEqual(teeMesh(edited,Delaunator).find(p=>p.part==='front'),teeMesh(original,Delaunator).find(p=>p.part==='front'));
  const pack=buildTechPack(edited,'2026-10-21');for(const [code,value] of [['P',10],['Q',16],['R',20],['V',-8]] as const)assert.equal(pack.poms.find(p=>p.code===code)!.values.M,value);
  assert.match(pack.construction.find(p=>p.area==='Chest pocket')!.detail,/right/);
 }
});
test('absent pocket edits retain exact legacy geometry and portable sparse settings survive removing the module',()=>{
 for(const id of ['blank','crew-sweat']){
  const original=pocket(id),d=teeDimensions(original),explicit=validateProduct({...original,fit:{chestPocketWidth:12,chestPocketHeight:13.5,chestPocketX:d.chestPocketX,chestPocketY:d.chestPocketY}});
  assert.deepEqual(patternPieces(original),patternPieces(explicit));assert.deepEqual(teeMesh(original,Delaunator),teeMesh(explicit,Delaunator));assert.deepEqual(validateProduct(JSON.parse(JSON.stringify(explicit))),explicit);
  const off=validateProduct(withOptions(explicit,{hem:'straight',chestPocket:false}));assert.deepEqual(off.fit,explicit.fit);assert.deepEqual(validateProduct(withOptions(off,{hem:'straight',chestPocket:true})),explicit);
 }
});
test('pocket data has strict bounds and is limited to supported tops even while disabled',()=>{
 for(const [key,values] of Object.entries({chestPocketWidth:[6,20],chestPocketHeight:[6,24],chestPocketX:[-22,22],chestPocketY:[8,45]})){
  for(const value of values)assert.equal(validateProduct({...template('blank'),fit:{[key]:value}}).fit?.[key as keyof NonNullable<Product['fit']>],value);
  for(const value of [values[0]-0.01,values[1]+0.01,NaN,Infinity,'10',null])assert.throws(()=>validateProduct({...template('blank'),fit:{[key]:value}}));
  assert.throws(()=>validateProduct({...template('hoodie'),fit:{[key]:10}}),/pocket/i);assert.throws(()=>validateProduct({...template('trousers'),fit:{[key]:10}}),/tops/);
 }
});
test('enabled pockets refuse neck, armhole, side and hem crossings without clamping authored settings',()=>{
 const original=pocket(),before=structuredClone(original);
 for(const fit of [{chestPocketX:0,chestPocketY:8},{chestPocketX:22,chestPocketWidth:20},{chestPocketY:8,chestPocketX:20,chestPocketWidth:12}])assert.throws(()=>validateProduct({...original,fit}),/inside.*front|front.*panel/i);
 const short={...original,measurements:{chest:104,length:55,sleeve:21},fit:{chestPocketY:45,chestPocketHeight:12}};assert.throws(()=>validateProduct(short),/inside.*front|front.*panel/i);
 const off=validateProduct({...template('blank'),fit:{chestPocketX:22,chestPocketWidth:20}});assert.throws(()=>validateProduct(withOptions(off,{hem:'straight',chestPocket:true})),/inside.*front|front.*panel/i);
 assert.deepEqual(original,before);
});
