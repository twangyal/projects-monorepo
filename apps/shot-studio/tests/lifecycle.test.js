import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFilm} from '../src/export.js';
import {enterXR} from '../src/xr.js';

function replace(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}

test('video constructor failure stops capture tracks and rejects without hanging',async t=>{
  let stops=0;
  replace(t,'cancelAnimationFrame',()=>{});
  class Recorder{static isTypeSupported(){return true;}constructor(){throw Error('encoder broke');}}
  replace(t,'MediaRecorder',Recorder);
  const canvas={captureStream:()=>({getTracks:()=>[{stop:()=>stops++}]})};
  await assert.rejects(exportFilm(canvas,()=>{},2),/encoder broke/);assert.equal(stops,1);
});
test('export cancellation stops the recorder, tracks and scheduled frame',async t=>{
  let stops=0,frames=0,recorderStops=0;
  replace(t,'cancelAnimationFrame',()=>frames++);
  replace(t,'requestAnimationFrame',()=>1);
  class Recorder{static isTypeSupported(){return true;}state='inactive';start(){this.state='recording';}stop(){recorderStops++;this.state='inactive';this.onstop();}}
  replace(t,'MediaRecorder',Recorder);
  const canvas={captureStream:()=>({getTracks:()=>[{stop:()=>stops++}]})},controller=new AbortController();
  const result=exportFilm(canvas,()=>{},2,{signal:controller.signal});controller.abort();
  await assert.rejects(result,/cancelled/);assert.equal(stops,1);assert.equal(recorderStops,1);assert.equal(frames,1);
});
test('unavailable WebXR rejects before requesting any session',async t=>{
  let requests=0;
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:async()=>false,requestSession:()=>requests++}});
  await assert.rejects(enterXR({},()=>{},()=>{},()=>{},()=>{}),/compatible headset/);
  assert.equal(requests,0);
});
test('XR setup failure ends the accepted session and restores desktop once',async t=>{
  let ended=0,restored=0;
  const session={addEventListener(){},async end(){ended++;}};
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:async()=>true,requestSession:async()=>session}});
  await assert.rejects(enterXR({gl:{makeXRCompatible:async()=>{throw Error('compatibility failed');}}},()=>{},()=>{},()=>{},()=>restored++),/compatibility failed/);
  assert.equal(ended,1);assert.equal(restored,1);
});
