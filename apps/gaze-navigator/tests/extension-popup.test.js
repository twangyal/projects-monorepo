import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function popup({phase='off',denied=false,storageFailure=false,shortcut='Alt+Shift+N',shortcutFailure=false}={}){
 const timers=[];const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',checked:false,disabled:false,hidden:true,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});return nodes.get(id);};
 const chrome={commands:{getAll:async()=>{if(shortcutFailure)throw Error('commands unavailable');return[{name:'toggle-navigator',shortcut}];}},tabs:{query:async()=>[{id:7}]},storage:{local:{get:async()=>({}),set:async()=>{if(storageFailure)throw Error('storage unavailable');}}},permissions:{contains:async()=>false,request:async()=>!denied},runtime:{sendMessage:async({type})=>type==='gaze:page-status'?{on:false,phase,message:phase==='unavailable'?'This page does not allow navigator access.':''}:{on:false}}};
 const run=new (Object.getPrototypeOf(async function(){}).constructor)('chrome','document','setTimeout','clearTimeout',await readFile('extension/popup.js','utf8'));
 await run(chrome,{getElementById:node},callback=>{timers.push(callback);return timers.length;},()=>{});await new Promise(r=>setImmediate(r));return{node,chrome,timers};
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


test('a retired starting-status poll cannot overwrite a newer successful toggle with its late failure',async()=>{
 const h=await popup({phase:'starting'});let rejectPoll,first=true;
 h.chrome.runtime.sendMessage=async message=>{
  if(message.type==='gaze:toggle')return 'on';
  if(first){first=false;return new Promise((_,reject)=>{rejectPoll=reject;});}
  return {on:true,phase:'on',message:''};
 };
 h.timers.shift()();await new Promise(r=>setImmediate(r));assert.equal(typeof rejectPoll,'function');
 await h.node('toggle').listeners.click();assert.match(h.node('state').textContent,/On for this page/);
 rejectPoll(Error('retired poll failed'));await new Promise(r=>setImmediate(r));
 assert.match(h.node('state').textContent,/On for this page/);assert.equal(h.node('toggle').disabled,false);assert.equal(h.node('retry').hidden,true);
});


test('popup reports actual assigned, conflicting and unassigned page-toggle shortcuts',async()=>{
 const assigned=await popup();assert.match(assigned.node('shortcut').textContent,/Page on\/off: Alt\+Shift\+N/);
 const custom=await popup({shortcut:'Ctrl+Shift+Y'});assert.match(custom.node('shortcut').textContent,/Ctrl\+Shift\+Y/);
 for(const shortcut of ['Alt+Shift+G','Option+Shift+G','⌥⇧G']){
  const conflict=await popup({shortcut});assert.match(conflict.node('shortcut').textContent,/conflicts with command entry/);assert.match(conflict.node('shortcut').textContent,/chrome:\/\/extensions\/shortcuts/);
 }
 const unassigned=await popup({shortcut:''});assert.match(unassigned.node('shortcut').textContent,/No page on\/off shortcut is assigned/);assert.equal(unassigned.node('toggle').disabled,false);
});
test('shortcut lookup failure explains toolbar recovery without blocking current-page control',async()=>{
 const h=await popup({shortcutFailure:true});assert.match(h.node('shortcut').textContent,/Could not check/);assert.match(h.node('shortcut').textContent,/toolbar popup/);assert.equal(h.node('toggle').disabled,false);assert.match(h.node('state').textContent,/Off for this page/);
});
