import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeExportBackend,createBoundedVideoSink,createTimestampedExporter} from '../src/timestamped-export.js';
function replace(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
test('cancellation drains late native encoder initialization before releasing output ownership',async t=>{
 let release,requested=false;const gate=new Promise(r=>release=r),encoders=[];
 class Frame{
  constructor(){this.format='RGBA';this.codedWidth=64;this.codedHeight=64;this.displayWidth=64;this.displayHeight=64;this.visibleRect={x:0,y:0,width:64,height:64};this.timestamp=0;this.duration=33333;this.colorSpace={};}
  close(){this.closed=true;}clone(){return new Frame();}
 }
 class Encoder{
  static async isConfigSupported(config){requested=true;await gate;return{supported:true,config};}
  constructor(){this.state='unconfigured';this.encodeQueueSize=0;encoders.push(this);}
  configure(){this.state='configured';}close(){this.state='closed';}encode(){}addEventListener(){}removeEventListener(){}
 }
 replace(t,'VideoFrame',Frame);replace(t,'VideoEncoder',Encoder);
 const sink=createBoundedVideoSink(1024*1024,()=>{}),native=nativeExportBackend.create(sink,'vp9',null);await native.start();
 const sample=native.video({}, {timestamp:0,duration:33333}),add=native.addVideo(sample);
 await Promise.resolve();assert.equal(requested,true);
 const closing=native.cancel();await Promise.resolve();release();await Promise.allSettled([closing,add]);sample.close();
 assert.equal(encoders.length,1);assert.ok(encoders.every(x=>x.state==='closed'),'a native encoder initialized after cancellation and remained owned');
});
test('failed audiovisual finalization still drains the sibling native flush',async t=>{
 let release,flushing=false,settled=false;const gate=new Promise(r=>release=r),encoders=[];
 class Frame{
  constructor(){Object.assign(this,{format:'RGBA',codedWidth:64,codedHeight:64,displayWidth:64,displayHeight:64,visibleRect:{x:0,y:0,width:64,height:64},timestamp:0,duration:33333,colorSpace:{}});}
  close(){}clone(){return new Frame();}
 }
 class Audio{constructor(init){Object.assign(this,init);}close(){}clone(){return new Audio(this);}}
 class Encoder{
  static async isConfigSupported(config){return{supported:true,config};}
  constructor(){this.state='unconfigured';this.encodeQueueSize=0;encoders.push(this);}
  configure(){this.state='configured';}close(){this.state='closed';}encode(){}addEventListener(){}removeEventListener(){}
  async flush(){flushing=true;await gate;}
 }
 class AudioEncoder extends Encoder{async flush(){throw Error('audio flush failed');}}
 replace(t,'VideoFrame',Frame);replace(t,'VideoEncoder',Encoder);replace(t,'AudioData',Audio);replace(t,'AudioEncoder',AudioEncoder);t.after(()=>release());
 const native=nativeExportBackend.create(createBoundedVideoSink(1024*1024,()=>{}),'vp9',{});await native.start();
 const video=native.video({}, {timestamp:0,duration:33333});await native.addVideo(video);video.close();
 const audio=native.audio({numberOfChannels:1,numberOfFrames:960,sampleRate:48000,timestamp:0,data:new Float32Array(960)});await native.addAudio(audio);audio.close();
 const finalizing=assert.rejects(native.finalize(),/audio flush failed/).finally(()=>settled=true);
 while(!flushing)await new Promise(r=>setTimeout(r,0));
 await new Promise(r=>setTimeout(r,10));const releasedEarly=settled;release();await finalizing;await native.cancel();
 assert.equal(releasedEarly,false,'a failed source abandoned its still-flushing sibling');
 assert.equal(encoders.length,2);assert.ok(encoders.every(e=>e.state==='closed'));
});
test('cancellation keeps ownership until the native finalization flush drains',async t=>{
 let release,flushing=false,settled=false;const gate=new Promise(r=>release=r),encoders=[];
 class Frame{
  constructor(){Object.assign(this,{format:'RGBA',codedWidth:64,codedHeight:64,displayWidth:64,displayHeight:64,visibleRect:{x:0,y:0,width:64,height:64},timestamp:0,duration:33333,colorSpace:{}});}
  close(){}clone(){return new Frame();}
 }
 class Encoder{
  static async isConfigSupported(config){return{supported:true,config};}
  constructor(){this.state='unconfigured';this.encodeQueueSize=0;encoders.push(this);}
  configure(){this.state='configured';}close(){this.state='closed';}encode(){}addEventListener(){}removeEventListener(){}
  async flush(){flushing=true;await gate;}
 }
 replace(t,'VideoFrame',Frame);replace(t,'VideoEncoder',Encoder);t.after(()=>release());
 const controller=new AbortController();
 const pending=createTimestampedExporter(nativeExportBackend)({width:64,height:64},()=>{},.01,{signal:controller.signal});
 const rejection=assert.rejects(pending,/cancelled/i).finally(()=>settled=true);
 while(!flushing)await new Promise(r=>setTimeout(r,0));
 controller.abort();await new Promise(r=>setTimeout(r,10));
 const releasedEarly=settled;release();await rejection;
 assert.equal(releasedEarly,false,'export released ownership while a native flush remained active');
 assert.equal(encoders.length,1);assert.ok(encoders.every(e=>e.state==='closed'));
});
