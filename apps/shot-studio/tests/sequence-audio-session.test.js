import test from 'node:test';
import assert from 'node:assert/strict';
import {admitSequenceAudio,sequenceAudioDescriptor,planSoundtrack} from '../src/sequence-audio.js';
import {prepareSequenceAudioSession} from '../src/sequence-audio-session.js';

async function input(){const bytes=new Uint8Array(44+4*48000*4),v=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('RIFF'));v.setUint32(4,bytes.length-8,true);bytes.set(new TextEncoder().encode('WAVEfmt '),8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,48000,true);v.setUint32(28,192000,true);v.setUint16(32,4,true);v.setUint16(34,16,true);bytes.set(new TextEncoder().encode('data'),36);v.setUint32(40,bytes.length-44,true);v.setInt16(44,-32768,true);v.setInt16(46,32767,true);const asset=await admitSequenceAudio(new Blob([bytes]));return{asset,plan:planSoundtrack({label:'Original',asset:sequenceAudioDescriptor(asset),inFrame:24000,outFrame:168000,startTime:.75,gain:.25},asset,3)};}
function native(t,{resume,close,constantStart}={}){
  const instances=[],old=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');
  class Node{constructor(){this.connections=[];this.disconnects=0;}connect(other){this.connections.push(other);}disconnect(){this.disconnects++;}}
  class Context{
    constructor(){instances.push(this);this.currentTime=1;this.sampleRate=48000;this.state='suspended';this.destination=new Node();this.sources=[];this.constants=[];this.buffers=[];this.listeners=new Map();this.closes=0;this.track={stops:0,stop(){this.stops++;}};}
    createBuffer(channels,frames,rate){const data=Array.from({length:channels},()=>new Float32Array(frames)),buffer={data,sampleRate:rate,getChannelData:i=>data[i]};this.buffers.push(buffer);return buffer;}
    createMediaStreamDestination(){this.media=new Node();this.media.stream={getTracks:()=>[this.track],getAudioTracks:()=>[this.track]};return this.media;}
    createGain(){const gain=new Node();gain.gain={value:1};return gain;}
    createBufferSource(){const source=new Node();source.starts=[];source.stops=[];source.start=(...args)=>source.starts.push(args);source.stop=(...args)=>source.stops.push(args);this.sources.push(source);return source;}
    createConstantSource(){const source=new Node();source.offset={value:1};source.starts=[];source.stops=[];source.start=(...args)=>{source.starts.push(args);constantStart?.();};source.stop=(...args)=>source.stops.push(args);this.constants.push(source);return source;}
    addEventListener(name,callback){this.listeners.set(name,callback);}removeEventListener(name){this.listeners.delete(name);}
    async resume(){if(resume)await resume();this.state='running';}
    async close(){this.closes++;if(close)await close();this.state='closed';}
  }
  Object.defineProperty(globalThis,'AudioContext',{value:Context,configurable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,'AudioContext',old);else delete globalThis.AudioContext;});return instances;
}
test('prepare is silent; same clock schedules source crop/gain and absolute preview time',async t=>{
  const instances=native(t),{asset,plan}=await input(),session=await prepareSequenceAudioSession(asset,plan),context=instances[0];assert.equal(context.sources.length,0);assert.equal(context.buffers[0].data[0][0],-1);assert.equal(context.buffers[0].data[1][0],32767/32768);
  session.start(.5,{capture:false});assert.deepEqual(context.sources[0].starts,[[1.25,.5,2.25]]);assert.ok(context.sources[0].connections[0].connections.includes(context.destination));context.currentTime=2;assert.equal(session.time(),1.5);session.stop();context.currentTime=3;assert.equal(session.time(),1.5);assert.throws(()=>session.start(0));await session.close();assert.equal(context.closes,1);assert.equal(context.track.stops,1);
});
test('capture routes only the destination and closes idempotently through actual drain',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),instances=native(t,{close:()=>held}),{asset,plan}=await input(),session=await prepareSequenceAudioSession(asset,plan);session.start(0,{capture:true});const context=instances[0],gain=context.sources[0].connections[0];assert.deepEqual(gain.connections,[context.media]);assert.equal(session.captureStream,context.media.stream);assert.equal(context.media.channelCount,2);let settled=false;const closed=session.close().then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);release();await closed;await session.close();assert.equal(context.closes,1);assert.equal(context.track.stops,1);
});
test('cancel while resume pending holds preparation until late native settlement and starts nothing',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),instances=native(t,{resume:()=>held}),{asset,plan}=await input(),controller=new AbortController();let settled=false;const pending=prepareSequenceAudioSession(asset,plan,{signal:controller.signal}).finally(()=>settled=true);await new Promise(resolve=>setImmediate(resolve));controller.abort();await Promise.resolve();assert.equal(settled,false);release();await assert.rejects(pending,/cancel/i);assert.equal(instances[0].sources.length,0);assert.equal(instances[0].closes,1);assert.equal(instances[0].track.stops,1);
});
test('wrong plan/preabort reject before context admission; invalid start never schedules',async t=>{
  const instances=native(t),{asset,plan}=await input(),controller=new AbortController();controller.abort();await assert.rejects(prepareSequenceAudioSession(asset,plan,{signal:controller.signal}));await assert.rejects(prepareSequenceAudioSession(asset,{...plan}));assert.equal(instances.length,0);const session=await prepareSequenceAudioSession(asset,plan);assert.throws(()=>session.start(-1));assert.throws(()=>session.start(0,{capture:'yes'}));assert.equal(instances[0].sources.length,0);await session.close();
});
test('context state failure retires audio instead of substituting another clock',async t=>{
  const instances=native(t),{asset,plan}=await input(),session=await prepareSequenceAudioSession(asset,plan);session.start(0);instances[0].state='suspended';assert.throws(()=>session.time(),/context|suspend|running/i);session.stop();await session.close();assert.equal(instances[0].closes,1);
});
test('successful native resume delivered beyond setup deadline cannot publish a session',async t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=0;Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});t.after(()=>Object.defineProperty(globalThis,'performance',old));
  const instances=native(t,{resume:async()=>{now=10001;}}),{asset,plan}=await input();await assert.rejects(prepareSequenceAudioSession(asset,plan),/timed out/i);assert.equal(instances[0].closes,1);assert.equal(instances[0].track.stops,1);assert.equal(instances[0].sources.length,0);
});
test('capture keeps a zero signal connected from the shared origin through trailing silence without another PCM buffer',async t=>{
  const instances=native(t),{asset}=await input(),plan=planSoundtrack({label:'Short tone',asset:sequenceAudioDescriptor(asset),inFrame:0,outFrame:48000,startTime:1,gain:.25},asset,6),session=await prepareSequenceAudioSession(asset,plan),context=instances[0];
  assert.equal(context.constants.length,0);context.currentTime=1.00001;session.start(.5,{capture:true});
  assert.equal(context.constants.length,1,'capture needs a live zero signal after the original source ends');
  const silence=context.constants[0],origin=Math.ceil(1.00001*48000)/48000;
  assert.equal(silence.offset.value,0);assert.deepEqual(silence.starts,[[origin]]);assert.deepEqual(silence.connections,[context.media]);
  assert.equal(context.sources[0].starts.length,1);assert.ok(Math.abs(context.sources[0].starts[0][0]-(origin+.5))<2*Number.EPSILON);assert.deepEqual(context.sources[0].starts[0].slice(1),[0,1]);assert.deepEqual(context.sources[0].connections[0].connections,[context.media]);assert.equal(context.sources[0].connections[0].gain.value,.25);
  context.currentTime=origin+3.5;assert.equal(session.time(),4);assert.deepEqual(silence.stops,[]);assert.equal(silence.disconnects,0);
  context.currentTime=origin+5.5;assert.equal(session.time(),6);assert.equal(context.buffers.length,1);assert.equal(context.buffers[0].data[0].length,asset.frameCount);
  session.stop();session.stop();await session.close();await session.close();assert.deepEqual(silence.stops,[[]]);assert.equal(silence.disconnects,1);assert.equal(context.closes,1);assert.equal(context.track.stops,1);
});
for(const settings of [{name:'a source beyond the sequence',startTime:10,gain:1},{name:'zero gain',startTime:.5,gain:0}])test(`capture retains its entire silent timeline for ${settings.name}`,async t=>{
  const instances=native(t),{asset}=await input(),plan=planSoundtrack({label:'Silent output',asset:sequenceAudioDescriptor(asset),inFrame:0,outFrame:48000,startTime:settings.startTime,gain:settings.gain},asset,6),session=await prepareSequenceAudioSession(asset,plan),context=instances[0];
  session.start(0,{capture:true});assert.equal(context.sources.length,0);assert.equal(context.constants.length,1,'even an inaudible soundtrack must keep an audio timeline');
  const silence=context.constants[0];assert.equal(silence.offset.value,0);assert.deepEqual(silence.starts,[[1]]);assert.deepEqual(silence.connections,[context.media]);context.currentTime=7;assert.equal(session.time(),6);assert.deepEqual(silence.stops,[]);await session.close();assert.deepEqual(silence.stops,[[]]);assert.equal(silence.disconnects,1);
});
test('preview does not create or depend on a constant source',async t=>{
  const instances=native(t),{asset,plan}=await input(),session=await prepareSequenceAudioSession(asset,plan),context=instances[0];context.createConstantSource=undefined;session.start(0);assert.equal(context.constants.length,0);assert.deepEqual(context.sources[0].connections[0].connections,[context.destination]);await session.close();
});
test('active cancellation immediately stops the capture silence and waits for the owned context close',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),instances=native(t,{close:()=>held}),{asset,plan}=await input(),controller=new AbortController(),session=await prepareSequenceAudioSession(asset,plan,{signal:controller.signal}),context=instances[0];session.start(0,{capture:true});assert.equal(context.constants.length,1);
  const silence=context.constants[0];controller.abort();assert.deepEqual(silence.stops,[[]]);assert.equal(silence.disconnects,1);assert.equal(context.track.stops,1);let settled=false;const closing=session.close().then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);release();await closing;assert.equal(context.closes,1);assert.deepEqual(silence.stops,[[]]);assert.throws(()=>session.time(),/cancel/i);
});
test('native capture silence start failure retires the node, stream and context without publishing playback',async t=>{
  const instances=native(t,{constantStart:()=>{throw Error('native constant start failed');}}),{asset,plan}=await input(),session=await prepareSequenceAudioSession(asset,plan),context=instances[0];assert.throws(()=>session.start(0,{capture:true}),/native constant start failed/);
  await session.close();assert.equal(context.constants.length,1);assert.deepEqual(context.constants[0].stops,[[]]);assert.equal(context.constants[0].disconnects,1);assert.equal(context.track.stops,1);assert.equal(context.closes,1);assert.equal(context.sources.length,0);assert.throws(()=>session.time(),/native constant start failed/);
});
