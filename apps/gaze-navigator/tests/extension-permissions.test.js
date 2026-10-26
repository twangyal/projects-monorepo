import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function setup(microphone, result) {
  const nodes = Object.fromEntries(['status','allow','description','privacy','heading'].map(id=>[id,{textContent:'',disabled:false,addEventListener(_event,fn){this.click=fn;}}]));
  const calls=[], tracks=[{stop(){calls.push('stopped');}}];
  const document={getElementById:id=>nodes[id],querySelector:()=>nodes.heading};
  const navigator={permissions:{query:async value=>{calls.push(value);return{state:'prompt'};}},mediaDevices:{getUserMedia:async value=>{calls.push(value);if(result instanceof Error)throw result;return{getTracks:()=>tracks};}}};
  vm.runInNewContext(await readFile('extension/permissions.js','utf8'),{document,navigator,location:{search:microphone?'?device=microphone':''},URLSearchParams});
  await Promise.resolve(); return {nodes,calls};
}

test('microphone setup asks only for audio after an explicit click and immediately releases it', async () => {
  const h=await setup(true); assert.deepEqual(h.calls.map(x=>JSON.stringify(x)),['{"name":"microphone"}']);
  assert.match(h.nodes.privacy.textContent,/browser vendor/); assert.equal(h.nodes.allow.textContent,'Allow microphone');
  await h.nodes.allow.click(); assert.equal(JSON.stringify(h.calls[1]),'{"audio":true}'); assert.equal(h.calls[2],'stopped'); assert.equal(h.nodes.allow.disabled,true); assert.match(h.nodes.status.textContent,/Start listening/);
});

test('refused microphone setup stays retryable and never asks for camera access', async () => {
  const error=Object.assign(new Error('refused'),{name:'NotAllowedError'}); const h=await setup(true,error); await h.nodes.allow.click();
  assert.equal(h.nodes.allow.disabled,false); assert.match(h.nodes.status.textContent,/Microphone access was refused/); assert.equal(h.calls.some(x=>x?.video),false);
});

test('camera setup keeps its existing video-only request and releases tracks', async () => {
  const h=await setup(false); await h.nodes.allow.click(); assert.equal(JSON.stringify(h.calls[1]),'{"video":true}'); assert.equal(h.calls[2],'stopped'); assert.match(h.nodes.status.textContent,/use camera/);
});
