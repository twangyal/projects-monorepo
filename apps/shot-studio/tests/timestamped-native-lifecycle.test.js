import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeExportBackend,createBoundedVideoSink} from '../src/timestamped-export.js';
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
