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
  await page.locator('#undo').click();await page.clock.runFor(1000);expect(await stored(page)).toEqual(raw);await page.locator('#redo').click();const current=await backup(page);expect(current.title).toBe('New work in memory');
  await page.getByLabel('Import project backup').setInputFiles({name:'current.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});await expect(page.locator('#message')).toContainText('backup restored');await page.clock.runFor(1000);expect(await stored(page)).toEqual(raw);await expect(page.locator('#replace-saved')).toBeEnabled();
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){HTMLCanvasElement.prototype.toBlob=original;(window as unknown as Window&{releasePNG:()=>void}).releasePNG=()=>original.call(this,callback,type,quality);};});
  const png=page.waitForEvent('download');await page.locator('#garment-png').click();await expect.poll(()=>page.evaluate(()=>typeof(window as unknown as Window&{releasePNG?:()=>void}).releasePNG)).toBe('function');await title(page,'Temporary edit during export');await expect(page.locator('#replace-saved')).toBeDisabled();await page.evaluate(()=>(window as unknown as Window&{releasePNG:()=>void}).releasePNG());expect((await readFile((await(await png).path())!)).length).toBeGreaterThan(100);await expect(page.locator('#replace-saved')).toBeEnabled();await title(page,'New work in memory');
  page.once('dialog',d=>d.dismiss());await page.locator('#replace-saved').click();expect(await stored(page)).toEqual(raw);
  await page.evaluate(()=>{const w=window as unknown as Window&{oldPut:IDBObjectStore['put']};w.oldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('Quota full','QuotaExceededError');};});page.once('dialog',d=>d.accept());await page.locator('#replace-saved').click();await expect(page.locator('#message')).toContainText('remains protected');expect(await stored(page)).toEqual(raw);
  await page.evaluate(()=>{IDBObjectStore.prototype.put=(window as unknown as Window&{oldPut:IDBObjectStore['put']}).oldPut;});page.once('dialog',d=>d.accept());await page.locator('#replace-saved').click();await expect(page.locator('#save-state')).toHaveText('Locally saved');expect(await stored(page)).toEqual(current);await expect(page.locator('#replace-saved')).toBeHidden();await page.reload();await expect(page.getByLabel('Concept name')).toHaveValue('New work in memory');
});
test('schema creation failure leaves recovery usable without an uncaught page error',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{IDBDatabase.prototype.createObjectStore=()=>{throw new DOMException('No room for store','QuotaExceededError');};});await page.goto('/');await expect(page.locator('#save-state')).toContainText(/unavailable|protected/i);await title(page,'Backup after setup failed');expect((await backup(page)).title).toBe('Backup after setup failed');expect(errors).toEqual([]);
});


test('edits during a pending explicit replacement save the latest concept afterward',async({page})=>{
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');await stored(page,{schemaVersion:99});await page.reload();await expect(page.locator('#message')).toContainText('Could not restore');await title(page,'First confirmed replacement');
  await page.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);let hold=true;indexedDB.open=(name,version)=>{const r=original(name,version);if(name!=='clothing-studio'||!hold)return r;hold=false;let callback:IDBOpenDBRequest['onsuccess']=null;Object.defineProperty(r,'onsuccess',{get:()=>callback,set:(listener:IDBOpenDBRequest['onsuccess'])=>{callback=listener;r.addEventListener('success',e=>{(window as unknown as Window&{releaseSave:()=>void}).releaseSave=()=>callback?.call(r,e);},{once:true});}});return r;};});
  page.once('dialog',d=>d.accept());await page.locator('#replace-saved').click();await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as Window&{releaseSave?:()=>void}).releaseSave)).toBe('function');await title(page,'Latest edit survives replacement');
  await page.evaluate(()=>(window as unknown as Window&{releaseSave:()=>void}).releaseSave());await expect(page.locator('#save-state')).toHaveText('Locally saved');expect((await stored(page) as {title:string}).title).toBe('Latest edit survives replacement');await page.reload();await expect(page.getByLabel('Concept name')).toHaveValue('Latest edit survives replacement');
});

for (const surface of ['sketch-surface', 'preview-surface']) test(`replacement saves committed edits without reviving canceled ${surface} gestures`, async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#save-state')).not.toContainText('Checking');
  await stored(page, { schemaVersion: 99 }); await page.reload();
  await expect(page.locator('#message')).toContainText('Could not restore');
  await title(page, 'Confirmed replacement');
  await page.evaluate(() => {
    const original = indexedDB.open.bind(indexedDB); let first = true;
    indexedDB.open = (name, version) => {
      const request = original(name, version);
      if (name !== 'clothing-studio' || !first) return request;
      first = false; let callback: IDBOpenDBRequest['onsuccess'] = null;
      Object.defineProperty(request, 'onsuccess', { get: () => callback, set: listener => {
        callback = listener; request.addEventListener('success', event => {
          Object.assign(window, { releaseGestureSave: () => callback?.call(request, event) });
        }, { once: true });
      } });
      return request;
    };
  });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#replace-saved').click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { releaseGestureSave: unknown }).releaseGestureSave)).toBe('function');
  await title(page, 'Committed edit during replacement');
  const committed = await backup(page);
  await page.clock.install();
  const target = page.locator(`#${surface}`), box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 4 });
  if (surface === 'sketch-surface') await expect(page.locator('#stroke-count')).toHaveText('1 stroke');
  await page.evaluate(() => (window as unknown as { releaseGestureSave: () => void }).releaseGestureSave());
  // Wait for replacement completion to schedule its follow-up snapshot while
  // the native gesture still has transient state; cancel before the debounce.
  await expect(page.locator('#message')).toContainText('explicitly replaced');
  await target.dispatchEvent('pointercancel'); await page.mouse.up();
  await page.clock.runFor(1000); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  expect(await stored(page)).toEqual(committed);
  await page.reload(); await expect(page.getByLabel('Concept name')).toHaveValue(committed.title);
  expect(await backup(page)).toEqual(committed);
});
