/** Controlled IDB event boundaries; real IndexedDB acceptance is a separate native gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createProject} from '../src/model.js';
import {TakeStore} from '../src/take-store.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const empty=revision=>({schemaVersion:1,revision,records:[]});
function candidate(revision=1){
  const bytes=Uint8Array.of(0x1a,0x45,0xdf,0xa3,1,2,3,4);
  return {schemaVersion:1,revision,records:[{metadata:{schemaVersion:1,
    id:'12345678-1234-4123-8123-123456789abc',name:'Original take',
    recordedAt:'2026-10-04T00:00:00.000Z',origin:'recorded-here',film:createProject(),
    video:{mime:'video/webm',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},
  },video:new Blob([bytes],{type:'video/webm'})}]};
}

// This fixture deliberately does not auto-commit on request success. Its event
// controls expose abort/late-open/transaction-complete seams without pretending
// to implement IndexedDB's scheduling or browser persistence.
class ControlledDatabase {
  constructor(){this.present=false;this.value=undefined;this.opens=[];this.transactions=[];this.closes=0;this.openWaiters=new Set();}
  open(name,version){
    assert.equal(name,'shot-studio-takes');assert.equal(version,1);
    const request={};this.opens.push(request);for(const notify of this.openWaiters)notify();return request;
  }
  waitForOpen(index,pending){
    if(this.opens[index])return Promise.resolve();
    let notify;
    const requested=new Promise(resolve=>{
      notify=()=>{if(this.opens[index])resolve();};this.openWaiters.add(notify);
    });
    // Production already bounds the operation. Its rejection must propagate
    // instead of hanging the driver if preflight fails before requesting IDB.
    return Promise.race([requested,pending.then(()=>{throw Error('Storage completed without opening the database.');})])
      .finally(()=>this.openWaiters.delete(notify));
  }
  opened(index=this.opens.length-1){
    const owner=this;
    const db={version:1,objectStoreNames:{length:1,contains:name=>name==='state'},
      close(){owner.closes++;},transaction(name,mode){
        assert.equal(name,'state');const tx={mode,requests:[],putValue:undefined,aborted:false,
          objectStore(storeName){assert.equal(storeName,'state');return {
            getKey(key){assert.equal(key,'library');const request={kind:'key'};tx.requests.push(request);return request;},
            get(key){assert.equal(key,'library');const request={kind:'value'};tx.requests.push(request);return request;},
            put(value,key){assert.equal(key,'library');tx.putValue=structuredClone(value);return {};},
          };},
          reads(){for(const request of tx.requests){request.result=request.kind==='key'?(owner.present?'library':undefined):structuredClone(owner.value);request.onsuccess?.();}},
          complete(){assert.equal(tx.aborted,false);if(tx.putValue!==undefined){owner.present=true;owner.value=structuredClone(tx.putValue);}tx.oncomplete?.();},
          abort(){tx.aborted=true;queueMicrotask(()=>tx.onabort?.());},
        };owner.transactions.push(tx);return tx;
      },
    };
    this.opens[index].result=db;this.opens[index].onsuccess?.();return db;
  }
}

async function opened(store,database,method='read',value){
  const index=database.opens.length;
  const pending=method==='read'?store.read():store.save(value,{expectedRevision:value.revision-1});
  pending.catch(()=>{});await database.waitForOpen(index,pending);database.opened(index);await flush();return {pending,tx:database.transactions.at(-1)};
}
async function completeReads(database,tx){
  tx.reads();tx.complete();await flush();
  // Save may verify the current row before its CAS write transaction.
  const current=database.transactions.at(-1);
  if(current!==tx){current.reads();await flush();return current;}
  return tx;
}

test('only proven absence reads empty; present undefined is protected corruption',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database);
  const first=await opened(store,database);first.tx.reads();first.tx.complete();
  assert.deepEqual(await first.pending,empty(0));assert.equal(database.closes,1);
  database.present=true;database.value=undefined;
  const bad=await opened(store,database);bad.tx.reads();
  await assert.rejects(bad.pending,error=>error.code==='protected');
  assert.equal(database.present,true);assert.equal(database.value,undefined);store.close();
});

test('save captures detached metadata and resolves only after transaction completion',async t=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database),value=candidate();
  const nativeDigest=crypto.subtle.digest.bind(crypto.subtle);
  let releaseHash,hashArrived;
  const gate=new Promise(resolve=>releaseHash=resolve),arrived=new Promise(resolve=>hashArrived=resolve);
  t.mock.method(crypto.subtle,'digest',async(...args)=>{
    const actual=await nativeDigest(...args);hashArrived();await gate;return actual;
  });
  t.after(()=>{releaseHash();store.close();});
  const pending=store.save(value,{expectedRevision:0});let settled=false;
  pending.then(()=>settled=true,()=>settled=true);
  value.records[0].metadata.name='Mutated while opening';value.records[0].metadata.film.title='Outside';
  await arrived;
  assert.equal(database.opens.length,0,'The real hash result is still pending, so no IDB request exists yet');
  const ready=database.waitForOpen(0,pending);
  await flush();assert.equal(database.opens.length,0);assert.equal(settled,false);
  releaseHash();await ready;database.opened(0);await flush();
  const tx=await completeReads(database,database.transactions.at(-1));
  assert.equal(settled,false);assert.equal(database.present,false);
  assert.equal(tx.putValue.records[0].metadata.name,'Original take');
  tx.complete();const result=await pending;
  assert.equal(result.revision,1);assert.equal(result.records[0].metadata.film.title,'The arrival');
  result.records[0].metadata.name='External returned mutation';
  assert.equal(database.value.records[0].metadata.name,'Original take');store.close();
});

test('a stale read-modify-write refuses typed conflict without overwriting another tab',async()=>{
  const database=new ControlledDatabase();database.present=true;database.value=empty(2);
  const store=new TakeStore(()=>database),work=await opened(store,database,'save',empty(2));
  const tx=await completeReads(database,work.tx);
  if(!tx.aborted)tx.complete();
  await assert.rejects(work.pending,error=>error.code==='conflict');
  assert.deepEqual(database.value,empty(2));store.close();
});

test('corrupt existing state blocks save; explicit repaired read can retry without reset',async()=>{
  const database=new ControlledDatabase();database.present=true;database.value={broken:true};
  const store=new TakeStore(()=>database),work=await opened(store,database,'save',empty(1));work.tx.reads();
  await assert.rejects(work.pending,error=>error.code==='protected');assert.deepEqual(database.value,{broken:true});
  database.value=empty(3);const retry=await opened(store,database);retry.tx.reads();retry.tx.complete();
  assert.deepEqual(await retry.pending,empty(3));store.close();
});

test('invalid revision or mismatched blob hash is rejected before write transaction',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database);
  await assert.rejects(store.save(empty(2),{expectedRevision:0}),error=>error.code==='invalid');
  await assert.rejects(store.save(empty(1),{expectedRevision:true}),error=>error.code==='invalid');
  const bad=candidate();bad.records[0].metadata.video.sha256='0'.repeat(64);
  await assert.rejects(store.save(bad,{expectedRevision:0}),error=>error.code==='invalid');
  assert.equal(database.transactions.length,0);store.close();
});

test('read verifies stored media hash after commit and preserves mismatched raw bytes',async()=>{
  const database=new ControlledDatabase();database.present=true;database.value=candidate();
  database.value.records[0].metadata.video.sha256='0'.repeat(64);
  const store=new TakeStore(()=>database),work=await opened(store,database);work.tx.reads();work.tx.complete();
  await assert.rejects(work.pending,error=>error.code==='protected');
  assert.equal(database.value.records[0].metadata.video.sha256,'0'.repeat(64));store.close();
});

test('abort after put request succeeds keeps previous row and rejects publication',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database),controller=new AbortController();
  const pending=store.save(empty(1),{expectedRevision:0,signal:controller.signal});pending.catch(()=>{});
  await flush();database.opened();await flush();const tx=await completeReads(database,database.transactions.at(-1));
  assert.deepEqual(tx.putValue,empty(1));controller.abort();
  await assert.rejects(pending,error=>error.code==='cancelled');
  assert.equal(tx.aborted,true);assert.equal(database.present,false);store.close();
});

test('close retires pending open and closes its late connection without creating a transaction',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database),pending=store.read();pending.catch(()=>{});
  await flush();store.close();await assert.rejects(pending,error=>error.code==='storage');
  database.opened();await flush();assert.equal(database.closes,1);assert.equal(database.transactions.length,0);
  await assert.rejects(store.read(),error=>error.code==='storage');store.close();
});

test('open and transaction stalls time out and late callbacks cannot publish',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const database=new ControlledDatabase(),store=new TakeStore(()=>database),pending=store.read();pending.catch(()=>{});
  await flush();t.mock.timers.tick(10000);await assert.rejects(pending,error=>error.code==='timeout');
  database.opened();await flush();assert.equal(database.transactions.length,0);
  const next=await opened(store,database,'save',empty(1));const tx=await completeReads(database,next.tx);
  t.mock.timers.tick(10000);await assert.rejects(next.pending,error=>error.code==='timeout');
  assert.equal(tx.aborted,true);assert.equal(database.present,false);store.close();
});

test('version change aborts the owning transaction and closes its connection',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database),pending=store.read();pending.catch(()=>{});
  await flush();const db=database.opened();await flush();const tx=database.transactions.at(-1);
  db.onversionchange();await assert.rejects(pending,error=>error.code==='conflict');
  assert.equal(tx.aborted,true);assert.equal(database.closes,1);store.close();
});

test('a native upgrade delivered after cancellation is aborted, never creating a partial database',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database),controller=new AbortController();
  const pending=store.read({signal:controller.signal});pending.catch(()=>{});await flush();
  controller.abort();await assert.rejects(pending,error=>error.code==='cancelled');
  let aborted=0,created=0;
  const request=database.opens[0];
  request.transaction={abort(){aborted++;}};
  request.result={objectStoreNames:{length:0},createObjectStore(){created++;}};
  request.onupgradeneeded();assert.equal(aborted,1);assert.equal(created,0);store.close();
});

test('CAS rereads current state after integrity preflight rather than overwriting a newer revision',async()=>{
  const database=new ControlledDatabase(),store=new TakeStore(()=>database);
  const work=await opened(store,database,'save',empty(1));work.tx.reads();work.tx.complete();await flush();
  const write=database.transactions.at(-1);assert.equal(write.mode,'readwrite');
  database.present=true;database.value=empty(7);write.reads();
  await assert.rejects(work.pending,error=>error.code==='conflict');
  assert.deepEqual(database.value,empty(7));assert.equal(write.putValue,undefined);store.close();
});
