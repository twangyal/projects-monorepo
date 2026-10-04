import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFilm} from '../src/export.js';

function replace(t,key,value){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});}
function harness(t,{manual=true,onStop,onCapture,onRequest}={}){
  const events=[],tracks=[],callbacks=new Map();let recorder,clock=1000,nextFrame=0;
  replace(t,'performance',{now:()=>clock});
  replace(t,'requestAnimationFrame',callback=>{const id=++nextFrame;callbacks.set(id,callback);return id;});
  replace(t,'cancelAnimationFrame',id=>callbacks.delete(id));
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(stream){recorder=this;this.state='inactive';events.push(['construct',stream.ordinal]);}
    start(){this.state='recording';events.push(['start']);}
    stop(){this.state='inactive';events.push(['stop']);this.ondataavailable?.({data:new Blob(['video'])});this.onstop?.();}
  }
  replace(t,'MediaRecorder',Recorder);
  t.after(()=>{if(recorder?.state==='recording')recorder.stop();});
  const canvas={captureStream(rate){const ordinal=tracks.length;events.push(['capture',rate]);onCapture?.(ordinal);
    const track={stops:0,requests:[],stop(){this.stops++;events.push(['track-stop',ordinal]);onStop?.(ordinal);}};
    if(manual)track.requestFrame=()=>{track.requests.push(clock);events.push(['request',clock]);onRequest?.(track.requests.length);};
    tracks.push(track);return{ordinal,getTracks:()=>[track],getVideoTracks:()=>[track]};}};
  const draw=time=>events.push(['draw',time]);
  const tick=time=>{clock=time;const pair=[...callbacks.entries()][0];assert.ok(pair,'RAF must be pending');callbacks.delete(pair[0]);pair[1](time);};
  return{canvas,draw,events,tracks,tick,get recorder(){return recorder;},get pendingFrames(){return callbacks.size;},get nextCallback(){return [...callbacks.values()][0];}};
}

test('manual capture starts recorder before requesting the initial genuinely drawn frame',async t=>{
  const h=harness(t),pending=exportFilm(h.canvas,h.draw,1);
  assert.deepEqual(h.events.slice(0,5),[['draw',0],['capture',0],['construct',0],['start'],['request',1000]]);
  h.tick(1040);assert.deepEqual(h.events.slice(-2),[['draw',.04],['request',1040]]);
  h.tick(2000);assert.equal((await pending).size,5);assert.equal(h.tracks[0].stops,1);
});

test('manual cadence never catches up or duplicates requests and terminal frame waits for a genuine eligible draw',async t=>{
  const h=harness(t),pending=exportFilm(h.canvas,h.draw,1);
  for(const time of [1010,1034,1050,1068,1990,2000])h.tick(time);
  assert.deepEqual(h.tracks[0].requests,[1000,1034,1068,1990]);assert.equal(h.recorder.state,'recording');
  h.tick(2024);assert.equal((await pending).size,5);
  assert.deepEqual(h.tracks[0].requests,[1000,1034,1068,1990,2024]);
  assert.deepEqual(h.events.filter(event=>event[0]==='draw').map(event=>event[1]),[0,.01,.034,.05,.068,.99,1,1]);
  assert.equal(h.pendingFrames,0);
});

test('missing requestFrame stops the owned probe before one automatic fallback admission',async t=>{
  const h=harness(t,{manual:false}),pending=exportFilm(h.canvas,h.draw,1);
  assert.deepEqual(h.events.slice(0,6),[['draw',0],['capture',0],['track-stop',0],['capture',30],['construct',1],['start']]);
  h.tick(2000);await pending;assert.deepEqual(h.tracks.map(track=>track.stops),[1,1]);
});

test('abort caused while releasing the probe refuses the fallback stream and encoder',async t=>{
  const controller=new AbortController(),h=harness(t,{manual:false,onStop:()=>controller.abort()});
  await assert.rejects(exportFilm(h.canvas,h.draw,1,{signal:controller.signal}),/cancelled/);
  assert.equal(h.tracks.length,1);assert.equal(h.tracks[0].stops,1);assert.equal(h.recorder,undefined);
});

test('a draw retiring export cannot request another native frame or publish from a late RAF',async t=>{
  const controller=new AbortController(),h=harness(t);let draws=0;
  const pending=exportFilm(h.canvas,time=>{h.draw(time);if(++draws===2)controller.abort();},1,{signal:controller.signal});
  const late=h.nextCallback;h.tick(1040);await assert.rejects(pending,/cancelled/);late(1080);
  assert.deepEqual(h.tracks[0].requests,[1000]);assert.equal(h.tracks[0].stops,1);assert.equal(h.pendingFrames,0);
});

test('manual initial or later request failure closes recorder and tracks without silently falling back',async t=>{
  for(const failedRequest of [1,2]){
    const h=harness(t,{onRequest:count=>{if(count===failedRequest)throw Error('Frame request failed');}});
    const pending=exportFilm(h.canvas,h.draw,1);if(failedRequest===2)h.tick(1040);
    await assert.rejects(pending,/Frame request failed/);assert.equal(h.tracks.length,1);assert.equal(h.tracks[0].stops,1);
    assert.equal(h.recorder.onstop,null);assert.equal(h.recorder.ondataavailable,null);assert.equal(h.pendingFrames,0);
  }
});
