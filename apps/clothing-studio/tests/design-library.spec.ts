import {expect,test,type Page} from '@playwright/test';
import type{DesignReceipt}from'../src/design-library.ts';
async function harness(page:Page){await page.goto('/tests/storage-harness.html');await expect.poll(()=>page.evaluate(()=>!!window.clothingDesignLibrary)).toBe(true);}
test('real library stores detached complete copies atomically and reopens deletes without changing autosave',async({page})=>{
 await harness(page);
 const result=await page.evaluate(async()=>{
  const api=window.clothingDesignLibrary,p=window.clothingStorage.createProject();p.title='Original 🌓';p.note='Literal private note';p.strokes=[{id:'s1',color:'#123456',width:2,points:[{x:.1,y:.2},{x:.4,y:.5}]}];
  await window.clothingStorage.saveProject(p);const first=await api.saveDesign(' Navy version ',p);p.note='Newer';const second=await api.saveDesign('Newer version',p);
  const old=await api.readDesign(first);old.note='Mutated caller';const again=await api.readDesign(first),all=await api.listDesigns();
  await api.deleteDesign(first);return{first,second,again,all,remaining:await api.listDesigns(),current:await window.clothingStorage.loadProject()};
 });
 expect(result.first.name).toBe('Navy version');expect(result.again.note).toBe('Literal private note');expect(result.again.strokes).toHaveLength(1);expect(result.all).toHaveLength(2);expect(result.remaining.map(r=>r.id)).toEqual([result.second.id]);expect(result.current?.note).toBe('Literal private note');
 await page.reload();expect(await page.evaluate(()=>window.clothingDesignLibrary.listDesigns())).toEqual(result.remaining);
});
test('concurrent additions retain every distinct copy and enforce name and capacity inside native transactions',async({page,context})=>{
 await harness(page);const other=await context.newPage();await harness(other);
 const results=await Promise.all([page,other].map((p,i)=>p.evaluate(async i=>{try{return{ok:true,row:await window.clothingDesignLibrary.saveDesign(i?'same NAME':'Same name',window.clothingStorage.createProject())};}catch(error){return{ok:false,message:String(error)};}},i)));
 expect(results.filter(r=>r.ok)).toHaveLength(1);
 await page.evaluate(async()=>{await Promise.all(Array.from({length:10},(_,i)=>window.clothingDesignLibrary.saveDesign(`Copy ${i}`,window.clothingStorage.createProject())));});
 const cap=await Promise.all([page,other].map((p,i)=>p.evaluate(async i=>{try{await window.clothingDesignLibrary.saveDesign(`Last ${i}`,window.clothingStorage.createProject());return true;}catch{return false;}},i)));
 expect(cap.filter(Boolean)).toHaveLength(1);expect(await page.evaluate(async()=>(await window.clothingDesignLibrary.listDesigns()).length)).toBe(12);
});
test('stale receipts and corrupt payloads refuse without deleting or overwriting other records',async({page})=>{
 await harness(page);const receipt=await page.evaluate(()=>window.clothingDesignLibrary.saveDesign('Keep',window.clothingStorage.createProject()));
 const result=await page.evaluate(async(receipt:DesignReceipt)=>{
  const api=window.clothingDesignLibrary;let read=false,remove=false;try{await api.readDesign({...receipt,name:'Wrong name'});}catch{read=true;}try{await api.deleteDesign({...receipt,name:'Wrong name'});}catch{remove=true;}
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('clothing-studio-designs',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('payloads','readwrite');tx.objectStore('payloads').put('{}',receipt.id);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  let corrupt=false;try{await api.readDesign(receipt);}catch{corrupt=true;}return{read,remove,corrupt,list:await api.listDesigns()};
 },receipt);expect(result.read&&result.remove&&result.corrupt).toBe(true);expect(result.list).toEqual([receipt]);
});
test('payload write failure rolls back its metadata and preserves earlier copies',async({page})=>{
 await harness(page);
 const result=await page.evaluate(async()=>{
  const api=window.clothingDesignLibrary,p=window.clothingStorage.createProject(),keep=await api.saveDesign('Keep',p),add=IDBObjectStore.prototype.add;
  IDBObjectStore.prototype.add=function(...args){if(this.name==='payloads')throw new DOMException('Injected quota failure','QuotaExceededError');return add.apply(this,args);};
  let failed=false;try{await api.saveDesign('Refused',p);}catch{failed=true;}finally{IDBObjectStore.prototype.add=add;}
  return{failed,rows:await api.listDesigns(),keep,project:await api.readDesign(keep)};
 });expect(result.failed).toBe(true);expect(result.rows).toEqual([result.keep]);expect(result.project.title).toBe('Untitled concept');
});
test('queued native transaction deadline aborts before a late write can publish',async({page})=>{
 await harness(page);await page.clock.install();
 const keep=await page.evaluate(()=>window.clothingDesignLibrary.saveDesign('Keep',window.clothingStorage.createProject()));
 await page.evaluate(async()=>{
  const state=window as unknown as{release:()=>void;libraryTxStarted:boolean;outcome:string};
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('clothing-studio-designs',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const blocker=db.transaction(['metadata','payloads'],'readwrite');let hold=true;
  const pump=()=>{const r=blocker.objectStore('metadata').get('hold');r.onsuccess=()=>{if(hold)pump();};};pump();
  state.release=()=>{hold=false;db.close();};state.libraryTxStarted=false;state.outcome='pending';
  const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);if(this.name==='clothing-studio-designs'&&args[1]==='readwrite')state.libraryTxStarted=true;return tx;};
  void window.clothingDesignLibrary.saveDesign('Must not publish',window.clothingStorage.createProject()).then(()=>{state.outcome='unexpected success';},error=>{state.outcome=String(error);}).finally(()=>{IDBDatabase.prototype.transaction=original;});
 });
 await expect.poll(()=>page.evaluate(()=>(window as unknown as{libraryTxStarted:boolean}).libraryTxStarted)).toBe(true);
 await page.clock.fastForward(10001);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as{outcome:string}).outcome)).toContain('timed out');
 await page.evaluate(()=>(window as unknown as{release:()=>void}).release());
 expect(await page.evaluate(()=>window.clothingDesignLibrary.listDesigns())).toEqual([keep]);
});
