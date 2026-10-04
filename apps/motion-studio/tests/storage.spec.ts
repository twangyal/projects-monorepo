import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

interface StorageTestWindow extends Window {
  __motionStorage: { holdNext: boolean; tracking: boolean; opens: number; release: (() => void) | null };
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Motion Studio', exact: true })).toBeVisible();
  await expect(page.locator('#project-title')).toBeVisible();
  await expect(page.locator('#save-status')).not.toContainText(/checking|loading|restoring|opening/i);
}

async function setTitle(page: Page, title: string): Promise<void> {
  await page.locator('#project-title').fill(title);
  await page.locator('#project-title').press('Tab');
}

async function readStored(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction('project', 'readonly');
        const request = transaction.objectStore('project').get('current');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

async function backup(page: Page): Promise<Record<string, unknown>> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#backup').click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as Record<string, unknown>;
}

test('local storage keeps one validated project and restores its complete saved state', async ({ page }) => {
  await ready(page);
  await setTitle(page, 'Saved motion idea');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const saved = await backup(page);
  expect(await readStored(page)).toEqual(saved);
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Saved motion idea');
  expect(await backup(page)).toEqual(saved);
  expect(await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction('project').objectStore('project').count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  })).toBe(1);
});

test('a delayed older save cannot overwrite a newer edit', async ({ page }) => {
  await page.addInitScript(() => {
    const observed = window as unknown as StorageTestWindow;
    observed.__motionStorage = { holdNext: false, tracking: false, opens: 0, release: null };
    const originalOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => {
      const request = originalOpen(name, version);
      const state = observed.__motionStorage;
      if (name !== 'motion-studio') return request;
      if (state.tracking) state.opens += 1;
      if (!state.holdNext) return request;
      state.holdNext = false;
      let callback: IDBOpenDBRequest['onsuccess'] = null;
      Object.defineProperty(request, 'onsuccess', {
        get: () => callback,
        set: (listener: IDBOpenDBRequest['onsuccess']) => {
          callback = listener;
          request.addEventListener('success', event => {
            state.release = () => { state.release = null; callback?.call(request, event); };
          }, { once: true });
        },
      });
      return request;
    };
  });
  await ready(page);
  // Finish an actual database read before arming the gate for the first write.
  await readStored(page);
  await page.clock.install();
  await page.evaluate(() => {
    const state = (window as unknown as StorageTestWindow).__motionStorage;
    state.holdNext = true; state.tracking = true; state.opens = 0;
  });
  await setTitle(page, 'Older pending save');
  await page.clock.runFor(1000);
  await expect.poll(() => page.evaluate(() => (window as unknown as StorageTestWindow).__motionStorage.release !== null)).toBe(true);
  try {
    await setTitle(page, 'Newer motion survives');
    await page.clock.runFor(1000);
    expect(await page.evaluate(() => (window as unknown as StorageTestWindow).__motionStorage.opens)).toBe(1);
  } finally {
    await page.evaluate(() => (window as unknown as StorageTestWindow).__motionStorage.release?.());
  }
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const stored = await readStored(page) as { title: string };
  expect(stored.title).toBe('Newer motion survives');
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Newer motion survives');
});

test('an invalid stored record is reported and preserved instead of silently replaced', async ({ page }) => {
  await ready(page);
  await setTitle(page, 'Valid before corruption');
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  const corrupt = { schemaVersion: 99, title: 'Unrecognized stored project' };
  await page.evaluate(async value => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motion-studio', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('project', 'readwrite');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore('project').put(value, 'current');
      });
    } finally { database.close(); }
  }, corrupt);
  await page.reload();
  await expect(page.locator('#message')).toContainText(/restore|saved project|backup/i);
  expect(await readStored(page)).toEqual(corrupt);
  await expect(page.locator('#project-title')).not.toHaveValue('Unrecognized stored project');
  await expect(page.locator('#project-title')).toBeEnabled();
  await page.clock.install();await setTitle(page,'New work stays in memory');await page.clock.runFor(1000);
  expect(await readStored(page)).toEqual(corrupt);
  await page.locator('#undo').click();await page.clock.runFor(1000);expect(await readStored(page)).toEqual(corrupt);await page.locator('#redo').click();
  const current=await backup(page);expect(current.title).toBe('New work stays in memory');
  await page.locator('#project-file').setInputFiles({name:'current.motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(current))});await expect(page.locator('#message')).toContainText('Project opened');await page.clock.runFor(1000);expect(await readStored(page)).toEqual(corrupt);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  page.once('dialog',d=>d.dismiss());await page.locator('#replace-saved-project').click();expect(await readStored(page)).toEqual(corrupt);
  await page.evaluate(()=>{const w=window as unknown as Window&{originalPut:IDBObjectStore['put']};w.originalPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw new DOMException('Quota full','QuotaExceededError');};});
  page.once('dialog',d=>d.accept());await page.locator('#replace-saved-project').click();await expect(page.locator('#message')).toContainText('original browser record remains protected');expect(await readStored(page)).toEqual(corrupt);await expect(page.locator('#replace-saved-project')).toBeVisible();
  await page.evaluate(()=>{IDBObjectStore.prototype.put=(window as unknown as Window&{originalPut:IDBObjectStore['put']}).originalPut;});
  page.once('dialog',d=>d.accept());await page.locator('#replace-saved-project').click();await expect(page.locator('#message')).toContainText('explicitly replaced');expect(await readStored(page)).toEqual(current);await expect(page.locator('#replace-saved-project')).toBeHidden();
  await page.reload();await expect(page.locator('#project-title')).toHaveValue('New work stays in memory');await expect(page.locator('#layer-name')).toBeEnabled();
});

test('blocked IndexedDB keeps the animation editable and JSON backup available', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await ready(page);
  await setTitle(page, 'Backup despite storage failure');
  await expect(page.locator('#save-status')).toContainText(/not saved|unavailable|failed/i);
  await expect(page.locator('#project-title')).toBeEnabled();
  const saved = await backup(page);
  expect(saved.title).toBe('Backup despite storage failure');
  expect(saved.schemaVersion).toBe(1);
  expect(Array.isArray(saved.layers)).toBe(true);
  expect(errors).toEqual([]);
});

test('schema creation failure is reported without an uncaught browser error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    IDBDatabase.prototype.createObjectStore = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
  });
  await ready(page);
  await expect(page.locator('#save-status')).toContainText('Local save unavailable');
  await expect(page.locator('#message')).toContainText('Storage quota exceeded');
  await setTitle(page, 'Editable after storage setup failed');
  await expect(page.locator('#save-status')).toContainText('Local save unavailable');
  expect((await backup(page)).title).toBe('Editable after storage setup failed');
  expect(errors).toEqual([]);
});


test('delayed startup restore locks mutations until the saved project is ready',async({page})=>{
  await ready(page);await setTitle(page,'Saved before delayed restore');await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await page.addInitScript(()=>{
    const original=indexedDB.open.bind(indexedDB);let hold=true;
    indexedDB.open=(name,version)=>{const request=original(name,version);if(name!=='motion-studio'||!hold)return request;hold=false;let callback:IDBOpenDBRequest['onsuccess']=null;
      Object.defineProperty(request,'onsuccess',{get:()=>callback,set:(listener:IDBOpenDBRequest['onsuccess'])=>{callback=listener;request.addEventListener('success',event=>{(window as unknown as Window&{releaseRestore:()=>void}).releaseRestore=()=>callback?.call(request,event);},{once:true});}});return request;
    };
  });
  await page.reload();await expect(page.locator('#project-title')).toBeDisabled();await expect(page.locator('#new-project')).toBeDisabled();await expect(page.locator('#project-file')).toBeDisabled();
  await expect.poll(()=>page.evaluate(()=>typeof (window as unknown as Window&{releaseRestore?:()=>void}).releaseRestore)).toBe('function');await page.evaluate(()=>(window as unknown as Window&{releaseRestore:()=>void}).releaseRestore());
  await expect(page.locator('#project-title')).toHaveValue('Saved before delayed restore');await expect(page.locator('#project-title')).toBeEnabled();expect((await readStored(page) as {title:string}).title).toBe('Saved before delayed restore');
});

test('undecodable saved artwork remains protected after editor changes',async({page})=>{
  await ready(page);const project=await backup(page);
  const bad=await page.evaluate(async project=>{
    const c=document.createElement('canvas');c.width=c.height=10;c.getContext('2d')!.fillRect(0,0,10,10);const data=c.toDataURL('image/png');const bytes=Uint8Array.from(atob(data.split(',')[1]),x=>x.charCodeAt(0));let cursor=8;
    while(cursor+12<=bytes.length){const size=new DataView(bytes.buffer).getUint32(cursor),name=String.fromCharCode(...bytes.subarray(cursor+4,cursor+8));if(name==='IDAT'){bytes.fill(0,cursor+8,cursor+8+size);break;}cursor+=size+12;}
    const p=project as {layers:{id:string;keys:unknown}[]};p.layers=[{...p.layers[0],id:'broken-image',name:'Broken image',kind:'image',image:{dataUrl:'data:image/png;base64,'+btoa(String.fromCharCode(...bytes)),width:10,height:10}} as unknown as typeof p.layers[0]];
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('motion-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise<void>((resolve,reject)=>{const t=db.transaction('project','readwrite');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.objectStore('project').put(p,'current');});}finally{db.close();}return p;
  },project);
  await page.reload();await expect(page.locator('#message')).toContainText('Existing browser data is protected');await expect(page.locator('#project-title')).toBeEnabled();await page.clock.install();await setTitle(page,'Working around a bad image');await page.clock.runFor(1000);expect(await readStored(page)).toEqual(bad);expect((await backup(page)).title).toBe('Working around a bad image');
});

test('a denied startup read remains protected after storage access returns',async({page})=>{
  await ready(page);await setTitle(page,'Original recoverable artwork');await expect(page.locator('#save-status')).toHaveText('Saved in this browser');const original=await readStored(page);
  await page.addInitScript(()=>{const w=window as unknown as Window&{originalIndexedDB:IDBFactory};w.originalIndexedDB=indexedDB;Object.defineProperty(window,'indexedDB',{configurable:true,get:()=>{throw new DOMException('Read denied','SecurityError');}});});
  await page.reload();await expect(page.locator('#message')).toContainText('Existing browser data is protected');await expect(page.locator('#project-title')).toBeEnabled();
  await page.evaluate(()=>Object.defineProperty(window,'indexedDB',{configurable:true,value:(window as unknown as Window&{originalIndexedDB:IDBFactory}).originalIndexedDB}));
  await page.clock.install();await setTitle(page,'Replacement still requires consent');await page.clock.runFor(1000);expect(await readStored(page)).toEqual(original);expect((await backup(page)).title).toBe('Replacement still requires consent');
  page.once('dialog',d=>d.accept());await page.locator('#replace-saved-project').click();await expect(page.locator('#message')).toContainText('explicitly replaced');expect((await readStored(page) as {title:string}).title).toBe('Replacement still requires consent');
});

test('explicitly saving the untouched recovery demo reports a completed native save',async({page})=>{
  await ready(page);
  await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('motion-studio',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise<void>((resolve,reject)=>{const t=db.transaction('project','readwrite');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.objectStore('project').put({schemaVersion:99},'current');});}finally{db.close();}});
  await page.reload();await expect(page.locator('#message')).toContainText('Existing browser data is protected');const current=await backup(page);
  page.once('dialog',d=>d.accept());await page.locator('#replace-saved-project').click();await expect(page.locator('#save-status')).toHaveText('Saved in this browser');expect(await readStored(page)).toEqual(current);
});
