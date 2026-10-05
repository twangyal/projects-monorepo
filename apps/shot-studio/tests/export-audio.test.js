import test from 'node:test';
import assert from 'node:assert/strict';
import {admitSequenceAudio,sequenceAudioDescriptor,planSoundtrack} from '../src/sequence-audio.js';
import {prepareSequenceAudioSession} from '../src/sequence-audio-session.js';
import {exportFilm} from '../src/export.js';

function install(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
async function fixture(t,{constructorFails=false,encoder=true,close}={}){
  const bytes=new Uint8Array(44+96000),v=new DataView(bytes.buffer);bytes.set(new TextEncoder().encode('RIFF'));v.setUint32(4,bytes.length-8,true);bytes.set(new TextEncoder().encode('WAVEfmt '),8);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint32(28,96000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);bytes.set(new TextEncoder().encode('data'),36);v.setUint32(40,96000,true);
  let context,recorder,raf;const audioTrack={kind:'audio',stops:0,stop(){this.stops++;}},videoTrack={kind:'video',stops:0,requests:0,stop(){this.stops++;},requestFrame(){this.requests++;}},draws=[];
  class Node{connect(){}disconnect(){}}
  class Context{constructor(){context=this;this.state='running';this.sampleRate=48000;this.currentTime=1;this.destination=new Node();this.closes=0;}createBuffer(ch,frames){return{getChannelData:()=>new Float32Array(frames)}}createBufferSource(){const node=new Node();node.start=()=>{};node.stop=()=>{};return node;}createGain(){const node=new Node();node.gain={value:1};return node;}createConstantSource(){const node=new Node();node.offset={value:1};node.start=()=>{};node.stop=()=>{};return node;}createMediaStreamDestination(){const node=new Node();node.stream={getTracks:()=>[audioTrack],getAudioTracks:()=>[audioTrack]};return node;}resume(){return Promise.resolve();}async close(){this.closes++;if(close)await close();this.state='closed';}}
  class Stream{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}}
  class Recorder{static isTypeSupported(mime){return encoder&&mime.includes('opus');}constructor(stream,options){if(constructorFails)throw Error('constructor failed');recorder=this;this.stream=stream;this.options=options;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['mux'])});this.onstop?.();}}
  install(t,'AudioContext',Context);install(t,'MediaStream',Stream);install(t,'MediaRecorder',Recorder);install(t,'requestAnimationFrame',fn=>{raf=fn;return 1;});install(t,'cancelAnimationFrame',()=>{raf=null;});
  const asset=await admitSequenceAudio(new Blob([bytes])),plan=planSoundtrack({label:'tone',asset:sequenceAudioDescriptor(asset),inFrame:0,outFrame:48000,startTime:0,gain:1},asset,1),session=await prepareSequenceAudioSession(asset,plan);
  return{session,context,audioTrack,videoTrack,draws,canvas:{captureStream:()=>new Stream([videoTrack])},draw:time=>draws.push(time),tick(now,audioNow){context.currentTime=audioNow;assert.ok(raf);const callback=raf;raf=null;callback(now);},get recorder(){return recorder;}};
}
test('actual admitted audio session adds an Opus track and drives draw time from its audio clock',async t=>{
  const f=await fixture(t),pending=exportFilm(f.canvas,f.draw,1,{audioSession:f.session});assert.deepEqual(f.recorder.stream.getTracks(),[f.videoTrack,f.audioTrack]);assert.equal(f.recorder.options.mimeType,'video/webm;codecs=vp9,opus');f.tick(999999,1.25);assert.equal(f.draws.at(-1),.25);f.tick(1000040,2);const blob=await pending;assert.equal(blob.size,3);assert.equal(blob.type,'video/webm;codecs=vp9,opus');assert.equal(f.videoTrack.stops,1);assert.equal(f.audioTrack.stops,1);assert.equal(f.context.closes,1);
});
test('export completion waits owned context close; cancellation cleans both tracks without late publication',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),f=await fixture(t,{close:()=>held}),controller=new AbortController();let terminal=false;const pending=exportFilm(f.canvas,f.draw,1,{audioSession:f.session,signal:controller.signal}).finally(()=>terminal=true);controller.abort();await Promise.resolve();assert.equal(terminal,false);release();await assert.rejects(pending,/cancel/i);assert.equal(f.videoTrack.stops,1);assert.equal(f.audioTrack.stops,1);assert.equal(f.context.closes,1);
});
test('encoder constructor failure or unsupported audiovisual format retires the prepared session',async t=>{
  for(const options of [{constructorFails:true},{encoder:false}]){const f=await fixture(t,options);await assert.rejects(exportFilm(f.canvas,f.draw,1,{audioSession:f.session}),/constructor|audio|encode/i);assert.equal(f.audioTrack.stops,1);assert.equal(f.context.closes,1);assert.equal(f.videoTrack.stops,options.constructorFails?1:0);}
});
test('combined encoder byte overflow rejects before retaining data and cleans both tracks',async t=>{
  const f=await fixture(t),pending=exportFilm(f.canvas,f.draw,1,{audioSession:f.session,maxBytes:2});f.recorder.ondataavailable({data:new Blob(['123'])});await assert.rejects(pending,/byte limit/i);assert.equal(f.videoTrack.stops,1);assert.equal(f.audioTrack.stops,1);assert.equal(f.recorder.ondataavailable,null);
});

test('absolute deadline refusal waits for owned audio close without publishing a late encoder result',async t=>{
  let release;const held=new Promise(resolve=>release=resolve),f=await fixture(t,{close:()=>held});
  let now=1000;install(t,'performance',{now:()=>now});let terminal=false;
  const pending=exportFilm(f.canvas,f.draw,1,{audioSession:f.session}).finally(()=>terminal=true);
  now=12000;f.recorder.stop();await Promise.resolve();assert.equal(terminal,false);
  assert.equal(f.videoTrack.stops,1);assert.equal(f.audioTrack.stops,1);
  release();await assert.rejects(pending,/timed out/i);assert.equal(f.context.closes,1);
});
