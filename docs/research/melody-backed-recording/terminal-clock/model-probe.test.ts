import test from 'node:test';import assert from 'node:assert/strict';import {BackedFrames} from '../src/backed-frames.ts';
const block=()=>[new Float32Array(128)];
for(const [name,prepare,incoming,start,previous] of [
 ['readiness overlap',(f:BackedFrames)=>f.push(0,block()),64,null,128],
 ['armed gap',(f:BackedFrames)=>{f.push(0,block());f.arm(256,1024);},256,256,128],
 ['first armed late',(f:BackedFrames)=>f.arm(256,1024),384,256,null],
]as const)test(name,()=>{const f=new BackedFrames(44100);prepare(f);assert.throws(()=>f.push(incoming,block()),{reason:'discontinuous-frames'});assert.deepEqual(f.researchReceipt(),{site:'clock',previousEnd:previous,incomingStart:incoming,incomingLength:128,startFrame:start,limitFrame:start===null?null:1024,captured:0});});
test('clean capture does not allocate terminal receipt',()=>{const f=new BackedFrames(44100);f.push(0,block());f.arm(128,256);assert.equal(f.push(128,block())?.samples.length,128);assert.equal(f.researchReceipt(),null);});
