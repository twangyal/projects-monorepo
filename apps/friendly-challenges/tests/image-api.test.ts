import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ApiError, postImageEvidence, fetchEvidenceImage, fetchImageExport } from '../src/api.ts';
const ID='1'.repeat(32), EID='2'.repeat(32), TOKEN='a'.repeat(64);
// These bytes exercise bounded transport/hash ownership, not JPEG codec validity.
const bytes=Uint8Array.from([255,216,7,255,217]);
const jpeg=new Blob([bytes],{type:'image/jpeg'});
const descriptor={mime:'image/jpeg' as const,bytes:bytes.length,width:1,height:1,sha256:createHash('sha256').update(bytes).digest('hex')};
const payload={revision:9,text:'A literal 📷 caption',url:null};
const original=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=original;});
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});

test('one binary append uses exact little-endian framing and explicit Bearer only',async()=>{
  const controller=new AbortController(); let calls=0;
  globalThis.fetch=async(path,options)=>{
    calls++;assert.equal(path,`/api/challenges/${ID}/evidence/image`);
    assert.equal(options?.method,'POST');assert.equal(options?.signal,controller.signal);
    assert.equal(options?.cache,'no-store');assert.equal(options?.credentials,'omit');assert.equal(options?.redirect,'error');
    const h=new Headers(options?.headers);assert.equal(h.get('Authorization'),`Bearer ${TOKEN}`);assert.equal(h.get('Content-Type'),'application/octet-stream');
    assert.ok(options?.body instanceof Blob);const raw=new Uint8Array(await options.body.arrayBuffer());const view=new DataView(raw.buffer);
    assert.equal(new TextDecoder().decode(raw.subarray(0,8)),'FCEVID01');
    const n=new TextEncoder().encode(JSON.stringify(payload)).length;
    assert.equal(view.getUint32(8,true),n);assert.equal(view.getUint32(12,true),bytes.length);
    assert.deepEqual(JSON.parse(new TextDecoder().decode(raw.subarray(16,16+n))),payload);assert.deepEqual(raw.subarray(16+n),bytes);
    assert.equal(new TextDecoder().decode(raw).includes(TOKEN),false);
    return json({revision:10});
  };
  assert.equal((await postImageEvidence(ID,TOKEN,payload,jpeg,controller.signal)).revision,10);assert.equal(calls,1);
});

test('image append preserves bounded conflict errors and never retries uncertain network failure',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return json({error:'Review the newer record.',code:'conflict'},409);};
  await assert.rejects(postImageEvidence(ID,TOKEN,payload,jpeg),e=>e instanceof ApiError&&e.code==='conflict'&&e.status===409);
  assert.equal(calls,1);globalThis.fetch=async()=>{calls++;throw new TypeError(TOKEN);};
  await assert.rejects(postImageEvidence(ID,TOKEN,payload,jpeg),e=>e instanceof ApiError&&!e.message.includes(TOKEN));assert.equal(calls,2);
});

test('exact 512 KiB transport blob accepted, plus one/non-JPEG/empty and invalid metadata refused before fetch',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;return json({revision:10});};
  await postImageEvidence(ID,TOKEN,payload,new Blob([new Uint8Array(524288)],{type:'image/jpeg'}));assert.equal(calls,1);
  for(const b of [new Blob([],{type:'image/jpeg'}),new Blob([new Uint8Array(524289)],{type:'image/jpeg'}),new Blob([bytes],{type:'image/png'})]) await assert.rejects(postImageEvidence(ID,TOKEN,payload,b),ApiError);
  for(const p of [{...payload,revision:0},{...payload,text:'😀'.repeat(1001)},{...payload,text:'\ud800'},{...payload,text:'\0'},{...payload,extra:1}]) await assert.rejects(postImageEvidence(ID,TOKEN,p,jpeg),ApiError);
  await assert.rejects(postImageEvidence(ID+'\n',TOKEN,payload,jpeg),ApiError);assert.equal(calls,1);
});

test('authenticated retained image returns only matching exact size and SHA',async()=>{
  globalThis.fetch=async(path,options)=>{assert.equal(path,`/api/challenges/${ID}/evidence/${EID}/image`);assert.equal(new Headers(options?.headers).get('Authorization'),`Bearer ${TOKEN}`);return new Response(bytes,{headers:{'Content-Type':'image/jpeg','Content-Length':String(bytes.length)}});};
  const result=await fetchEvidenceImage(ID,EID,TOKEN,descriptor);assert.equal(result.type,'image/jpeg');assert.deepEqual(new Uint8Array(await result.arrayBuffer()),bytes);
});

test('wrong hash/type/length and oversized chunked media reject before any Blob publication',async()=>{
  for(const response of [new Response(Uint8Array.from([255,216,8,255,217]),{headers:{'Content-Type':'image/jpeg'}}),new Response(bytes,{headers:{'Content-Type':'text/html'}}),new Response(bytes,{headers:{'Content-Type':'image/jpeg','Content-Length':'4'}}),new Response(new Uint8Array(524289),{headers:{'Content-Type':'image/jpeg'}})]){
    globalThis.fetch=async()=>response;await assert.rejects(fetchEvidenceImage(ID,EID,TOKEN,descriptor),ApiError);
  }
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response(bytes);};
  await assert.rejects(fetchEvidenceImage(ID,EID,TOKEN,{...descriptor,sha256:descriptor.sha256+'\n'}),ApiError);assert.equal(calls,0);
});

test('stream limit cancels reader and binary cancellation preserves AbortError',async()=>{
  let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(524289));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'image/jpeg'}});
  await assert.rejects(fetchEvidenceImage(ID,EID,TOKEN,descriptor),ApiError);assert.equal(cancelled,true);
  const abort=new DOMException('Aborted','AbortError');globalThis.fetch=async()=>{throw abort;};await assert.rejects(postImageEvidence(ID,TOKEN,payload,jpeg),e=>e===abort);
  const c=new AbortController();c.abort();let called=0;globalThis.fetch=async()=>{called++;return json({});};await assert.rejects(fetchEvidenceImage(ID,EID,TOKEN,descriptor,c.signal),{name:'AbortError'});assert.equal(called,0);
});

test('HTML download is a separate 12 MiB bounded authenticated binary response',async()=>{
  globalThis.fetch=async(path,options)=>{assert.equal(path,`/api/challenges/${ID}/export/images`);assert.equal(new Headers(options?.headers).get('Authorization'),`Bearer ${TOKEN}`);return new Response('<!doctype html><p>literal report</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}});};
  const result=await fetchImageExport(ID,TOKEN);assert.match(await result.text(),/literal report/);
  globalThis.fetch=async()=>new Response(new Uint8Array(12*1024*1024+1),{headers:{'Content-Type':'text/html'}});await assert.rejects(fetchImageExport(ID,TOKEN),ApiError);
  globalThis.fetch=async()=>json({error:`private ${TOKEN}`,code:'unauthorized'},401);await assert.rejects(fetchImageExport(ID,TOKEN),e=>e instanceof ApiError&&!e.message.includes(TOKEN));
});
