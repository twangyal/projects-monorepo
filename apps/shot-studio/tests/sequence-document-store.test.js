/** Controlled event ordering; real IndexedDB is independently browser-tested. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SequenceDocumentStore} from '../src/sequence-document-store.js';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const document=title=>({schemaVersion:1,kind:'shot-studio-sequence-document',sequence:{schemaVersion:3,kind:'shot-studio-sequence',title,sources:[],clips:[]},soundtrack:null});
const bundle=title=>({document:document(title),asset:null});
function archive(title){const text=new TextEncoder().encode(JSON.stringify(document(title))),bytes=new Uint8Array(16+text.length);bytes.set(new TextEncoder().encode('SHOTSEQ1'));new DataView(bytes.buffer).setUint32(8,text.length,true);bytes.set(text,16);return bytes.buffer;}
const row=(title,revision=1,legacyRaw=null)=>({schemaVersion:1,revision,archive:archive(title),legacyRaw});
function legacy(raw=null){return {raw,reads:0,writes:0,getItem(key){assert.equal(key,'shot-studio-sequence-v1');this.reads++;return this.raw;},setItem(){this.writes++;throw Error('Never rewrite legacy.');}};}
class NativeDB{
 present=false;value;opens=[];transactions=[];closed=0;waiters=new Set();
 open(name,version){assert.equal(name,'shot-studio-sequence-documents');assert.equal(version,1);const request={};this.opens.push(request);for(const notify of this.waiters)notify();return request;}
 async waitOpen(index,pending){if(this.opens[index])return;let wake;const ready=new Promise(resolve=>{wake=()=>{if(this.opens[index])resolve();};this.waiters.add(wake);});try{await Promise.race([ready,pending.then(()=>{throw Error('Completed without opening.');})]);}finally{this.waiters.delete(wake);}}
 opened(index=this.opens.length-1){const owner=this,db={version:1,objectStoreNames:{length:1,contains:n=>n==='state'},close(){owner.closed++;},transaction(name,mode){assert.equal(name,'state');const tx={mode,requests:[],putValue:undefined,terminal:false,abortRequested:false,objectStore(name){assert.equal(name,'state');return {getKey(key){assert.equal(key,'sequence');const r={key:true};tx.requests.push(r);return r;},get(key){assert.equal(key,'sequence');const r={key:false};tx.requests.push(r);return r;},put(value,key){assert.equal(key,'sequence');if(tx.putError)throw tx.putError;tx.putValue=structuredClone(value);return {};}};},reads(){for(const req of tx.requests){req.result=req.key?(owner.present?'sequence':undefined):structuredClone(owner.value);req.onsuccess?.();}},commit(notify=true){assert.equal(tx.abortRequested,false);tx.terminal=true;if(tx.putValue!==undefined){owner.present=true;owner.value=structuredClone(tx.putValue);}if(notify)tx.oncomplete?.();},abort(){if(tx.terminal)throw Error('Already committed.');tx.abortRequested=true;},rollback(){tx.terminal=true;tx.onabort?.();}};owner.transactions.push(tx);return tx;}};this.opens[index].result=db;this.opens[index].onsuccess?.();return db;}
}
async function open(store,db,method='load',...args){const index=db.opens.length,pending=store[method](...args);pending.catch(()=>{});await db.waitOpen(index,pending);db.opened(index);await turn();return {pending,tx:db.transactions.at(-1)};}
async function read(store,db){const work=await open(store,db);work.tx.reads();work.tx.commit();return work.pending;}
async function accepted(store,db){const loaded=await read(store,db);store.acceptLoad(loaded.receipt);return loaded;}
async function rejectedReads(work,code){work.tx.reads();await assert.rejects(work.pending,e=>e.code===code);if(work.tx.abortRequested)work.tx.rollback();await turn();}

test('proven absence has no startup writes and only accepted load permits complete save',async()=>{
 const db=new NativeDB(),old=legacy(),store=new SequenceDocumentStore(()=>db,()=>old),loaded=await read(store,db);assert.deepEqual(loaded.bundle,bundle('Scene sequence'));assert.equal(loaded.legacyChanged,false);assert.equal(db.present,false);assert.equal(old.writes,0);
 await assert.rejects(store.save(bundle('Before accept')),e=>e.code==='protected');store.acceptLoad(loaded.receipt);assert.equal(store.protected,false);
 const work=await open(store,db,'save',bundle('First edit'));work.tx.reads();assert.equal(db.present,false);work.tx.commit();await work.pending;assert.equal(db.value.revision,1);assert.deepEqual(db.value.archive,archive('First edit'));assert.equal(old.writes,0);await store.close();
});
test('present undefined refuses without legacy fallback or invented raw recovery',async()=>{
 const db=new NativeDB(),old=legacy(JSON.stringify(document('Foreign').sequence));db.present=true;const store=new SequenceDocumentStore(()=>db,()=>old),work=await open(store,db);work.tx.reads();work.tx.commit();await assert.rejects(work.pending,e=>e.code==='protected');assert.equal(old.reads,0);assert.equal(store.protected,true);assert.equal(store.hasRecoveryArchive,false);assert.equal(db.value,undefined);await store.close();
});
test('legacy migration is memory-only and promotion preserves exact pretty original bytes',async()=>{
 const raw=JSON.stringify(document('Original Ω').sequence,null,2)+'\n',old=legacy(raw),db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>old);assert.deepEqual((await accepted(store,db)).bundle,bundle('Original Ω'));assert.equal(db.present,false);
 const work=await open(store,db,'save',bundle('Promoted'));work.tx.reads();work.tx.commit();await work.pending;assert.equal(db.value.legacyRaw,raw);assert.equal(old.raw,raw);assert.equal(old.writes,0);await store.close();
});
test('save captures detached input and waits actual transaction complete',async()=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);const input=bundle('Captured'),index=db.opens.length,pending=store.save(input);pending.catch(()=>{});input.document.sequence.title='External mutation';await db.waitOpen(index,pending);db.opened(index);await turn();const tx=db.transactions.at(-1);tx.reads();let done=false;pending.then(()=>done=true);await turn();assert.equal(done,false);assert.equal(db.present,false);assert.deepEqual(tx.putValue.archive,archive('Captured'));tx.commit();await pending;assert.equal(store.protected,false);await store.close();
});
test('full byte CAS refuses same revision foreign archive before put',async()=>{
 const db=new NativeDB();db.present=true;db.value=row('Original');const store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);db.value=row('Foreign same revision');const work=await open(store,db,'save',bundle('Stale'));await rejectedReads(work,'conflict');assert.deepEqual(db.value,row('Foreign same revision'));assert.equal(store.protected,true);assert.deepEqual(await store.recoveryArchive().arrayBuffer(),archive('Foreign same revision'));await store.close();
});
test('third writer invalidates freshly reviewed replacement with no blind replay',async()=>{
 const db=new NativeDB();db.present=true;db.value=row('Original');const store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);store.protect();const review=await open(store,db,'reviewReplacement');review.tx.reads();review.tx.commit();const reviewed=await review.pending;assert.equal(reviewed.summary.title,'Original');db.value=row('Third writer',2);
 const work=await open(store,db,'replaceSaved',bundle('Reviewed memory'),reviewed.receipt);await rejectedReads(work,'conflict');assert.deepEqual(db.value,row('Third writer',2));assert.equal(store.protected,true);await assert.rejects(store.replaceSaved(bundle('Replay'),reviewed.receipt));await store.close();
});
test('changed legacy restores IDB memory protected; deliberate replacement updates baseline only',async()=>{
 const old=legacy('foreign raw'),db=new NativeDB();db.present=true;db.value=row('IDB authority',4,'old raw');const store=new SequenceDocumentStore(()=>db,()=>old),loaded=await accepted(store,db);assert.equal(loaded.legacyChanged,true);assert.deepEqual(loaded.bundle,bundle('IDB authority'));assert.equal(store.protected,true);assert.equal(JSON.parse(store.recoveryLegacyJson()).raw,'foreign raw');
 const review=await open(store,db,'reviewReplacement');review.tx.reads();review.tx.commit();const receipt=(await review.pending).receipt;const work=await open(store,db,'replaceSaved',bundle('Deliberate'),receipt);work.tx.reads();work.tx.commit();await work.pending;assert.equal(db.value.legacyRaw,'foreign raw');assert.equal(old.raw,'foreign raw');assert.equal(old.writes,0);assert.equal(store.protected,false);await store.close();
});
test('abort promptly rejects but native slot and close wait for actual rollback',async()=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);const controller=new AbortController(),work=await open(store,db,'save',bundle('Cancelled'),{signal:controller.signal});work.tx.reads();controller.abort();await assert.rejects(work.pending,e=>e.code==='cancelled');assert.equal(work.tx.abortRequested,true);assert.equal(store.nativePending,true);await assert.rejects(store.load(),e=>e.code==='busy');let done=false;const closing=store.close().then(()=>done=true);await turn();assert.equal(done,false);work.tx.rollback();await closing;assert.equal(store.nativePending,false);assert.equal(db.present,false);
});
test('withheld completion after actual commit is not rollback or accepted authority',async()=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);const controller=new AbortController(),work=await open(store,db,'save',bundle('Durable'),{signal:controller.signal});work.tx.reads();work.tx.commit(false);controller.abort();await assert.rejects(work.pending,e=>e.code==='cancelled');assert.deepEqual(db.value.archive,archive('Durable'));assert.equal(store.protected,true);assert.equal(store.nativePending,true);work.tx.oncomplete();await turn();assert.equal(store.nativePending,false);await assert.rejects(store.save(bundle('Blind retry')),e=>e.code==='protected');await store.close();
});
test('protection revokes old receipt and timeout retains late native open until close drains',async t=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy()),loaded=await read(store,db);store.protect();assert.throws(()=>store.acceptLoad(loaded.receipt));t.mock.timers.enable({apis:['setTimeout']});const pending=store.load();pending.catch(()=>{});await db.waitOpen(1,pending);t.mock.timers.tick(10001);await assert.rejects(pending,e=>e.code==='timeout');assert.equal(store.nativePending,true);let done=false;const closing=store.close().then(()=>done=true);await turn();assert.equal(done,false);db.opened(1);await closing;assert.equal(db.transactions.length,1);assert.equal(db.closed,2);
});
test('post-complete legacy race protects an already durable new row without deleting it',async()=>{
 const db=new NativeDB(),old=legacy(),store=new SequenceDocumentStore(()=>db,()=>old);await accepted(store,db);const work=await open(store,db,'save',bundle('Durable race'));work.tx.reads();work.tx.commit(false);old.raw='foreign late legacy';work.tx.oncomplete();await assert.rejects(work.pending,e=>e.code==='conflict');assert.deepEqual(db.value.archive,archive('Durable race'));assert.equal(store.protected,true);assert.equal(old.raw,'foreign late legacy');await store.close();
});

test('semantically identical reordered archive still conflicts by exact saved bytes',async()=>{
 const db=new NativeDB();db.present=true;db.value=row('Original');const store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);
 const value=document('Original'),text=new TextEncoder().encode(JSON.stringify({soundtrack:value.soundtrack,sequence:value.sequence,kind:value.kind,schemaVersion:value.schemaVersion})),changed=new Uint8Array(16+text.length);changed.set(new TextEncoder().encode('SHOTSEQ1'));new DataView(changed.buffer).setUint32(8,text.length,true);changed.set(text,16);assert.equal(changed.byteLength,db.value.archive.byteLength);db.value.archive=changed.buffer;
 const work=await open(store,db,'save',bundle('Memory'));await rejectedReads(work,'conflict');assert.deepEqual(db.value.archive,changed.buffer);await store.close();
});
test('unknown or oversized opaque rows never authorize blind replacement or consult legacy',async()=>{
 for(const value of [{...row('Original'),extra:'unknown'}, {...row('Original'),archive:new ArrayBuffer(16*1024*1024+1)}, null, true]){
  const db=new NativeDB(),old=legacy('unreadable legacy');db.present=true;db.value=value;const store=new SequenceDocumentStore(()=>db,()=>old),work=await open(store,db);work.tx.reads();work.tx.commit();await assert.rejects(work.pending,e=>e.code==='protected');assert.equal(old.reads,0);assert.equal(store.hasRecoveryArchive,false);
  const review=await open(store,db,'reviewReplacement');review.tx.reads();review.tx.commit();await assert.rejects(review.pending,e=>e.code==='protected');assert.equal(db.transactions.every(tx=>tx.putValue===undefined),true);assert.deepEqual(db.value,value);await store.close();
 }
});
test('bounded corrupt archive can be recovered exactly and replaced only after fresh review',async()=>{
 const db=new NativeDB(),old=legacy();db.present=true;db.value={schemaVersion:1,revision:7,archive:Uint8Array.of(1,2,3,4).buffer,legacyRaw:null};const original=structuredClone(db.value);const store=new SequenceDocumentStore(()=>db,()=>old),work=await open(store,db);work.tx.reads();work.tx.commit();await assert.rejects(work.pending,e=>e.code==='protected');assert.equal(store.hasRecoveryArchive,true);assert.deepEqual(await store.recoveryArchive().arrayBuffer(),original.archive);
 const review=await open(store,db,'reviewReplacement');review.tx.reads();review.tx.commit();const current=await review.pending;assert.equal(current.summary.readable,false);assert.equal(current.summary.archiveBytes,4);assert.equal(store.protected,true);
 const replacement=await open(store,db,'replaceSaved',bundle('Recovered memory'),current.receipt);replacement.tx.reads();replacement.tx.commit();await replacement.pending;assert.equal(db.value.revision,8);assert.deepEqual(db.value.archive,archive('Recovered memory'));assert.equal(old.writes,0);await store.close();
});
test('invalid candidate does not discard accepted authority or open a native transaction',async()=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);const count=db.opens.length;await assert.rejects(store.save(bundle('')),e=>e.code==='invalid');assert.equal(db.opens.length,count);assert.equal(store.protected,false);
 const valid=await open(store,db,'save',bundle('Corrected'));valid.tx.reads();valid.tx.commit();await valid.pending;assert.deepEqual(db.value.archive,archive('Corrected'));await store.close();
});
test('failed native put protects without advancing receipt and actual rollback retains old row',async()=>{
 const db=new NativeDB();db.present=true;db.value=row('Original');const original=structuredClone(db.value),store=new SequenceDocumentStore(()=>db,()=>legacy());await accepted(store,db);const work=await open(store,db,'save',bundle('Will fail'));work.tx.putError=Error('QuotaExceededError');await rejectedReads(work,'storage');assert.deepEqual(db.value,original);assert.equal(work.tx.putValue,undefined);assert.equal(store.protected,true);await assert.rejects(store.save(bundle('Blind retry')),e=>e.code==='protected');
 await accepted(store,db);const retry=await open(store,db,'save',bundle('Explicit retry'));retry.tx.reads();retry.tx.commit();await retry.pending;assert.equal(db.value.revision,2);assert.deepEqual(db.value.archive,archive('Explicit retry'));await store.close();
});
test('forged and cloned receipts grant no authority; newer read retires older receipt',async()=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy()),first=await read(store,db);assert.throws(()=>store.acceptLoad({}),e=>e.code==='protected');assert.throws(()=>store.acceptLoad(structuredClone(first.receipt)),e=>e.code==='protected');await assert.rejects(store.save(bundle('Forged')),e=>e.code==='protected');const second=await read(store,db);assert.throws(()=>store.acceptLoad(first.receipt),e=>e.code==='protected');store.acceptLoad(second.receipt);assert.equal(store.protected,false);await store.close();
});
test('cancelled read cannot mint accepted authority after actual transaction terminal',async()=>{
 const db=new NativeDB(),store=new SequenceDocumentStore(()=>db,()=>legacy()),controller=new AbortController(),work=await open(store,db,'load',{signal:controller.signal});work.tx.reads();work.tx.commit(false);controller.abort();await assert.rejects(work.pending,e=>e.code==='cancelled');assert.equal(store.nativePending,true);work.tx.oncomplete();await turn();assert.equal(store.nativePending,false);assert.equal(store.protected,true);await assert.rejects(store.save(bundle('Not admitted')),e=>e.code==='protected');const fresh=await read(store,db);store.acceptLoad(fresh.receipt);assert.equal(store.protected,false);await store.close();
});
