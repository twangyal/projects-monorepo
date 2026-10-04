import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFilm} from '../src/export.js';

const CAP=32*1024*1024;
function replace(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
function harness(t,{capture,construct}={}){
  const counters={captures:0,tracks:0,recorderStops:0,starts:0,frames:0};
  let recorder;
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(){if(construct)construct();recorder=this;this.state='inactive';}
    start(){this.state='recording';counters.starts++;}
    stop(){this.state='inactive';counters.recorderStops++;this.onstop?.();}
  }
  replace(t,'MediaRecorder',Recorder);
  replace(t,'requestAnimationFrame',()=>1);
  replace(t,'cancelAnimationFrame',()=>counters.frames++);
  const canvas={captureStream(){counters.captures++;capture?.();const track={stop:()=>counters.tracks++,requestFrame(){}};return {getTracks:()=>[track],getVideoTracks:()=>[track]};}};
  return {canvas,counters,get recorder(){return recorder;}};
}

test('exact configured byte cap completes while one further chunk byte fails before retention',async t=>{
  const h=harness(t);
  const success=exportFilm(h.canvas,()=>{},1,{maxBytes:4});
  h.recorder.ondataavailable({data:new Blob(['ab'])});
  h.recorder.ondataavailable({data:new Blob(['cd'])});
  h.recorder.stop();
  assert.equal(await (await success).text(),'abcd');
  const failure=exportFilm(h.canvas,()=>{},1,{maxBytes:4});
  h.recorder.ondataavailable({data:new Blob(['abcd'])});
  h.recorder.ondataavailable({data:new Blob(['e'])});
  await assert.rejects(failure,/32 MiB|size|limit|bytes/i);
  assert.equal(h.counters.tracks,2);
});

test('invalid byte caps and durations fail synchronously before drawing or capture',t=>{
  const h=harness(t);let draws=0;
  for(const maxBytes of [0,-1,1.5,CAP+1,NaN,Infinity,null,'4']){
    assert.throws(()=>exportFilm(h.canvas,()=>draws++,1,{maxBytes}));
  }
  for(const duration of [0,-1,60.001,NaN,Infinity,'2']){
    assert.throws(()=>exportFilm(h.canvas,()=>draws++,duration));
  }
  assert.equal(draws,0);assert.equal(h.counters.captures,0);
});

test('default hard32MiB cap rejects oversized encoder delivery and leaves handlers detached',async t=>{
  const h=harness(t);
  const pending=exportFilm(h.canvas,()=>{},1);
  // No large test allocation is necessary: a controlled encoder event supplies size metadata.
  h.recorder.ondataavailable({data:{size:CAP+1}});
  await assert.rejects(pending,/32 MiB|size|limit|bytes/i);
  assert.equal(h.counters.recorderStops,1);
  assert.equal(h.counters.tracks,1);
  assert.equal(h.recorder.ondataavailable,null);
  assert.equal(h.recorder.onstop,null);
  assert.equal(h.recorder.onerror,null);
});

test('cancelled or paused recording ignores saved late handlers and cannot publish a Blob',async t=>{
  const h=harness(t);const controller=new AbortController();
  const pending=exportFilm(h.canvas,()=>{},1,{signal:controller.signal});
  const lateData=h.recorder.ondataavailable,lateStop=h.recorder.onstop;
  h.recorder.state='paused';
  controller.abort();
  await assert.rejects(pending,/cancelled/);
  let touched=0;
  lateData({get data(){touched++;throw Error('Late payload must not be inspected');}});
  lateStop();
  assert.equal(touched,0);
  assert.equal(h.counters.recorderStops,1);
  assert.equal(h.counters.tracks,1);
});

test('abort during first drawing refuses capture, and abort during capture stops returned tracks before encoding',async t=>{
  const first=harness(t);const firstAbort=new AbortController();
  await assert.rejects(exportFilm(first.canvas,()=>firstAbort.abort(),1,{signal:firstAbort.signal}),/cancelled/);
  assert.equal(first.counters.captures,0);
  const controller=new AbortController();const h=harness(t,{capture:()=>controller.abort()});
  await assert.rejects(exportFilm(h.canvas,()=>{},1,{signal:controller.signal}),/cancelled/);
  assert.equal(h.counters.tracks,1);
  assert.equal(h.counters.starts,0);
});

test('constructor failure and poststart draw failure always stop owned tracks',async t=>{
  const h=harness(t,{construct:()=>{throw Error('Constructor failed');}});
  await assert.rejects(exportFilm(h.canvas,()=>{},1),/Constructor failed/);
  assert.equal(h.counters.tracks,1);
  let tick;
  const next=harness(t);
  replace(t,'requestAnimationFrame',callback=>{tick=callback;return 1;});
  let draws=0;
  const pending=exportFilm(next.canvas,()=>{if(++draws>1)throw Error('Drawing failed');},1);
  tick(performance.now()+10);
  await assert.rejects(pending,/Drawing failed/);
  assert.equal(next.counters.tracks,1);
  assert.equal(next.counters.recorderStops,1);
});
