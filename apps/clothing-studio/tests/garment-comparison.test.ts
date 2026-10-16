import test from 'node:test';
import assert from 'node:assert/strict';
import Delaunator from 'delaunator';
import {fabricVariants,comparisonReceipt} from '../src/garment-comparison.ts';
import {template,teeMesh,partsOf,RIB_PARTS} from '../src/product.ts';
import {simulateGarment} from '../src/garment-drape.ts';

test('fabric candidates preserve source styling, rib trims and saved colorways without shared mutable data',()=>{
 const source=template('ringer');source.parts.front.print={motif:'stripe',color:'#123456',scaleCm:4,layout:'grid',direction:'vertical'};source.artwork=[{part:'front',dataUrl:'data:image/png;base64,captured',width:16,height:16,name:'Original motif',xCm:0,yCm:20,widthCm:8,rotation:30}];source.colorways=[{id:'saved',name:'Original',parts:structuredClone(source.parts),units:10}];
 const before=structuredClone(source),variants=fabricVariants(source,['jersey-180','denim-340']);
 for(const [i,candidate]of variants.entries())for(const id of partsOf(source)){
  assert.equal(candidate.parts[id].material,RIB_PARTS.has(id)?before.parts[id].material:['jersey-180','denim-340'][i]);
  assert.equal(candidate.parts[id].color,before.parts[id].color);assert.deepEqual(candidate.parts[id].print,before.parts[id].print);
 }
 assert.deepEqual(variants[1].artwork,before.artwork);assert.deepEqual(variants[1].colorways,before.colorways);
 variants[1].parts.front.color='#000000';variants[0].colorways![0]!.units=99;
 assert.deepEqual(source,before);assert.equal(variants[1].colorways![0]!.units,10);
});
test('unsupported material comparisons refuse rather than silently changing the design',()=>{
 assert.throws(()=>fabricVariants(template('blank'),['jersey-180','jersey-180']),/different/);
 assert.throws(()=>fabricVariants(template('blank'),['missing','denim-340']),/fabric/);
 assert.throws(()=>fabricVariants(template('trousers'),['jersey-180','denim-340']),/tops/);
});
test('receipt retains both actual garment results and matching captured body as ordinary JSON',()=>{
 const source=template('ringer'),body={chest:94,waist:80,hip:110},ids:[string,string]=['jersey-180','denim-340'];
 const candidates=fabricVariants(source,ids),results=candidates.map(p=>simulateGarment(p,teeMesh(p,Delaunator),body.chest,{bodyShape:body}));
 const data=JSON.parse(JSON.stringify(comparisonReceipt(source,body,ids,results as [typeof results[0],typeof results[0]])));
 assert.deepEqual(data.source,source);assert.deepEqual(data.body,body);
 for(let i=0;i<2;i++){assert.deepEqual(data.candidates[i].result.parts[0].positions,Array.from(results[i]!.parts[0]!.positions));assert.deepEqual(data.candidates[i].result.metrics,results[i]!.metrics);assert.equal(data.candidates[i].product.parts.front.material,ids[i]);assert.ok(data.candidates[i].result.parts.every((p:{positions:number[]})=>p.positions.every(Number.isFinite)));}
 assert.notDeepEqual(data.candidates[0].result.parts[0].positions,data.candidates[1].result.parts[0].positions);
});
