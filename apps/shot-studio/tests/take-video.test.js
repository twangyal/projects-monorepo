import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTakeVideo} from '../src/take-video.js';

const size=value=>value<127?[0x80|value]:[0x40|(value>>8),value&255];
const leaf=(id,payload)=>[...id,...size(payload.length),...payload];
const doc=leaf([0x42,0x82],[119,101,98,109]);
const webm=(children=doc)=>new Blob([Uint8Array.from([0x1a,0x45,0xdf,0xa3,...size(children.length),...children])],{type:'video/webm'});
function replace(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
function harness(t,{auto=true,width=960,height=540}={}){
  const videos=[],revoked=[],urls=[];
  let timer;
  replace(t,'setTimeout',callback=>{timer=callback;return 123;});
  replace(t,'clearTimeout',()=>{});
  replace(t,'URL',{createObjectURL:()=>{const url=`blob:owned-${urls.length}`;urls.push(url);return url;},revokeObjectURL:url=>revoked.push(url)});
  replace(t,'document',{createElement:tag=>{
    assert.equal(tag,'video');
    const handlers=new Map(),saved=[];
    const video={videoWidth:width,videoHeight:height,readyState:2,duration:Infinity,loads:0,paused:0,removed:[],
      addEventListener(name,callback){handlers.set(name,callback);saved.push(callback);},
      removeEventListener(name,callback){if(handlers.get(name)===callback)handlers.delete(name);},
      pause(){this.paused++;},removeAttribute(name){this.removed.push(name);},
      load(){this.loads++;if(auto&&this.loads===1)queueMicrotask(()=>{handlers.get('loadedmetadata')?.();handlers.get('loadeddata')?.();});},
      emit(name){handlers.get(name)?.();},handlers,saved};
    videos.push(video);return video;
  }});
  return {videos,revoked,urls,expire:()=>timer()};
}
async function started(h,pending){pending.catch(()=>{});for(let n=0;n<10&&!h.videos.length;n++)await new Promise(setImmediate);assert.equal(h.videos.length,1);return h.videos[0];}

// Native decoding itself is independently checked in the browser; these controlled
// events pin admission, ownership and cleanup without pretending to decode a stream.
test('boundedWebM header and controlled firstframe admit exact shape even with Infinity duration',async t=>{
  const h=harness(t);
  const blob=webm();
  assert.deepEqual(await inspectTakeVideo(blob),{mime:'video/webm',bytes:blob.size,width:960,height:540});
  assert.equal(h.urls.length,1);assert.deepEqual(h.revoked,h.urls);
  assert.equal(h.videos[0].handlers.size,0);assert.ok(h.videos[0].removed.includes('src'));
  assert.equal(h.videos[0].loads,2);
});

test('invalidbytes MIME signature DocType and truncated or overdeep header reject before nativeURL',async t=>{
  const h=harness(t);
  const invalid=[new Blob([],{type:'video/webm'}),new Blob([new Uint8Array(32*1024*1024+1)],{type:'video/webm'}),
    new Blob([await webm().arrayBuffer()],{type:'video/mp4'}),new Blob([await webm().arrayBuffer()],{type:'video/webm;codecs=av1'}),
    new Blob([Uint8Array.from([0,0,0,0])],{type:'video/webm'}),webm(leaf([0x42,0x82],[109,97,116,114,111,115,107,97])),
    webm([]),webm([...doc,...doc]),webm([...doc,0xec,0xff]),webm([...doc,0xec,0x85,0]),
    webm([...doc,0x1a,0x45,0xdf,0xa3,0x80]),webm([...doc,0])];
  for(const blob of invalid)await assert.rejects(inspectTakeVideo(blob),error=>['invalid','limit','unsupported'].includes(error.code));
  assert.equal(h.urls.length,0);
});

test('unknown bounded headerleaf skips without searching its payload for a fake DocType',async t=>{
  const h=harness(t);
  const extras=leaf([0xec],[...doc]);
  const blob=webm([...extras,...doc]);
  assert.equal((await inspectTakeVideo(blob)).bytes,blob.size);
  await assert.rejects(inspectTakeVideo(webm(extras)),error=>error.code==='invalid');
  assert.equal(h.urls.length,1);
});

test('actualdimensions and decodeerrors refuse and always releaseURL and native listeners',async t=>{
  const bad=harness(t,{width:1920,height:1080});
  await assert.rejects(inspectTakeVideo(webm()),error=>error.code==='unsupported');
  assert.deepEqual(bad.revoked,bad.urls);
  const h=harness(t,{auto:false});
  const pending=inspectTakeVideo(webm());const video=await started(h,pending);
  video.emit('error');
  await assert.rejects(pending,error=>error.code==='invalid');
  assert.equal(video.handlers.size,0);assert.deepEqual(h.revoked,h.urls);
});

test('preabort and abortduring nativeprobe reject without latepublication and reclaim every resource',async t=>{
  const h=harness(t,{auto:false});const controller=new AbortController();controller.abort();
  await assert.rejects(inspectTakeVideo(webm(),{signal:controller.signal}),error=>error.code==='cancelled');
  assert.equal(h.urls.length,0);
  const next=new AbortController();const pending=inspectTakeVideo(webm(),{signal:next.signal});
  const video=await started(h,pending);next.abort();
  await assert.rejects(pending,error=>error.code==='cancelled');
  assert.deepEqual(h.revoked,h.urls);assert.equal(video.handlers.size,0);
  for(const callback of video.saved)callback();
  assert.equal(h.revoked.length,1);
});

test('probe deadline owns the attempt, freesURL, and ignores all later decoded events',async t=>{
  const h=harness(t,{auto:false});
  const pending=inspectTakeVideo(webm());const video=await started(h,pending);
  h.expire();
  await assert.rejects(pending,error=>error.code==='timeout');
  for(const callback of video.saved)callback();
  assert.deepEqual(h.revoked,h.urls);assert.equal(video.handlers.size,0);
});


test('exact4KiB header and64 elements admit, while each next boundary refuses',async t=>{
  const h=harness(t);
  const elements=[...doc,...Array.from({length:62},()=>[0xec,0x80]).flat()];
  assert.ok((await inspectTakeVideo(webm(elements))).bytes>0);
  await assert.rejects(inspectTakeVideo(webm([...elements,0xec,0x80])),error=>error.code==='limit');
  const exact=webm([...doc,...leaf([0xec],new Array(4080).fill(0))]);
  assert.equal(exact.size,4096);
  assert.equal((await inspectTakeVideo(exact)).bytes,4096);
  await assert.rejects(inspectTakeVideo(webm([...doc,...leaf([0xec],new Array(4081).fill(0))])),error=>error.code==='limit');
  assert.equal(h.urls.length,2);
});

test('aborted boundedheader read cannot create a late nativeURL',async t=>{
  const h=harness(t,{auto:false});
  const old=Object.getOwnPropertyDescriptor(Blob.prototype,'arrayBuffer');
  let finish;
  Object.defineProperty(Blob.prototype,'arrayBuffer',{configurable:true,value:()=>new Promise(resolve=>finish=resolve)});
  t.after(()=>Object.defineProperty(Blob.prototype,'arrayBuffer',old));
  const controller=new AbortController();const pending=inspectTakeVideo(webm(),{signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,error=>error.code==='cancelled');
  finish(Uint8Array.from([0x1a,0x45,0xdf,0xa3,0x87,...doc]).buffer);
  await new Promise(setImmediate);
  assert.equal(h.urls.length,0);assert.equal(h.videos.length,0);
});
