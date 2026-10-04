import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFilm} from '../src/export.js';
import {enterXR} from '../src/xr.js';

test('VR cancelled during support probing never requests a session',async t=>{
  let allowSupport,requests=0;
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:()=>new Promise(resolve=>allowSupport=resolve),requestSession:()=>{requests++;throw Error('unexpected request');}}});
  const controller=new AbortController();
  const pending=enterXR({},()=>{},()=>{},()=>{},()=>{},{signal:controller.signal});
  controller.abort();allowSupport(true);
  await assert.rejects(pending,/cancelled/);assert.equal(requests,0);
});
test('a session accepted after cancellation is ended without setting up graphics',async t=>{
  let accept,ended=0,restored=0,compatible=0,endHandler;
  const session={addEventListener(name,fn){if(name==='end')endHandler=fn;},async end(){ended++;endHandler?.();},
    updateRenderState(){},requestReferenceSpace:async()=>({}),requestAnimationFrame(){}};
  replace(t,'XRWebGLLayer',class{});
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:async()=>true,requestSession:()=>new Promise(resolve=>accept=resolve)}});
  const controller=new AbortController();
  const pending=enterXR({gl:{makeXRCompatible:async()=>compatible++}},()=>{},()=>{},()=>{},()=>restored++,{signal:controller.signal});
  await Promise.resolve();controller.abort();accept(session);
  await assert.rejects(pending,/cancelled/);
  assert.equal(ended,1);assert.equal(restored,1);assert.equal(compatible,0);
});
test('cancelling async graphics setup ends VR immediately and schedules no views',async t=>{
  let finishGraphics,endHandler,ended=0,restored=0,scheduled=0;
  const session={addEventListener(name,fn){if(name==='end')endHandler=fn;},async end(){ended++;endHandler();},
    updateRenderState(){},requestReferenceSpace:async()=>({}),requestAnimationFrame(){scheduled++;}};
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:async()=>true,requestSession:async()=>session}});
  const controller=new AbortController();
  const pending=enterXR({gl:{makeXRCompatible:()=>new Promise(resolve=>finishGraphics=resolve)}},()=>{},()=>{},()=>{},()=>restored++,{signal:controller.signal});
  await Promise.resolve();await Promise.resolve();controller.abort();
  assert.equal(ended,1);finishGraphics();
  await assert.rejects(pending,/cancelled/);
  assert.equal(ended,1);assert.equal(restored,1);assert.equal(scheduled,0);
});

function replace(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}

test('controller squeeze captures tracked headset camera and ignores ended sessions',async t=>{
  const handlers={},captures=[],errors=[];
  const session={addEventListener(name,fn){handlers[name]=fn;},async end(){handlers.end();},
    updateRenderState(){},requestReferenceSpace:async()=>({}),requestAnimationFrame(){}};
  replace(t,'isSecureContext',true);replace(t,'XRWebGLLayer',class{});
  replace(t,'navigator',{xr:{isSessionSupported:async()=>true,requestSession:async()=>session}});
  await enterXR({gl:{makeXRCompatible:async()=>{}}},()=>{},()=>0,()=>{},()=>{},
    {onCamera:c=>captures.push(c),onCameraError:e=>errors.push(e)});
  assert.equal(typeof handlers.squeeze,'function');
  handlers.squeeze({frame:{getViewerPose:()=>{throw Error('Event frames cannot read viewer poses');},getPose:()=>null}});assert.equal(captures.length,0);assert.match(errors[0],/tracking/i);
  const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,1,2,5,1];
  const event={frame:{getViewerPose:()=>{throw Error('Event frames cannot read viewer poses');},getPose:()=>({transform:{matrix}})}};
  handlers.squeeze(event);assert.deepEqual(captures,[{eye:[1,2,5],target:[1,2,2]}]);
  matrix[12]=99;handlers.squeeze(event);assert.equal(captures.length,1);assert.equal(errors.length,2);
  await session.end();matrix[12]=1;handlers.squeeze(event);assert.equal(captures.length,1);
});

test('video constructor failure stops capture tracks and rejects without hanging',async t=>{
  let stops=0;
  replace(t,'cancelAnimationFrame',()=>{});
  class Recorder{static isTypeSupported(){return true;}constructor(){throw Error('encoder broke');}}
  replace(t,'MediaRecorder',Recorder);
  const canvas={captureStream:()=>{const track={stop:()=>stops++,requestFrame(){}};return{getTracks:()=>[track],getVideoTracks:()=>[track]};}};
  await assert.rejects(exportFilm(canvas,()=>{},2),/encoder broke/);assert.equal(stops,1);
});
test('export cancellation stops the recorder, tracks and scheduled frame',async t=>{
  let stops=0,frames=0,recorderStops=0;
  replace(t,'cancelAnimationFrame',()=>frames++);
  replace(t,'requestAnimationFrame',()=>1);
  class Recorder{static isTypeSupported(){return true;}state='inactive';start(){this.state='recording';}stop(){recorderStops++;this.state='inactive';this.onstop();}}
  replace(t,'MediaRecorder',Recorder);
  const canvas={captureStream:()=>{const track={stop:()=>stops++,requestFrame(){}};return{getTracks:()=>[track],getVideoTracks:()=>[track]};}},controller=new AbortController();
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
test('an XR session ended during async setup never returns an active session',async t=>{
  let endHandler,restored=0,scheduled=0;
  const session={addEventListener(name,fn){if(name==='end')endHandler=fn;},async end(){endHandler();},
    updateRenderState(){},requestReferenceSpace:async()=>({}),requestAnimationFrame(){scheduled++;}};
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:async()=>true,requestSession:async()=>session}});
  replace(t,'XRWebGLLayer',class{});
  await assert.rejects(enterXR({gl:{makeXRCompatible:async()=>{endHandler();}}},()=>{},()=>{},()=>{},()=>restored++),/ended/);
  assert.equal(restored,1);assert.equal(scheduled,0);
});
test('tracked VR views animate performers and show controller floor placement',async t=>{
  let draw,select;const scenes=[],places=[];
  const session={addEventListener(name,fn){if(name==='select')select=fn;},async end(){},
    inputSources:[{targetRaySpace:{}}],renderState:{},updateRenderState(state){this.renderState=state;},
    requestReferenceSpace:async()=>({}),requestAnimationFrame(fn){draw=fn;}};
  replace(t,'isSecureContext',true);
  replace(t,'navigator',{xr:{isSessionSupported:async()=>true,requestSession:async()=>session}});
  replace(t,'XRWebGLLayer',class{framebuffer={};getViewport(){return {x:0,y:0,width:100,height:100};}});
  const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const ray=[...I];ray[9]=1;ray[13]=2;
  const frame={getViewerPose:()=>({views:[{projectionMatrix:I,transform:{inverse:{matrix:I}}}]}),getPose:()=>({transform:{matrix:ray}})};
  const gl={makeXRCompatible:async()=>{},bindFramebuffer(){},clear(){},viewport(){}};
  await enterXR({gl,scene(...args){scenes.push(args);}},()=>({title:'film'}),()=>2,p=>places.push(p),()=>{});
  draw(1000,frame);draw(2000,frame);
  assert.equal(scenes[1][1]-scenes[0][1],1);assert.deepEqual(scenes[0][3],[0,-2]);
  select({frame,inputSource:session.inputSources[0]});assert.deepEqual(places,[[0,-2]]);
});
