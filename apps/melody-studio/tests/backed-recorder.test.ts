import test from 'node:test';
import assert from 'node:assert/strict';
import { BackedRecorder, type BackedRecorderDependencies, type BackedRecorderOptions } from '../src/backed-recorder.ts';
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;}); return {promise,resolve}; }
class Track extends EventTarget { muted=false; readyState='live'; stopped=0; stop(){this.stopped++;this.readyState='ended';} }
class GraphNode { disconnected=0; connect(){} disconnect(){this.disconnected++;} }
class Source extends GraphNode { buffer:unknown; starts:number[]=[]; stops:number[]=[]; start(t:number){this.starts.push(t);}stop(t=0){this.stops.push(t);} }
class Worklet extends GraphNode {
  sent:Record<string,unknown>[]=[]; closed=0; onprocessorerror:((event:Event)=>void)|null=null;
  port={onmessage:null as ((event:MessageEvent)=>void)|null,close:()=>{this.closed++;},postMessage:(data:Record<string,unknown>)=>{
    this.sent.push(data);if(data.type==='arm')queueMicrotask(()=>this.emit({...data,type:'armed'}));}};
  emit(data:unknown){this.port.onmessage?.({data} as MessageEvent);}
}
function harness(stage?:'permission'|'module'|'resume') {
  const held=deferred<void>(),track=new Track(),node=new Worklet(),sources:Source[]=[];
  const timers=new Map<number,()=>void>();let timerId=0,clock=1000,resumed=false,permissionCalls=0;let clockSequence:number[]=[];
  const stream={getTracks:()=>[track],getAudioTracks:()=>[track]} as unknown as MediaStream;
  const context=Object.assign(new EventTarget(),{sampleRate:48000,currentTime:1,state:'suspended',destination:new GraphNode(),
    audioWorklet:{addModule:async()=>{if(stage==='module')await held.promise;}},
    resume:async()=>{if(stage==='resume')await held.promise;resumed=true;context.state='running';},
    createMediaStreamSource:()=>new GraphNode(),
    createBuffer:(_channels:number,length:number,sampleRate:number)=>{const samples=new Float32Array(length);return {length,sampleRate,copyToChannel:(data:Float32Array)=>samples.set(data),getChannelData:()=>samples};},
    createBufferSource:()=>{const source=new Source();sources.push(source);return source;}});
  const dependencies:BackedRecorderDependencies={getUserMedia:async()=>{permissionCalls++;if(stage==='permission')await held.promise;return stream;},moduleUrl:async()=>'/original-worklet.js',
    createNode:()=>{queueMicrotask(()=>{assert.ok(resumed);node.emit({type:'ready',sampleRate:48000,channels:2});});return node as unknown as AudioWorkletNode;},
    now:()=>{if(clockSequence.length)clock=clockSequence.shift()!;return clock;},setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>{timers.delete(id as number);}};
  const recorder=new BackedRecorder(dependencies),controller=new AbortController(),backing=new Float32Array(441000);backing[100]=.25;
  const options:BackedRecorderOptions={context:context as unknown as AudioContext,backing,tempo:137,signal:controller.signal,onProgress:()=>{}};
  let failure:unknown,settled=false;
  const start=()=>{const pending=recorder.start(options);void pending.then(()=>{settled=true;},error=>{settled=true;failure=error;});return pending;};
  const armed=async()=>{for(let i=0;i<60&&!node.sent.some(x=>x.type==='arm')&&!settled;i++)await Promise.resolve();if(failure)throw failure;
    assert.ok(node.sent.some(x=>x.type==='arm'),'Actual recorder must arm');for(let i=0;i<10;i++)await Promise.resolve();if(failure)throw failure;
    const arm=node.sent.find(x=>x.type==='arm')!;return {startFrame:arm.startFrame as number,limitFrame:arm.limitFrame as number};};
  return {recorder,controller,options,context,track,node,sources,held,timers,start,armed,permissionCalls:()=>permissionCalls,settled:()=>settled,advanceClock:(value:number)=>{clock=value;},clockSequence:(values:number[])=>{clockSequence=values;},expire:()=>{clock=32000;[...timers.values()][0]?.();}};
}
test('shared frame schedule preserves captured origin and trims delayed Finish without late samples',async()=>{
  const h=harness(),pending=h.start();h.options.backing[100]=.9;const plan=await h.armed();
  // Literal ceil((1 + .1) * 48000) is 52801: represented product exceeds 52800.
  assert.equal(plan.startFrame,52801+Math.round(4*60*48000/137));assert.equal(plan.limitFrame-plan.startFrame,960000);assert.equal(h.sources.length,5);
  const backing=h.sources.find(s=>(s.buffer as {length:number}).length===441000)!;
  assert.equal((backing.buffer as {getChannelData:()=>Float32Array}).getChannelData()[100],.25);assert.equal(backing.starts[0],plan.startFrame/48000);
  h.context.currentTime=(plan.startFrame+1003)/48000;h.recorder.finish();const finish=h.node.sent.find(x=>x.type==='finish')!;
  assert.equal(finish.stopFrame,Math.floor(h.context.currentTime*48000));const samples=Float32Array.from({length:2048},(_,i)=>i/4096);
  h.node.emit({type:'complete',sampleRate:48000,channels:2,startFrame:plan.startFrame,endFrame:plan.startFrame+samples.length,samples});
  const result=await pending;assert.ok(result);assert.equal(result.samples.length,(finish.stopFrame as number)-plan.startFrame);assert.equal(result.samples[100],samples[100]);
  assert.equal(result.endFrame,finish.stopFrame);assert.equal(h.track.stopped,1);assert.equal(h.node.closed,1);assert.equal(h.timers.size,0);assert.ok(h.sources.every(s=>s.disconnected>0));
});
for(const stage of ['permission','module','resume'] as const)test(`cancelled ${stage} holds native admission until settlement and never schedules late sound`,async()=>{
  const h=harness(stage),pending=h.start();for(let i=0;i<15;i++)await Promise.resolve();h.recorder.cancel();await Promise.resolve();assert.equal(h.settled(),false);
  await assert.rejects(h.recorder.start(h.options),/already|draining/i);h.held.resolve();assert.equal(await pending,null);assert.equal(h.track.stopped,1);assert.equal(h.sources.length,0);assert.equal(h.timers.size,0);
});
test('Finish during count-in cancels without retaining count-in audio',async()=>{const h=harness(),pending=h.start();await h.armed();h.recorder.finish();assert.equal(await pending,null);assert.equal(h.track.stopped,1);assert.ok(h.sources.every(s=>s.stops.length>0));});
test('setup deadline awaits late permission cleanup before rejecting',async()=>{const h=harness('permission'),pending=h.start();h.expire();await Promise.resolve();assert.equal(h.settled(),false);h.held.resolve();await assert.rejects(pending,/too long|timed out/i);assert.equal(h.track.stopped,1);assert.equal(h.sources.length,0);});
for(const event of ['mute','ended','context'] as const)test(`unexpected ${event} fails partial capture and releases graph`,async()=>{const h=harness(),pending=h.start();await h.armed();if(event==='context'){h.context.state='suspended';h.context.dispatchEvent(new Event('statechange'));}else h.track.dispatchEvent(new Event(event));await assert.rejects(pending,/microphone|context|interrupted/i);assert.equal(h.track.stopped,1);assert.equal(h.node.closed,1);});
test('malformed final samples fail and late callbacks cannot resurrect capture',async()=>{const h=harness(),pending=h.start(),plan=await h.armed();h.node.emit({type:'complete',sampleRate:48000,channels:2,startFrame:plan.startFrame,endFrame:plan.startFrame+4,samples:new Float32Array([1,2,NaN,4])});await assert.rejects(pending,/invalid|malformed/i);h.node.emit({type:'complete'});assert.equal(h.node.closed,1);assert.equal(h.track.stopped,1);});
test('invalid buffers/deadlines reject before resource admission',async()=>{const h=harness();h.options.backing=new Float32Array(4);await assert.rejects(h.recorder.start(h.options));h.options.backing=new Float32Array(441000);h.options.setupDeadline=1000;await assert.rejects(h.recorder.start(h.options));assert.equal(h.track.stopped,0);assert.equal(h.sources.length,0);});


test('natural complete returns exactly twenty seconds and source end cannot truncate microphone capture',async()=>{
  const h=harness(),pending=h.start(),plan=await h.armed();
  h.node.emit({type:'complete',sampleRate:48000,channels:2,startFrame:plan.startFrame,endFrame:plan.limitFrame,samples:new Float32Array(960000)});
  const result=await pending;assert.ok(result);assert.equal(result.samples.length,960000);assert.equal(result.endFrame,plan.limitFrame);assert.equal(h.track.stopped,1);
});
test('a progress callback retiring ownership never schedules prepared native sources',async()=>{
  const h=harness();h.options.onProgress=progress=>{if(progress.phase==='counting-in')h.recorder.cancel();};const pending=h.start();
  assert.equal(await pending,null);assert.equal(h.sources.length,5);assert.ok(h.sources.every(source=>source.starts.length===0&&source.disconnected===1));assert.equal(h.track.stopped,1);
});
test('late arm acknowledgement refuses missed count-in without automatically moving beat zero',async()=>{
  const h=harness(),original=h.node.port.postMessage;
  h.node.port.postMessage=data=>{if(data.type==='arm')h.context.currentTime=2;original(data);};
  await assert.rejects(h.start(),/missed the count-in/i);assert.ok(h.sources.every(source=>source.starts.length===0));assert.equal(h.track.stopped,1);
});
test('synchronous deadline recheck refuses delayed native completion before watchdog delivery',async()=>{
  const h=harness('module'),pending=h.start();for(let i=0;i<15;i++)await Promise.resolve();h.advanceClock(31000);h.held.resolve();
  await assert.rejects(pending,/too long/i);assert.equal(h.track.stopped,1);assert.equal(h.sources.length,0);
});


test('capture final publication rechecks deadline after bounded result validation and copying',async()=>{
  const h=harness(),pending=h.start(),plan=await h.armed();h.clockSequence([1000,32000]);
  h.node.emit({type:'complete',sampleRate:48000,channels:2,startFrame:plan.startFrame,endFrame:plan.limitFrame,samples:new Float32Array(960000)});
  await assert.rejects(pending,/too long/i);assert.equal(h.track.stopped,1);
});

test('missing native worklet capability refuses before microphone permission or resume',async()=>{
  const h=harness();Reflect.deleteProperty(h.context,'audioWorklet');
  await assert.rejects(h.start(),/AudioWorklet|Record melody/i);
  assert.equal(h.permissionCalls(),0);assert.equal(h.context.state,'suspended');assert.equal(h.sources.length,0);
});
