import test from 'node:test';
import assert from 'node:assert/strict';
import * as current from '../src/export.js';

// Native codecs need a browser. This backend deliberately controls only their
// asynchronous boundary; the actual timeline, sink and lifecycle driver run.
function backend({hold=false,writeBytes=4,unsupported=false}={}){
 const events=[],samples=[];let release;
 const gate=hold?new Promise(r=>release=r):Promise.resolve();
 return {events,samples,release:()=>release?.(),
  async probe(){events.push('probe');return unsupported?null:'vp9';},
  create(sink){events.push('create');return {
   async start(){events.push('start');},
   video(canvas,frame){const sample={frame,closed:false,close(){this.closed=true;}};samples.push(sample);return sample;},
   audio(block){const sample={block,closed:false,close(){this.closed=true;}};samples.push(sample);return sample;},
   async addVideo(sample){events.push(['video',sample.frame.timestamp]);await gate;},
   async addAudio(sample){events.push(['audio',sample.block.timestamp]);},
   async finalize(){events.push('finalize');sink.write({position:0,data:new Uint8Array(writeBytes).fill(65)});},
   async cancel(){events.push('cancel');release?.();},
  };},
 };
}
function factory(b){assert.equal(typeof current.createTimestampedExporter,'function','timestamped driver is not yet implemented');return current.createTimestampedExporter(b);}

test('authored video times survive a scheduling stall with all native samples closed',async()=>{
 const b=backend({hold:true}),draws=[],run=factory(b),pending=run({width:64,height:64},t=>draws.push(t),.1);
 await new Promise(r=>setTimeout(r,20));assert.deepEqual(draws,[0]);b.release();
 const blob=await pending;assert.equal(await blob.text(),'AAAA');assert.deepEqual(draws,[0,1/30,2/30]);
 assert.deepEqual(b.samples.map(x=>x.frame.timestamp),[0,33333,66667]);assert.ok(b.samples.every(x=>x.closed));
});
test('abort during backpressure drains the encoder before refusing all late publication',async()=>{
 const b=backend({hold:true}),controller=new AbortController(),run=factory(b),draws=[];
 const pending=run({width:64,height:64},t=>draws.push(t),1,{signal:controller.signal});
 await new Promise(r=>setTimeout(r,10));controller.abort();await assert.rejects(pending,/cancelled/);
 assert.deepEqual(draws,[0]);assert.equal(b.events.filter(x=>x==='cancel').length,1);assert.ok(b.samples.every(x=>x.closed));assert.ok(!b.events.includes('finalize'));
});
test('exact byte limit admits and one more byte refuses before retaining output',async()=>{
 for(const bytes of [4,5]){const b=backend({writeBytes:bytes}),run=factory(b),promise=run({width:64,height:64},()=>{},.1,{maxBytes:4});
 if(bytes===4)assert.equal((await promise).size,4);else{await assert.rejects(promise,/byte limit/);assert.ok(b.events.includes('cancel'));}}
});
test('invalid durations and byte limits refuse before probing or drawing',()=>{
 const b=backend(),run=factory(b);for(const duration of [0,-1,60.01,NaN,Infinity,'1'])assert.throws(()=>run({},()=>{},duration));
 for(const maxBytes of [0,-1,1.5,32*1024*1024+1,null,'4'])assert.throws(()=>run({},()=>{},1,{maxBytes}));assert.deepEqual(b.events,[]);
});
test('unsupported native format fails before drawing or constructing a muxer',async()=>{
 const b=backend({unsupported:true}),run=factory(b);await assert.rejects(run({width:64,height:64},()=>assert.fail('draw'),1),/encode/);assert.deepEqual(b.events,['probe']);
});
test('draw errors close owned encoders and preserve the original error',async()=>{
 const b=backend(),run=factory(b);await assert.rejects(run({width:64,height:64},()=>{throw Error('original draw error');},1),/original draw error/);assert.ok(b.events.includes('cancel'));assert.equal(b.samples.length,0);
});
test('an abort inside drawing creates no late video sample',async()=>{
 const b=backend(),run=factory(b),controller=new AbortController();await assert.rejects(run({width:64,height:64},()=>controller.abort(),1,{signal:controller.signal}),/cancelled/);assert.equal(b.samples.length,0);
});
test('bounded sink patches earlier container metadata without changing file length',()=>{
 assert.equal(typeof current.createBoundedVideoSink,'function');const sink=current.createBoundedVideoSink(8,()=>{});
 sink.write({position:0,data:new Uint8Array([1,2,3,4])});sink.write({position:1,data:new Uint8Array([9,8])});sink.write({position:6,data:new Uint8Array([7,6])});
 assert.deepEqual([...sink.bytes()],[1,9,8,4,0,0,7,6]);assert.throws(()=>sink.write({position:8,data:new Uint8Array([5])}),/byte limit/);assert.equal(sink.bytes().length,8);
 for(const position of [-1,NaN,Infinity,1.5])assert.throws(()=>sink.write({position,data:new Uint8Array([1])}),/invalid/);
});

test('absolute deadline crossing inside draw refuses native sample construction',async t=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'performance');let now=1000;
 Object.defineProperty(globalThis,'performance',{value:{now:()=>now},configurable:true});t.after(()=>Object.defineProperty(globalThis,'performance',old));
 const b=backend(),run=factory(b);await assert.rejects(run({width:64,height:64},()=>{now=12000;},1),/timed out/);assert.equal(b.samples.length,0);assert.ok(b.events.includes('cancel'));
});
test('already aborted work performs no probe or muxer admission',async()=>{
 const b=backend(),run=factory(b),controller=new AbortController();controller.abort();await assert.rejects(run({width:64,height:64},()=>{},1,{signal:controller.signal}),/cancelled/);assert.deepEqual(b.events,[]);
});
test('a write after retirement checks ownership before reading payload fields',()=>{
 let retired=false,reads=0;assert.equal(typeof current.createBoundedVideoSink,'function');const sink=current.createBoundedVideoSink(8,()=>{if(retired)throw Error('retired');});retired=true;
 assert.throws(()=>sink.write({get position(){reads++;return 0;},get data(){reads++;return new Uint8Array([1]);}}),/retired/);assert.equal(reads,0);
});
