import test from 'node:test';
import assert from 'node:assert/strict';
import {readMask} from '../src/depth-mask-job.ts';
class ControlledWorker extends EventTarget {
 static latest:ControlledWorker;terminated=0;messages:unknown[]=[];
 constructor(){super();ControlledWorker.latest=this;}
 postMessage(value:unknown){this.messages.push(value);}
 terminate(){this.terminated++;}
 output(data:unknown){this.dispatchEvent(new MessageEvent('message',{data}));}
}
function nativeBoundary(t:test.TestContext){t.mock.method(globalThis,'Worker',ControlledWorker as unknown as typeof Worker);}
// Node has no Worker global; provide this boundary only for this test file.
Object.defineProperty(globalThis,'Worker',{value:ControlledWorker,writable:true,configurable:true});
test('mask worker returns exact unshared pixels and retires once, ignoring later messages',async t=>{
 nativeBoundary(t);const signal=new AbortController().signal,request=readMask(new File(['png'],'m.png',{type:'image/png'}),1,1,signal),worker=ControlledWorker.latest;
 const raster={width:1,height:1,rgba:new Uint8ClampedArray([219,113,77,255])};worker.output(raster);assert.deepEqual(await request,raster);assert.equal(worker.terminated,1);worker.output({error:true});assert.equal(worker.terminated,1);
});
test('abort and unchanged deadline terminate owned read and never admit a late result',async t=>{
 nativeBoundary(t);t.mock.timers.enable({apis:['setTimeout']});for(const reason of ['abort','deadline']){const controller=new AbortController(),request=readMask(new File(['png'],'m.png'),1,1,controller.signal),worker=ControlledWorker.latest;const rejected=assert.rejects(request,reason==='abort'?/canceled/:/timed out/);if(reason==='abort')controller.abort();else t.mock.timers.tick(30000);await rejected;assert.equal(worker.terminated,1);worker.output({width:1,height:1,rgba:new Uint8ClampedArray(4)});assert.equal(worker.terminated,1);}
});
test('rejects wrong worker dimensions, shared pixels, error and unavailable pixels without publication',async t=>{
 nativeBoundary(t);for(const data of [{width:2,height:1,rgba:new Uint8ClampedArray(8)},{width:1,height:1,rgba:new Uint8ClampedArray(new SharedArrayBuffer(4))},{error:true},null]){const request=readMask(new File(['png'],'m.png'),1,1,new AbortController().signal),worker=ControlledWorker.latest;const rejected=assert.rejects(request,/valid static 8-bit PNG/);worker.output(data);await rejected;assert.equal(worker.terminated,1);}
});
test('bad size dimensions and already canceled admission never create a worker',async t=>{
 nativeBoundary(t);const before=ControlledWorker.latest,controller=new AbortController();controller.abort();await assert.rejects(readMask(new File(['png'],'m.png'),1,1,controller.signal),/canceled/);for(const [w,h] of [[0,1],[1281,1],[1,NaN]])await assert.rejects(readMask(new File(['png'],'m.png'),w,h,new AbortController().signal));await assert.rejects(readMask(new File([],'m.png'),1,1,new AbortController().signal));assert.equal(ControlledWorker.latest,before);
});
