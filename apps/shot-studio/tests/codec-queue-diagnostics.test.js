import test from 'node:test';
import assert from 'node:assert/strict';
import * as diagnostic from '../scripts/stage-timing-diagnostics.mjs';

function nativeBoundary(){
 class Codec extends EventTarget{
  encodeQueueSize=0;closed=false;
  encode(sample,options){assert.equal(sample,'original sample');assert.equal(options,'original options');this.encodeQueueSize++;return 'native result';}
  close(){this.closed=true;return 'closed result';}
 }
 return Codec;
}

test('queue observer measures the real once-listener boundary and preserves callback/argument behavior',()=>{
 assert.equal(typeof diagnostic.instrumentCodecQueues,'function','native queue observation is absent');
 let clock=0;const Codec=nativeBoundary(),originalEncode=Codec.prototype.encode,originalClose=Codec.prototype.close;
 const observer=diagnostic.instrumentCodecQueues({VideoEncoder:Codec},()=>clock),encoder=new Codec();
 assert.equal(encoder.encode('original sample','original options'),'native result');
 let callbacks=0;const callback=function(event){assert.equal(this,encoder);assert.equal(event.type,'dequeue');callbacks++;};
 encoder.addEventListener('dequeue',callback,{once:true});clock=25;
 assert.equal(observer.snapshot().video.pending,1);
 encoder.encodeQueueSize=0;encoder.dispatchEvent(new Event('dequeue'));
 assert.equal(callbacks,1);assert.equal(observer.snapshot().video.waitMs,25);assert.equal(observer.snapshot().video.completed,1);
 assert.equal(encoder.close(),'closed result');observer.stop();
 assert.equal(Codec.prototype.encode,originalEncode);assert.equal(Codec.prototype.close,originalClose);
 assert.equal(Object.hasOwn(Codec.prototype,'addEventListener'),false,'restore inherited listener method');
});

test('queue observer remains bounded, removes only its own listeners, and restores methods on retirement',()=>{
 assert.equal(typeof diagnostic.instrumentCodecQueues,'function','native queue observation is absent');
 const Codec=nativeBoundary(),observer=diagnostic.instrumentCodecQueues({VideoEncoder:Codec},()=>0),encoders=[];
 for(let i=0;i<100;i++){const encoder=new Codec();encoder.encode('original sample','original options');encoder.addEventListener('dequeue',()=>{}, {once:true});encoders.push(encoder);}
 const report=observer.snapshot();assert.equal(report.video.tracked,8);assert.equal(report.video.unobserved,92);assert.equal(report.video.pending,8);
 let called=0;encoders[0].addEventListener('dequeue',()=>called++);
 observer.stop();encoders[0].dispatchEvent(new Event('dequeue'));assert.equal(called,1);assert.equal(observer.snapshot().video.pending,0);
 assert.equal(observer.snapshot().video.completed,0,'retired observer cannot add observations');
});

test('native encode errors are unchanged and retirement respects a later method owner',()=>{
 assert.equal(typeof diagnostic.instrumentCodecQueues,'function');
 const failure=Error('native encode refusal'),Codec=nativeBoundary();Codec.prototype.encode=function(){throw failure;};
 const observer=diagnostic.instrumentCodecQueues({VideoEncoder:Codec},()=>0),encoder=new Codec();
 assert.throws(()=>encoder.encode(),error=>error===failure);assert.equal(observer.snapshot().video.encodeCalls,0);
 const later=function(){return 'later owner';};Codec.prototype.encode=later;observer.stop();assert.equal(Codec.prototype.encode,later);
});
