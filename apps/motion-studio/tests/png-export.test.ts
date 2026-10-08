import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { getEventListeners } from 'node:events';
import { PNG } from 'pngjs';
import { createProject } from '../src/model.ts';
import { createPngArchive } from '../src/png-archive.ts';
import { exportPngFrames } from '../src/png-export.ts';

class ControlledWorker {
  static instances: ControlledWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  sent: unknown = null; terminated = 0;
  constructor() { ControlledWorker.instances.push(this); }
  postMessage(value: unknown) { this.sent = value; }
  terminate() { this.terminated++; }
  emit(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
}
let descriptors: Map<string, PropertyDescriptor | undefined>;
beforeEach(() => {
  descriptors = new Map(['Worker', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  ControlledWorker.instances = [];
  Object.defineProperty(globalThis, 'Worker', { value: ControlledWorker, configurable: true });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: class {}, configurable: true });
});
afterEach(() => { for (const [key,value] of descriptors) { if (value) Object.defineProperty(globalThis,key,value); else Reflect.deleteProperty(globalThis,key); } });
function output() {
  const project = createProject(); project.frameCount = 12;
  const writer = createPngArchive(project), image = new PNG({ width:640,height:360 }); image.data.fill(255);
  const bytes = PNG.sync.write(image);
  for (let frame=0;frame<12;frame++) writer.addFrame(bytes);
  return { project, bytes: writer.finish() };
}
test('preabort and missing canvas support create no worker', async () => {
  await assert.rejects(exportPngFrames(createProject(),()=>{},AbortSignal.abort()), { name:'AbortError' });
  Object.defineProperty(globalThis,'OffscreenCanvas',{value:undefined,configurable:true});
  await assert.rejects(exportPngFrames(createProject(),()=>{}),/support/i);
  assert.equal(ControlledWorker.instances.length,0);
});
test('complete archive is byte-exact and snapshot title is captured once', async () => {
  const { project,bytes }=output(), values:number[]=[], pending=exportPngFrames(project,value=>values.push(value));
  project.title='Changed after capture';
  const worker=ControlledWorker.instances[0];worker.emit({type:'progress',fraction:.5});worker.emit({type:'complete',buffer:bytes.buffer});
  const blob=await pending;assert.equal(blob.type,'application/zip');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),bytes);assert.deepEqual(values,[0,.5,1]);assert.equal(worker.terminated,1);
});
test('abort detaches handlers/listeners and late output is ignored', async () => {
  const controller=new AbortController(),pending=exportPngFrames(createProject(),()=>{},controller.signal),worker=ControlledWorker.instances[0],late=worker.onmessage!;
  controller.abort();await assert.rejects(pending,{name:'AbortError'});let inspected=false;
  late({ get data(){inspected=true;throw Error('late data');} } as unknown as MessageEvent);
  assert.equal(inspected,false);assert.equal(worker.terminated,1);assert.equal(worker.onmessage,null);assert.equal(getEventListeners(controller.signal,'abort').length,0);
});
test('invalid progress, missing frames, malformed and oversized replies retire the worker', async () => {
  for (const reply of [null,{type:'progress',fraction:NaN},{type:'progress',fraction:-.1},{type:'progress',fraction:1.1},{type:'other'},{type:'complete',buffer:new Uint8Array(2).buffer},{type:'complete',buffer:new ArrayBuffer(96*1024*1024+1)}]) {
    const pending=exportPngFrames(createProject(),()=>{}),worker=ControlledWorker.instances.at(-1)!;worker.emit(reply);await assert.rejects(pending,/invalid/i);assert.equal(worker.terminated,1);
  }
});
test('regressing progress and callback failure refuse output', async () => {
  const pending=exportPngFrames(createProject(),()=>{}),worker=ControlledWorker.instances[0];worker.emit({type:'progress',fraction:.8});worker.emit({type:'progress',fraction:.7});await assert.rejects(pending,/progress/i);
  await assert.rejects(exportPngFrames(createProject(),()=>{throw Error('callback failed');}),/callback failed/);assert.equal(ControlledWorker.instances[1].terminated,1);
});
test('final callback cancellation cannot publish a completed ZIP', async () => {
  const {project,bytes}=output(),controller=new AbortController(),pending=exportPngFrames(project,value=>{if(value===1)controller.abort();},controller.signal);
  ControlledWorker.instances[0].emit({type:'complete',buffer:bytes.buffer});await assert.rejects(pending,{name:'AbortError'});assert.equal(ControlledWorker.instances[0].terminated,1);
});
test('deadline and worker errors retire owned work with bounded messages', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  const pending=exportPngFrames(createProject(),()=>{});context.mock.timers.tick(30000);await assert.rejects(pending,/30 seconds/);assert.equal(ControlledWorker.instances[0].terminated,1);
  const failed=exportPngFrames(createProject(),()=>{});ControlledWorker.instances[1].emit({type:'error',message:'x'.repeat(1000)});await assert.rejects(failed,(error:Error)=>error.message.length===300);
  const broken=exportPngFrames(createProject(),()=>{});ControlledWorker.instances[2].onmessageerror?.();await assert.rejects(broken,/receive/);
  const uncaught=exportPngFrames(createProject(),()=>{});ControlledWorker.instances[3].onerror?.({message:'Encoder failed',preventDefault(){}} as ErrorEvent);await assert.rejects(uncaught,/Encoder failed/);
});
