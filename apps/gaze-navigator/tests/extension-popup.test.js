import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function popup({phase='off',denied=false,storageFailure=false}={}){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',checked:false,disabled:false,hidden:true,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return nodes.get(id);};
 const chrome={tabs:{query:async()=>[{id:7}]},storage:{local:{get:async()=>({}),set:async()=>{if(storageFailure)throw Error('storage unavailable');}}},permissions:{contains:async()=>false,request:async()=>!denied},runtime:{sendMessage:async({type})=>type==='gaze:page-status'?{on:false,phase,message:phase==='unavailable'?'This page does not allow navigator access.':''}:{on:false}}};
 const run=new (Object.getPrototypeOf(async function(){}).constructor)('chrome','document','setTimeout','clearTimeout',await readFile('extension/popup.js','utf8'));
 await run(chrome,{getElementById:node},()=>0,()=>{});await new Promise(r=>setImmediate(r));return{node,chrome};
}
test('popup distinguishes protected page access from an ordinary stopped page',async()=>{
 const blocked=await popup({phase:'unavailable'});assert.equal(blocked.node('toggle').disabled,true);assert.match(blocked.node('state').textContent,/does not allow/);assert.equal(blocked.node('retry').hidden,false);
 const ordinary=await popup();assert.equal(ordinary.node('toggle').disabled,false);assert.match(ordinary.node('state').textContent,/Off/);
});
test('denied permission feedback remains visible after the current-page status refresh',async()=>{
 const h=await popup({denied:true});const checkbox=h.node('persist');checkbox.checked=true;await checkbox.listeners.change({target:checkbox});
 assert.equal(checkbox.checked,false);assert.equal(h.node('feedback').hidden,false);assert.match(h.node('feedback').textContent,/not granted/);
});
test('failed preference storage restores the checkbox and exposes recoverable feedback',async()=>{
 const h=await popup({storageFailure:true});const checkbox=h.node('persist');checkbox.checked=true;await checkbox.listeners.change({target:checkbox});
 assert.equal(checkbox.checked,false);assert.equal(h.node('feedback').hidden,false);assert.match(h.node('feedback').textContent,/could not save/i);
});

test('rejected status and malformed replies expose Retry, which recovers on a good response',async()=>{
 for(const response of ['reject','malformed']){
  const h=await popup();const original=h.chrome.runtime.sendMessage;
  h.chrome.runtime.sendMessage=async()=>{if(response==='reject')throw Error('worker unavailable');return null;};
  await h.node('retry').listeners.click();assert.equal(h.node('retry').hidden,false);assert.equal(h.node('toggle').disabled,true);assert.match(h.node('state').textContent,/Could not check/);
  h.chrome.runtime.sendMessage=original;await h.node('retry').listeners.click();assert.equal(h.node('toggle').disabled,false);assert.equal(h.node('retry').hidden,true);assert.match(h.node('state').textContent,/Off/);
 }
});
test('a rejected toggle stays recoverable instead of leaving an enabled button with stale status',async()=>{
 const h=await popup(),original=h.chrome.runtime.sendMessage;
 h.chrome.runtime.sendMessage=async message=>{if(message.type==='gaze:toggle')throw Error('tab closed');return original(message);};
 await h.node('toggle').listeners.click();assert.equal(h.node('retry').hidden,false);assert.equal(h.node('toggle').disabled,true);
});
