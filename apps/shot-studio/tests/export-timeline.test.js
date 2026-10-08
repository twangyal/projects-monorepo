import test from 'node:test';
import assert from 'node:assert/strict';
import {planExportFrames,prepareExportPcm} from '../src/export-timeline.js';
import {admitSequenceAudio,sequenceAudioDescriptor,planSoundtrack} from '../src/sequence-audio.js';

async function original({rate=48000,channels=1,seconds=1,values=[],samples=[]}={}){
  const bytes=new Uint8Array(44+rate*seconds*channels*2),v=new DataView(bytes.buffer);
  for(const [at,text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])bytes.set(new TextEncoder().encode(text),at);
  v.setUint32(4,bytes.length-8,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);
  v.setUint32(24,rate,true);v.setUint32(28,rate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);v.setUint32(40,bytes.length-44,true);
  for(let frame=0;frame<values.length;frame++)for(let ch=0;ch<channels;ch++)v.setInt16(44+(frame*channels+ch)*2,values[frame][ch],true);
  for(const [frame,channelsAtFrame] of samples)for(let ch=0;ch<channels;ch++)v.setInt16(44+(frame*channels+ch)*2,channelsAtFrame[ch],true);
  return admitSequenceAudio(new Blob([bytes]));
}
function soundtrack(asset,overrides={},duration=1){return planSoundtrack({label:'Original',asset:sequenceAudioDescriptor(asset),inFrame:0,outFrame:asset.frameCount,startTime:0,gain:1,...overrides},asset,duration);}

test('a fractional film has a complete finite30Hz timestamp schedule with a shortened final frame',()=>{
  const plan=planExportFrames(.105);
  assert.equal(plan.frameCount,4);
  assert.deepEqual([0,1,2,3].map(i=>plan.frame(i)),[
    {time:0,timestamp:0,duration:33333},
    {time:1/30,timestamp:33333,duration:33334},
    {time:2/30,timestamp:66667,duration:33333},
    {time:.1,timestamp:100000,duration:5000},
  ]);
});
test('the maximum minute has1800frames with no missing or duplicate timestamp and no wall-clock dependency',()=>{
  const plan=planExportFrames(60);assert.equal(plan.frameCount,1800);
  let end=0;
  for(let i=0;i<plan.frameCount;i++){
    const frame=plan.frame(i);assert.equal(frame.timestamp,end);assert.ok(frame.duration>0);end+=frame.duration;
    assert.ok(frame.time<60);
  }
  assert.equal(end,60000000);assert.equal(plan.frame(1799).timestamp,59966667);
  assert.deepEqual(plan.frame(0),{time:0,timestamp:0,duration:33333});
});
test('an exact30Hz cut does not create a duplicate terminal frame',()=>{
  const plan=planExportFrames(.1);assert.equal(plan.frameCount,3);
  assert.equal(plan.frame(2).timestamp+plan.frame(2).duration,100000);
  assert.throws(()=>plan.frame(3));
});
test('invalid duration and frame indices refuse before producing an encoder sample',()=>{
  for(const duration of [0,-1,60.001,NaN,Infinity,'1',null,.0000001])assert.throws(()=>planExportFrames(duration));
  const plan=planExportFrames(1);
  for(const index of [-1,.5,30,NaN,Infinity,'0'])assert.throws(()=>plan.frame(index));
});
test('stereo PCM preserves original signed channel values and gain in a bounded planar block',async()=>{
  const asset=await original({channels:2,values:[[-32768,16384],[32767,-16384],[8192,0]]});
  const pcm=await prepareExportPcm(asset,soundtrack(asset,{gain:.5}));
  const block=pcm.block(0);assert.equal(block.timestamp,0);assert.equal(block.numberOfFrames,960);assert.equal(block.numberOfChannels,2);
  assert.equal(block.sampleRate,48000);assert.equal(block.data.length,1920);
  assert.deepEqual([...block.data.slice(0,3)],[-.5,32767/65536,.125]);
  assert.deepEqual([...block.data.slice(960,963)],[.25,-.25,0]);
  block.data.fill(1);assert.equal(pcm.block(0).data[0],-.5,'caller mutation cannot rewrite retained PCM');
});
test('source trim and sequence placement exclude neighboring original samples and retain silence',async()=>{
  const asset=await original({values:[[30000],[1000],[2000],[3000]],samples:[[4800,[3000]],[4801,[32767]]]});
  const pcm=await prepareExportPcm(asset,soundtrack(asset,{inFrame:1,outFrame:4801,startTime:1/48000}));
  const block=pcm.block(0);assert.deepEqual([...block.data.slice(0,4)],[0,1000/32768,2000/32768,3000/32768]);
  assert.equal(pcm.block(5).data[0],3000/32768,'last retained source sample survives');
  assert.equal(pcm.block(5).data[1],0,'source Out excludes the original nonzero neighbor');
  assert.ok(pcm.block(49).data.every(value=>value===0),'sequence silence continues beyond source Out');
});

test('the maximum stereo minute yields all2880000frames without losing the last original PCM sample',async()=>{
  const asset=await original({seconds:60,channels:2,samples:[[0,[-32768,16384]],[2879999,[4096,12288]]]});
  const before=new Uint8Array(await asset.blob.arrayBuffer()),pcm=await prepareExportPcm(asset,soundtrack(asset,{},60));
  assert.equal(pcm.blockCount,3000);assert.equal(pcm.frameCount,2880000);
  let frames=0,nonzero=0;
  for(let i=0;i<3000;i++){
    const block=pcm.block(i);assert.equal(block.timestamp,i*20000);assert.equal(block.numberOfFrames,960);frames+=block.numberOfFrames;
    for(const value of block.data)if(value!==0)nonzero++;
  }
  assert.equal(frames,2880000);assert.equal(nonzero,4);
  const last=pcm.block(2999);assert.equal(last.data[959],.125);assert.equal(last.data[1919],.375);
  assert.deepEqual(new Uint8Array(await asset.blob.arrayBuffer()),before);
});

test('microsecond rounding at a30Hz boundary cannot create a zero-duration encoder frame',()=>{
  const plan=planExportFrames(1/30+.00000001);assert.equal(plan.frameCount,1);
  assert.deepEqual(plan.frame(0),{time:0,timestamp:0,duration:33333});
  assert.deepEqual(planExportFrames(.000001).frame(0),{time:0,timestamp:0,duration:1});
});

test('rounded-up frame boundaries end without an extra zero-duration sample',()=>{
  for(const [duration,count,end] of [[2/30,2,66667],[5/30,5,166667],[32/30,32,1066667]]){
    const plan=planExportFrames(duration);
    assert.equal(plan.frameCount,count);
    const last=plan.frame(count-1);
    assert.ok(last.duration>0);
    assert.equal(last.timestamp+last.duration,end);
    assert.throws(()=>plan.frame(count));
  }
  const beyond=planExportFrames(.066668);
  assert.equal(beyond.frameCount,3);
  assert.deepEqual(beyond.frame(2),{time:2/30,timestamp:66667,duration:1});
});

function replace(t,key,value,target=globalThis){
  const old=Object.getOwnPropertyDescriptor(target,key);Object.defineProperty(target,key,{value,configurable:true,writable:true});
  t.after(()=>{if(old)Object.defineProperty(target,key,old);else delete target[key];});
}
async function heldRead(t,asset){
  const originalRead=Blob.prototype.arrayBuffer;let release,entered;
  const ready=new Promise(resolve=>entered=resolve);
  replace(t,'arrayBuffer',async function(){const bytes=await originalRead.call(this);if(this!==asset.blob)return bytes;entered();return new Promise(resolve=>release=()=>resolve(bytes));},Blob.prototype);
  return{ready,release:()=>release()};
}
test('cancellation during a genuine original-byte read prevents late PCM publication',async t=>{
  const asset=await original(),held=await heldRead(t,asset),controller=new AbortController();
  const pending=prepareExportPcm(asset,soundtrack(asset),{signal:controller.signal});await held.ready;
  controller.abort();await assert.rejects(pending,/cancel/i);held.release();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(asset.blob.size,96044);
});
test('an original-byte read completing at its deadline refuses ahead of the delayed timer',async t=>{
  const asset=await original(),held=await heldRead(t,asset);let now=1000;replace(t,'performance',{now:()=>now});
  const pending=prepareExportPcm(asset,soundtrack(asset));await held.ready;
  now=11000;held.release();await assert.rejects(pending,/timed out/i);
});
test('44.1kHz source values are linearly resampled onto exact48kHz encoder frames',async()=>{
  const asset=await original({rate:44100,values:[[0],[16000],[32000],[16000],[0]]});
  const pcm=await prepareExportPcm(asset,soundtrack(asset));
  assert.deepEqual([...pcm.block(0).data.slice(0,4)],[0,14700/32768,29400/32768,19900/32768]);
});
test('a source beyond the sequence or zero gain produces a complete silent input timeline',async()=>{
  const asset=await original({values:[[32767]]});
  for(const overrides of [{startTime:2},{gain:0}]){
    const pcm=await prepareExportPcm(asset,soundtrack(asset,overrides,.105));
    assert.equal(pcm.blockCount,6);assert.equal(pcm.frameCount,5040);
    const last=pcm.block(5);assert.equal(last.timestamp,100000);assert.equal(last.numberOfFrames,240);
    assert.ok(pcm.block(0).data.every(value=>value===0));assert.ok(last.data.every(value=>value===0));
    assert.throws(()=>pcm.block(6));
  }
});
test('PCM preparation rejects forged assets/plans and preaborted work',async()=>{
  const asset=await original(),plan=soundtrack(asset),controller=new AbortController();controller.abort();
  await assert.rejects(prepareExportPcm({...asset},plan));
  await assert.rejects(prepareExportPcm(asset,{...plan}));
  await assert.rejects(prepareExportPcm(asset,plan,{signal:controller.signal}),/cancel/i);
});

test('fractional sequence placement preserves the source phase without leaking pre-trim samples',async()=>{
  const asset=await original({rate:44100,values:[[-32768],[16000],[32000],[16000]]});
  const pcm=await prepareExportPcm(asset,soundtrack(asset,{inFrame:1,outFrame:4411,startTime:.5/48000}));
  const data=pcm.block(0).data;assert.equal(data[0],0);assert.equal(data[1],23350/32768);
  assert.equal(data[2],25950/32768);
});
