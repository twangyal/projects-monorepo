import test from 'node:test';
import assert from 'node:assert/strict';
import * as trace from '../scripts/media-trace-diagnostics.mjs';
import {EventEmitter} from 'node:events';
const event=(patch={})=>({name:'vpx_codec_encode',cat:'media',ph:'X',dur:1000,tdur:200,pid:23,tid:24,args:{secret:'never retained'},...patch});
test('native event buckets retain independent wall and available thread time without inventing missing CPU',()=>{
 assert.equal(typeof trace.createMediaTrace,'function');const c=trace.createMediaTrace();
 c.add([event(),event({dur:2000,tdur:undefined}),event({dur:500,tdur:-1})]);const r=c.finish();
 assert.equal(r.status,'measured');assert.deepEqual(r.buckets.vpx_codec_encode,{events:3,wallMs:3.5,maxWallMs:2,threadCpuMs:.2,threadCpuEvents:1,missingThreadCpuEvents:1,invalidThreadCpuEvents:1});assert.equal(r.complete,false);
 assert.doesNotMatch(JSON.stringify(r),/secret|"pid"|"tid"|args/);
});
test('only known native media GPU complete events contribute; unknown payloads and invalid durations never leak',()=>{
 assert.equal(typeof trace.createMediaTrace,'function');const c=trace.createMediaTrace();c.add([event({name:'https://secret.invalid'}),event({cat:'blink.user_timing'}),event({ph:'B'}),event({dur:Infinity}),event({tdur:undefined})]);const r=c.finish();
 assert.equal(r.buckets.vpx_codec_encode.events,1);assert.equal(r.buckets.vpx_codec_encode.threadCpuMs,null);assert.equal(r.invalidEvents,1);assert.equal(r.complete,false);assert.doesNotMatch(JSON.stringify(r),/secret|Infinity|pid|tid/);
});
test('native trace loss or event capacity marks the observation partial instead of silently declaring complete coverage',()=>{
 assert.equal(typeof trace.createMediaTrace,'function');const c=trace.createMediaTrace();c.add(Array.from({length:100001},()=>event()));const r=c.finish({dataLossOccurred:true});
 assert.equal(r.observedEvents,100000);assert.equal(r.eventLimitReached,true);assert.equal(r.dataLossOccurred,true);assert.equal(r.complete,false);assert.equal(r.buckets.vpx_codec_encode.events,100000);
});
test('finite native values whose totals overflow refuse a measured receipt',()=>{
 assert.equal(typeof trace.createMediaTrace,'function');const c=trace.createMediaTrace();c.add([event({dur:1.2e308}),event({dur:1.2e308})]);const r=c.finish();assert.equal(r.status,'unavailable');assert.equal(r.buckets,undefined);assert.doesNotMatch(JSON.stringify(r),/Infinity|NaN/);
});
test('owned protocol trace ends once and sanitizes native events before detaching',async()=>{
 assert.equal(typeof trace.startMediaTrace,'function');const session=new EventEmitter();let ends=0,detaches=0;
 session.send=async(method,options)=>{if(method==='Tracing.start'){assert(options.traceConfig.traceBufferSizeInKb>0&&options.traceConfig.traceBufferSizeInKb<=4096);assert.deepEqual(options.traceConfig.includedCategories,['media']);}else if(method==='Tracing.end'){ends++;session.emit('Tracing.dataCollected',{value:[event()]});session.emit('Tracing.tracingComplete',{dataLossOccurred:false});}return{};};session.detach=async()=>{detaches++;};
 const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const first=c.finish();assert.equal(c.finish(),first);const r=await first;assert.equal(r.buckets.vpx_codec_encode.threadCpuMs,.2);assert.equal(r.complete,true);assert.equal(ends,1);assert.equal(detaches,1);assert.equal(session.listenerCount('Tracing.dataCollected'),0);
});
test('refused trace admission cannot end another owner trace or expose provider errors',async()=>{
 assert.equal(typeof trace.startMediaTrace,'function');const session=new EventEmitter();let ends=0,detaches=0;session.send=async(method)=>{if(method==='Tracing.start')throw Error('secret existing trace');ends++;};session.detach=async()=>{detaches++;};
 const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const r=await c.finish();assert.equal(r.status,'unavailable');assert.equal(ends,0);assert.equal(detaches,1);assert.doesNotMatch(JSON.stringify(r),/secret|existing/);
});
test('independent positive native thread clocks are retained even above event wall time',()=>{
 const c=trace.createMediaTrace();c.add([event({dur:10,tdur:12})]);const r=c.finish();assert.equal(r.buckets.vpx_codec_encode.wallMs,.01);assert.equal(r.buckets.vpx_codec_encode.threadCpuMs,.012);assert.equal(r.complete,true);
});
test('permanently stalled start retires its owned session and listeners without ending another trace',async()=>{
 const session=new EventEmitter();let ends=0,detaches=0;session.send=method=>method==='Tracing.start'?new Promise(()=>{}):Promise.resolve(ends++);session.detach=async()=>{detaches++;};
 const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const r=await c.finish();assert.equal(r.status,'unavailable');assert.equal(detaches,1);assert.equal(ends,0);assert.equal(session.listenerCount('Tracing.dataCollected'),0);
});
test('late session admission is detached after the unavailable receipt',async()=>{
 let admit,detaches=0;const session=new EventEmitter();session.detach=async()=>{detaches++;};const c=await trace.startMediaTrace({newBrowserCDPSession:()=>new Promise(resolve=>{admit=resolve;})});assert.equal((await c.finish()).status,'unavailable');admit(session);await new Promise(resolve=>setImmediate(resolve));assert.equal(detaches,1);
});
test('completion timeout retires once and repeat finish preserves the unavailable result',async()=>{
 const session=new EventEmitter();let detaches=0;session.send=async()=>({});session.detach=async()=>{detaches++;};const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const first=c.finish();assert.equal(c.finish(),first);assert.equal((await first).status,'unavailable');assert.equal(detaches,1);assert.equal(session.eventNames().length,0);
});
test('buffer fullness discloses partial coverage and malformed batches refuse measured results',async()=>{
 for(const malformed of [false,true]){
  const session=new EventEmitter();session.send=async method=>{if(method==='Tracing.end'){session.emit('Tracing.bufferUsage',{percentFull:.98});session.emit('Tracing.dataCollected',{value:malformed?null:[event()]});session.emit('Tracing.tracingComplete',{dataLossOccurred:false});}};session.detach=async()=>{};const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const r=await c.finish();assert.equal(r.status,malformed?'unavailable':'measured');if(!malformed){assert.equal(r.bufferFull,true);assert.equal(r.complete,false);}
 }
});
test('failed end and detach do not expose errors or prevent observer retirement',async()=>{
 const session=new EventEmitter();session.send=async method=>{if(method==='Tracing.end')throw Error('secret provider');};session.detach=async()=>{throw Error('secret detach');};const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const r=await c.finish();assert.equal(r.status,'unavailable');assert.equal(session.eventNames().length,0);assert.doesNotMatch(JSON.stringify(r),/secret|provider/);
});
test('late start settlement after retirement never ends a trace or detaches twice',async()=>{
 for(const reject of [false,true]){
  const session=new EventEmitter();let settle,ends=0,detaches=0;session.send=method=>method==='Tracing.start'?new Promise((resolve,fail)=>{settle=reject?fail:resolve;}):Promise.resolve(ends++);session.detach=async()=>{detaches++;};const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});assert.equal((await c.finish()).status,'unavailable');settle(reject?Error('secret late refusal'):{});await new Promise(resolve=>setImmediate(resolve));assert.equal(ends,0);assert.equal(detaches,1);assert.equal(session.eventNames().length,0);
 }
});
test('permanently stalled end and detach remain bounded and retire listeners',async()=>{
 const session=new EventEmitter();let detaches=0;session.send=method=>method==='Tracing.end'?new Promise(()=>{}):Promise.resolve({});session.detach=()=>{detaches++;return new Promise(()=>{});};const c=await trace.startMediaTrace({newBrowserCDPSession:async()=>session});const result=c.finish();assert.equal(c.finish(),result);assert.equal((await result).status,'unavailable');assert.equal(detaches,1);assert.equal(session.eventNames().length,0);
});
