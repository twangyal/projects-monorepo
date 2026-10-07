import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../src/timestamped-export.js';
import {planExportFrames} from '../src/export-timeline.js';
function guard(duration=.1){assert.equal(typeof policy.createFrameCompleteness,'function','complete-frame policy is absent');return policy.createFrameCompleteness(planExportFrames(duration));}
const stamps=[0,33333,66667];
test('complete expected timestamps accept out-of-order native packet delivery',()=>{const g=guard();for(const i of [2,0,1])g.observe(stamps[i]/1e6);assert.doesNotThrow(()=>g.verify());});
test('a missing native output frame refuses publication',()=>{const g=guard();g.observe(0);g.observe(66667/1e6);assert.throws(()=>g.verify(),/missing|incomplete|dropped/i);});
test('a duplicate native output frame refuses even if every expected frame exists',()=>{const g=guard();for(const t of [...stamps,33333])g.observe(t/1e6);assert.throws(()=>g.verify(),/duplicate/i);});
test('unexpected native timestamps refuse without throwing in the callback',()=>{for(const t of [NaN,Infinity,-1,-Number.EPSILON,'0',.05]){const g=guard();assert.doesNotThrow(()=>g.observe(t));assert.throws(()=>g.verify(),/timestamp|unexpected/i);}});
test('maximum accounting accepts all1800 unique authored times and rejects oversized plans',()=>{const plan=planExportFrames(60),g=guard(60);for(let i=0;i<1800;i++)g.observe(plan.frame(i).timestamp/1e6);assert.doesNotThrow(()=>g.verify());assert.throws(()=>policy.createFrameCompleteness({frameCount:1801,frame(){return{timestamp:0};}}),/limit|1800|plan/i);});
test('retired accounting ignores late callbacks and cannot verify a retired export',()=>{const g=guard();g.retire();assert.doesNotThrow(()=>g.observe(NaN));assert.throws(()=>g.verify(),/retired/i);});
test('invalid authored plans refuse before native output observation',()=>{guard();for(const plan of [{frameCount:0},{frameCount:NaN},{frameCount:2,frame(){return{timestamp:0};}},{frameCount:1,frame(){return{timestamp:-1};}},{frameCount:1,frame(){return{timestamp:.5};}},{frameCount:1,frame(){return{timestamp:60000000};}}])assert.throws(()=>policy.createFrameCompleteness(plan),/plan/i);});
