import test from 'node:test';import assert from 'node:assert/strict';import Delaunator from 'delaunator';
import {bodyProxy,simulateGarment} from '../src/garment-drape.ts';import{template,teeMesh}from'../src/product.ts';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const girth=(s:{halfWidth:number;halfDepth:number})=>4*(s.halfWidth-s.halfDepth)+2*Math.PI*s.halfDepth;
test('entered waist/hip define independent stadium girths while chest and body heights stay fixed',()=>{const p=template('ringer'),a=bodyProxy(p,94),b=bodyProxy(p,94,{waist:78,hip:112});near(girth(b.torso[1]!),94);near(girth(b.torso[2]!),78);near(girth(b.torso[3]!),112);assert.deepEqual(b.torso.map(s=>s.y),a.torso.map(s=>s.y));assert.deepEqual(b.capsules,a.capsules);});
test('omitted shape retains exact original default geometry and invalid entries refuse',()=>{const p=template('ringer'),a=bodyProxy(p,94),b=bodyProxy(p,94,{waist:94*.86,hip:94*1.02});assert.deepEqual(a,b);near(girth(a.torso[2]!),80.84);near(girth(a.torso[3]!),95.88);for(const shape of [{waist:49},{waist:181},{hip:49},{hip:221},{waist:NaN},{hip:Infinity},{waist:'80'}])assert.throws(()=>bodyProxy(p,94,shape as unknown as {waist:number;hip:number}));});
test('actual top simulation changes with independently entered hip and retains finite garment-only positions',()=>{const p=template('ringer'),m=teeMesh(p,Delaunator),a=simulateGarment(p,m,94,{frames:90}),b=simulateGarment(p,m,94,{frames:90,bodyShape:{waist:90,hip:112}});assert.notDeepEqual(b.parts[0]!.positions,a.parts[0]!.positions);assert.equal(b.body.hip,112);assert.ok(b.parts.every(p=>p.positions.every(Number.isFinite)));assert.ok(b.metrics.minClearance>=.34);assert.equal(b.parts.length,m.length);});

test('entered chest depth changes section shape while preserving measured chest and waist girths',()=>{
 const p=template('ringer'),a=bodyProxy(p,94),b=bodyProxy(p,94,{waist:80,hip:110,chestDepth:20});
 near(b.torso[1]!.halfDepth*2,20);near(girth(b.torso[1]!),94);near(girth(b.torso[2]!),80);near(girth(b.torso[3]!),110);
 assert.notEqual(b.torso[1]!.halfWidth,a.torso[1]!.halfWidth);assert.notDeepEqual(b.capsules,a.capsules);
 assert.equal(b.chestDepth,20);assert.deepEqual(bodyProxy(p,94,{chestDepth:undefined}),a);
});
test('depth admission rejects impossible stadium dimensions and accepts round and flat boundaries',()=>{
 const p=template('ringer');
 for(const chest of [70,94,140])for(const chestDepth of [10,Math.min(44,chest/Math.PI)]){
  const b=bodyProxy(p,chest,{chestDepth});near(girth(b.torso[1]!),chest);near(b.torso[1]!.halfDepth*2,chestDepth);assert.ok(b.torso[1]!.halfWidth>=b.torso[1]!.halfDepth-1e-12);
 }
 for(const chestDepth of [9,45,NaN,Infinity,'20',70/Math.PI+.001])assert.throws(()=>bodyProxy(p,70,{chestDepth} as unknown as {chestDepth:number}),/depth/i);
});
test('actual garment solve responds to depth at the same chest girth with finite results',()=>{
 const p=template('ringer'),meshes=teeMesh(p,Delaunator),a=simulateGarment(p,meshes,94,{frames:90}),b=simulateGarment(p,meshes,94,{frames:90,bodyShape:{chestDepth:20}});
 assert.equal(b.body.chestDepth,20);assert.notDeepEqual(a.parts[0]!.positions,b.parts[0]!.positions);assert.ok(b.parts.every(p=>p.positions.every(Number.isFinite)));assert.ok(Object.values(b.metrics).every(Number.isFinite));
});

test('coupled-depth guidance gives a two-decimal maximum that is actually admissible',()=>{
 assert.throws(()=>bodyProxy(template('ringer'),108,{chestDepth:35}),/34\.37 cm/);
 assert.doesNotThrow(()=>bodyProxy(template('ringer'),108,{chestDepth:34.37}));
});
