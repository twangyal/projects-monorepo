import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function stored(page:Page, value?:unknown):Promise<unknown>{return page.evaluate(async({value,write})=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('clothing-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<unknown>((resolve,reject)=>{const t=db.transaction('project',write?'readwrite':'readonly'),s=t.objectStore('project');if(write){s.put(value,'current');t.oncomplete=()=>resolve(value);}else{const r=s.get('current');r.onsuccess=()=>resolve(r.result);}t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}finally{db.close();}
},{value,write:value!==undefined});}
async function title(page:Page,value:string){await page.getByLabel('Concept name').fill(value);await page.getByLabel('Concept name').press('Tab');}
async function backup(page:Page){const next=page.waitForEvent('download');await page.locator('#backup').click();return JSON.parse(await readFile((await(await next).path())!,'utf8'));}
test('failed startup record survives a first concept edit',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');const raw={schemaVersion:99,title:'Original malformed concept',note:'Preserve me'};await stored(page,raw);await page.reload();await expect(page.locator('#message')).toContainText('Could not restore');await page.clock.install();await title(page,'New work in memory');await page.clock.runFor(1000);expect(await stored(page)).toEqual(raw);
});
test('schema creation failure leaves recovery usable without an uncaught page error',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{IDBDatabase.prototype.createObjectStore=()=>{throw new DOMException('No room for store','QuotaExceededError');};});await page.goto('/');await expect(page.locator('#save-state')).toContainText(/unavailable|protected/i);await title(page,'Backup after setup failed');expect((await backup(page)).title).toBe('Backup after setup failed');expect(errors).toEqual([]);
});
