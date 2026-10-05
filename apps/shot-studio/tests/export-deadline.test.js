import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFilm} from '../src/export.js';

function replace(t,key,value){
  const old=Object.getOwnPropertyDescriptor(globalThis,key);
  Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  t.after(()=>{if(old)Object.defineProperty(globalThis,key,old);else delete globalThis[key];});
}
function native(t){
  let now=1000,recorder,frame,timer;
  const draws=[],track={stops:0,requests:0,stop(){this.stops++;},requestFrame(){this.requests++;}};
  replace(t,'performance',{now:()=>now});
  replace(t,'requestAnimationFrame',callback=>{frame=callback;return 1;});
  replace(t,'cancelAnimationFrame',()=>{frame=null;});
  replace(t,'setTimeout',callback=>{timer=callback;return 1;});
  replace(t,'clearTimeout',()=>{timer=null;});
  class Recorder{
    static isTypeSupported(){return true;}
    constructor(){recorder=this;this.state='inactive';this.stops=0;}
    start(){this.state='recording';}
    stop(){this.stops++;this.state='inactive';this.ondataavailable?.({data:new Blob(['video'])});this.onstop?.();}
  }
  replace(t,'MediaRecorder',Recorder);
  return{
    canvas:{captureStream:()=>({getTracks:()=>[track],getVideoTracks:()=>[track]})},
    draw:time=>draws.push(time),draws,track,
    at(time){now=time;},get recorder(){return recorder;},get frame(){return frame;},get timer(){return timer;},
  };
}

test('a delayed encoder completion cannot publish after the absolute export deadline',async t=>{
  const h=native(t),pending=exportFilm(h.canvas,h.draw,1),lateStop=h.recorder.onstop;
  h.at(12000);h.recorder.stop();
  await assert.rejects(pending,/timed out/i);
  assert.equal(h.track.stops,1);assert.equal(h.recorder.stops,1);
  assert.equal(h.recorder.onstop,null);assert.equal(h.timer,null);assert.equal(h.frame,null);
  lateStop();assert.equal(h.track.stops,1);
});

test('an expired encoder delivery retires ownership before inspecting its payload',async t=>{
  const h=native(t),pending=exportFilm(h.canvas,h.draw,1),lateData=h.recorder.ondataavailable;
  let reads=0;h.at(12001);
  lateData({get data(){reads++;return new Blob(['video']);}});
  // Force settlement in the broken implementation without firing the delayed timer.
  h.recorder.stop();await assert.rejects(pending,/timed out/i);
  assert.equal(reads,0);assert.equal(h.track.stops,1);
  lateData({get data(){throw Error('Retired encoder payload read');}});
});

test('a resumed animation callback beyond deadline cannot draw or request another frame',async t=>{
  const h=native(t),pending=exportFilm(h.canvas,h.draw,1),lateFrame=h.frame;
  h.at(12001);lateFrame(12001);
  await assert.rejects(pending,/timed out/i);
  assert.deepEqual(h.draws,[0]);assert.equal(h.track.requests,1);assert.equal(h.track.stops,1);
  lateFrame(12002);assert.deepEqual(h.draws,[0]);
});

test('encoder completion before deadline still publishes the complete bounded output',async t=>{
  const h=native(t),pending=exportFilm(h.canvas,h.draw,1);
  h.at(11999);h.recorder.stop();assert.equal(await (await pending).text(),'video');
  assert.equal(h.track.stops,1);assert.equal(h.timer,null);
});

test('a draw crossing the deadline cannot request its late canvas frame',async t=>{
  const h=native(t),pending=exportFilm(h.canvas,time=>{h.draw(time);if(time>0)h.at(12000);},1);
  h.at(1040);h.frame(1040);await assert.rejects(pending,/timed out/i);
  assert.deepEqual(h.draws,[0,.04]);assert.equal(h.track.requests,1);assert.equal(h.track.stops,1);
});

test('initial drawing that exhausts admission cannot create a capture or encoder',async t=>{
  const h=native(t);let captures=0;
  await assert.rejects(exportFilm({captureStream(){captures++;}},()=>h.at(12000),1),/timed out/i);
  assert.equal(captures,0);assert.equal(h.recorder,undefined);assert.equal(h.frame,null);
});
