import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameSpeech } from '../src/web/frame-speech.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const frames = [], ports = [], events = [], requests = [], timers = new Map();
  let timerId = 0;
  const listeners = () => { const callbacks = new Set(); return { addListener: fn => callbacks.add(fn), removeListener: fn => callbacks.delete(fn), emit: value => { for (const fn of callbacks) fn(value); } }; };
  const window = { crypto, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) };
  const document = { createElement: () => { const frame = { style: {}, attributes: {}, setAttribute(k,v) { this.attributes[k]=v; }, addEventListener(_event, fn) { this.load=fn; }, remove() { this.removed=true; } }; frames.push(frame); return frame; } };
  const runtime = { getURL: path => `chrome-extension://unit/${path}`, sendMessage: async request => requests.push(request), connect: options => {
    const port = { options, onMessage: listeners(), onDisconnect: listeners(), sent: [], postMessage(message) { this.sent.push(message); }, disconnect() { this.disconnected=true; this.onDisconnect.emit(); } };
    ports.push(port); return port;
  } };
  const callbacks = { onSpeechStart: () => events.push(['start']), onReset: () => events.push(['reset']), onInterim: text => events.push(['interim',text]), onFinal: text => events.push(['final',text]), onImmediate: text => events.push(['immediate',text]), onError: text => events.push(['error',text]), onState: state => events.push(['state',state]) };
  const speech = createFrameSpeech({ document, window, mount: { prepend() {} }, runtime, ...callbacks });
  async function ready() { frames.at(-1).load(); await flush(); const port=ports.at(-1); port.onMessage.emit({type:'ready',speechSupported:true}); port.onMessage.emit({id:1,result:true}); port.onMessage.emit({type:'speech',event:'state',value:'listening'}); await flush(); events.length=0; return port; }
  return { speech, frames, ports, events, requests, timers, ready };
}

test('speech runs in a microphone-only extension frame and relays private utterance events', async () => {
  const h=harness(); assert.equal(h.speech.start(),true); assert.equal(h.speech.listening,true);
  const frame=h.frames[0]; assert.match(frame.src,/^chrome-extension:\/\/unit\/capture.html#[a-f0-9]{32}$/); assert.equal(frame.allow,'microphone');
  assert.equal(frame.attributes['aria-hidden'],'true');
  const port=await h.ready(); assert.equal(port.options.name,`gaze-capture:${frame.src.split('#')[1]}`);
  assert.deepEqual(port.sent[0],{id:1,op:'speech-start'});
  for (const [event,value] of [['start'],['interim','open'],['final','open about'],['immediate','cancel']]) port.onMessage.emit({type:'speech',event,value});
  assert.deepEqual(h.events,[['start'],['interim','open'],['final','open about'],['immediate','cancel']]); h.speech.stop();
  assert.equal(frame.removed,true); assert.equal(port.disconnected,true); assert.equal(h.speech.listening,false); assert.equal(h.timers.size,0);
});

test('stop/restart refuses late events and a late earlier frame load', async () => {
  const h=harness(); h.speech.start(); const oldFrame=h.frames[0]; h.speech.stop(); h.speech.start(); oldFrame.load(); await flush(); assert.equal(h.ports.length,0);
  const old=await h.ready(); h.speech.stop(); h.speech.start(); const current=await h.ready();
  old.onMessage.emit({type:'speech',event:'final',value:'confirm'}); old.onDisconnect.emit();
  current.onMessage.emit({type:'speech',event:'final',value:'open help'}); assert.deepEqual(h.events,[['final','open help']]); assert.equal(h.speech.listening,true); h.speech.stop();
});

test('permission refusal opens extension microphone setup once and stops before reporting', async () => {
  const h=harness(); h.speech.start(); const port=await h.ready();
  port.onMessage.emit({type:'speech',event:'error',value:'refused',code:'not-allowed',listening:false});
  await flush(); assert.equal(h.speech.listening,false); assert.equal(h.frames[0].removed,true);
  assert.deepEqual(h.requests,[{type:'gaze:microphone-permission'}]); assert.match(h.events.find(e=>e[0]==='error')[1],/setup tab/);
  port.onMessage.emit({type:'speech',event:'error',value:'late',code:'not-allowed',listening:false}); assert.equal(h.requests.length,1);
});

test('transient speech errors keep listening; fatal service errors and disconnection stop it', async () => {
  const h=harness(); h.speech.start(); const port=await h.ready(); port.onMessage.emit({type:'speech',event:'error',value:'network retry',listening:true});
  assert.equal(h.speech.listening,true); port.onDisconnect.emit(); assert.equal(h.speech.listening,false); assert.equal(h.frames[0].removed,true); assert.match(h.events.at(-2)?.[1] ?? h.events.at(-1)[1],/closed|stopped/);
  h.speech.start(); const next=await h.ready(); next.onMessage.emit({type:'speech',event:'state',value:'stopped'}); assert.equal(h.speech.listening,false); assert.deepEqual(h.events.at(-1),['state','stopped']);
});

test('startup failures and unsupported recognition release the frame without site-owned fallback', async () => {
  const h=harness(); h.speech.start(); h.frames[0].load(); await flush(); h.ports[0].onMessage.emit({type:'ready',speechSupported:false}); await flush();
  assert.equal(h.speech.listening,false); assert.match(h.events.find(e=>e[0]==='error')[1],/not available/); assert.equal(h.frames[0].removed,true);
  h.speech.start(); for(const fn of [...h.timers.values()]) fn(); await flush(); assert.equal(h.speech.listening,false); assert.equal(h.frames.at(-1).removed,true);
});

test('native startup stays bounded after the frame acknowledges start and late speech cannot revive it', async () => {
  const h=harness(); h.speech.start(); h.frames[0].load(); await flush(); const port=h.ports[0];
  port.onMessage.emit({type:'ready',speechSupported:true}); port.onMessage.emit({id:1,result:true}); await flush();
  assert.equal(h.timers.size,1,'calling Recognition.start is not evidence of native onstart');
  for(const fn of [...h.timers.values()]) fn(); await flush();
  assert.equal(h.speech.listening,false); assert.equal(h.frames[0].removed,true);
  const events=structuredClone(h.events);
  port.onMessage.emit({type:'speech',event:'state',value:'listening'}); port.onMessage.emit({type:'speech',event:'final',value:'confirm'});
  assert.deepEqual(h.events,events); assert.equal(h.timers.size,0);
});

for(const eventFirst of [false,true]) test(`startup admits native onstart ${eventFirst?'before':'after'} its acknowledgement`, async () => {
  const h=harness(); h.speech.start(); h.frames[0].load(); await flush(); const port=h.ports[0];
  port.onMessage.emit({type:'ready',speechSupported:true});
  const state={type:'speech',event:'state',value:'listening'},ack={id:1,result:true};
  port.onMessage.emit(eventFirst?state:ack); await flush(); assert.equal(h.timers.size,1);
  port.onMessage.emit(eventFirst?ack:state); await flush(); assert.equal(h.timers.size,0);
  assert.equal(h.speech.listening,true); assert.deepEqual(h.events,[['state','listening']]); h.speech.stop();
});

 test('private speech resets release only the current session capture', async () => {
  const h=harness(); h.speech.start(); const old=await h.ready();
  old.onMessage.emit({type:'speech',event:'reset'});
  assert.deepEqual(h.events,[['reset']]);
  h.speech.stop(); h.speech.start(); const current=await h.ready();
  old.onMessage.emit({type:'speech',event:'reset'});
  current.onMessage.emit({type:'speech',event:'start'});
  assert.deepEqual(h.events,[['start']]); h.speech.stop();
});
