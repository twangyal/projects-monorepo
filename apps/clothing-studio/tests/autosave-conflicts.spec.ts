import {test,expect,type Page} from './helpers/expanded-workspace.ts';
import {readFile} from 'node:fs/promises';

async function rename(page:Page,title:string){await page.getByLabel('Concept name').fill(title);await page.getByLabel('Concept name').press('Tab');}
async function saved(page:Page){return page.evaluate(()=>new Promise<unknown>((resolve,reject)=>{const open=indexedDB.open('clothing-studio');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('project'),get=tx.objectStore('project').get('current');get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};}));}
async function holdOpen(page:Page){await page.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);let first=true;indexedDB.open=(name,version)=>{const request=original(name,version);if(name!=='clothing-studio'||!first)return request;first=false;let callback:IDBOpenDBRequest['onsuccess']=null;Object.defineProperty(request,'onsuccess',{get:()=>callback,set:listener=>{callback=listener;request.addEventListener('success',event=>Object.assign(window,{releaseAutosave:()=>callback?.call(request,event)}),{once:true});}});return request;};});}
async function releaseOpen(page:Page){await expect.poll(()=>page.evaluate(()=>typeof Reflect.get(window,'releaseAutosave'))).toBe('function');await page.evaluate(()=>{Reflect.get(window,'releaseAutosave')();Reflect.deleteProperty(window,'releaseAutosave');});}

for(const width of [1280,390])test(`stale autosave preserves both designs until deliberate replacement at ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:900});await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');
  await rename(page,'Shared starting design');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('Concept name')).toHaveValue('Shared starting design');
  await rename(page,'Newer design from first tab');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const winner=await saved(page);
  await rename(other,'Current work in second tab');await expect(other.locator('#save-state')).toContainText('previous concept protected');
  expect(await saved(other)).toEqual(winner);await expect(other.getByLabel('Concept name')).toHaveValue('Current work in second tab');
  const download=other.waitForEvent('download');await other.locator('#backup').click();
  expect(JSON.parse(await readFile((await(await download).path())!,'utf8')).title).toBe('Current work in second tab');
  await rename(other,'Still editable after conflict');expect(await saved(other)).toEqual(winner);
  other.once('dialog',dialog=>dialog.dismiss());await other.locator('#replace-saved').click();expect(await saved(other)).toEqual(winner);
  other.once('dialog',dialog=>dialog.accept());await other.locator('#replace-saved').click();await expect(other.locator('#save-state')).toHaveText('Locally saved');
  expect((await saved(other) as {title:string}).title).toBe('Still editable after conflict');
  await rename(page,'First tab is now stale');await expect(page.locator('#save-state')).toContainText('previous concept protected');
  expect((await saved(page) as {title:string}).title).toBe('Still editable after conflict');
  await other.close();
});

test('migration keeps a legacy project and refuses a legacy writer after migration',async({page})=>{
  await page.goto('/tests/storage-harness.html');await expect.poll(()=>page.evaluate(()=>!!window.clothingStorage)).toBe(true);
  const original=await page.evaluate(()=>{const p=window.clothingStorage.createProject();p.title='Legacy concept kept';return p;});
  await page.evaluate(p=>new Promise<void>((resolve,reject)=>{const open=indexedDB.open('clothing-studio',1);open.onupgradeneeded=()=>open.result.createObjectStore('project');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('project','readwrite');tx.objectStore('project').put(p,'current');tx.oncomplete=()=>{db.close();resolve();};};}),original);
  await page.goto('/');await expect(page.getByLabel('Concept name')).toHaveValue('Legacy concept kept');expect(await saved(page)).toEqual(original);
  const result=await page.evaluate(()=>new Promise<string>(resolve=>{const open=indexedDB.open('clothing-studio',1);open.onerror=()=>resolve(open.error?.name??'error');open.onsuccess=()=>{open.result.close();resolve('unexpected success');};}));
  expect(result).toBe('VersionError');
});

test('a newer save after replacement preparation still wins',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');await rename(page,'Original');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('Concept name')).toHaveValue('Original');
  await rename(page,'First newer save');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await rename(other,'Current conflicting work');await expect(other.locator('#save-state')).toContainText('previous concept protected');
  const pending=other.waitForEvent('dialog');const click=other.locator('#replace-saved').click();const dialog=await pending;
  await rename(page,'Saved while replacement prompt was open');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await dialog.accept();await click;await expect(other.locator('#save-state')).toContainText('previous concept protected');
  expect((await saved(other) as {title:string}).title).toBe('Saved while replacement prompt was open');
  await expect(other.getByLabel('Concept name')).toHaveValue('Current conflicting work');await other.close();
});

test('native clear and recreation fence a stale writer even when project content returns to the original',async({page,context})=>{
  await page.goto('/tests/storage-harness.html');await expect.poll(()=>page.evaluate(()=>!!window.clothingStorage)).toBe(true);
  const original=await page.evaluate(async()=>{const p=window.clothingStorage.createProject();p.title='Same words before and after';await window.clothingStorage.loadProject();await window.clothingStorage.saveProject(p);return p;});
  const other=await context.newPage();await other.goto('/tests/storage-harness.html');await expect.poll(()=>other.evaluate(()=>!!window.clothingStorage)).toBe(true);
  expect(await other.evaluate(()=>window.clothingStorage.loadProject())).toEqual(original);
  await page.evaluate(async p=>{await window.clothingStorage.clearProject();await window.clothingStorage.saveProject(p);},original);
  const refused=await other.evaluate(async()=>{const p=window.clothingStorage.createProject();p.title='Stale replacement';try{await window.clothingStorage.saveProject(p);return false;}catch{return true;}});
  expect(refused).toBe(true);expect(await saved(page)).toEqual(original);await other.close();
});

test('editing while a replacement revision is being read requires a fresh decision',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');await rename(page,'Original');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('Concept name')).toHaveValue('Original');
  await rename(page,'Saved winner');await expect(page.locator('#save-state')).toHaveText('Locally saved');await rename(other,'Conflicting current work');await expect(other.locator('#save-state')).toContainText('previous concept protected');
  await other.evaluate(()=>{const original=indexedDB.open.bind(indexedDB);let first=true;indexedDB.open=(name,version)=>{const request=original(name,version);if(name!=='clothing-studio'||!first)return request;first=false;let callback:IDBOpenDBRequest['onsuccess']=null;Object.defineProperty(request,'onsuccess',{get:()=>callback,set:listener=>{callback=listener;request.addEventListener('success',event=>Object.assign(window,{releaseRevisionRead:()=>callback?.call(request,event)}),{once:true});}});return request;};});
  await other.locator('#replace-saved').click();await expect.poll(()=>other.evaluate(()=>typeof Reflect.get(window,'releaseRevisionRead'))).toBe('function');
  await rename(other,'Newer current work during revision read');await other.evaluate(()=>Reflect.get(window,'releaseRevisionRead')());
  await expect(other.locator('#message')).toContainText('Newer current edits were kept');expect((await saved(page) as {title:string}).title).toBe('Saved winner');
  await expect(other.getByLabel('Concept name')).toHaveValue('Newer current work during revision read');await other.close();
});

test('conflict and replacement status preserve focused raw placement fields and editor intent',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');await rename(page,'Original');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('Concept name')).toHaveValue('Original');
  await rename(page,'Winner');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await holdOpen(other);await rename(other,'Stale pending save');await expect.poll(()=>other.evaluate(()=>typeof Reflect.get(window,'releaseAutosave'))).toBe('function');
  await other.locator('#position-x').fill('');await releaseOpen(other);
  await expect(other.locator('#save-state')).toContainText('previous concept protected');await expect(other.locator('#position-x')).toHaveValue('');await expect(other.locator('#position-x')).toBeFocused();
  await holdOpen(other);let prompts=0;other.on('dialog',dialog=>{prompts++;void dialog.dismiss();});await other.locator('#replace-saved').click();
  await expect.poll(()=>other.evaluate(()=>typeof Reflect.get(window,'releaseAutosave'))).toBe('function');await other.locator('#position-x').fill('37.0');await releaseOpen(other);
  await expect(other.locator('#message')).toContainText('Newer current edits were kept');await expect(other.locator('#position-x')).toHaveValue('37.0');await expect(other.locator('#position-x')).toBeFocused();expect(prompts).toBe(0);
  expect((await saved(page) as {title:string}).title).toBe('Winner');await other.close();
});

test('autosave and cross-tab protection work when randomUUID is unavailable',async({page,context})=>{
  await context.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
  await rename(page,'Fallback token saved');await expect(page.locator('#save-state')).toHaveText('Locally saved');await page.reload();await expect(page.getByLabel('Concept name')).toHaveValue('Fallback token saved');
  const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('Concept name')).toHaveValue('Fallback token saved');
  await rename(page,'Fallback winner');await expect(page.locator('#save-state')).toHaveText('Locally saved');await rename(other,'Fallback stale draft');await expect(other.locator('#save-state')).toContainText('previous concept protected');
  expect((await saved(page) as {title:string}).title).toBe('Fallback winner');await expect(other.getByLabel('Concept name')).toHaveValue('Fallback stale draft');await other.close();
});

test('entering protection retires an older debounce before confirmed replacement',async({page,context})=>{
  await page.goto('/');await expect(page.locator('#save-state')).not.toContainText('Checking');await rename(page,'Original');await expect(page.locator('#save-state')).toHaveText('Locally saved');
  const other=await context.newPage();await other.goto('/');await expect(other.getByLabel('Concept name')).toHaveValue('Original');
  await rename(page,'Winner');await expect(page.locator('#save-state')).toHaveText('Locally saved');await other.clock.install();await other.clock.pauseAt(new Date());await holdOpen(other);await rename(other,'Held stale edit');await other.clock.runFor(250);
  await expect.poll(()=>other.evaluate(()=>typeof Reflect.get(window,'releaseAutosave'))).toBe('function');await rename(other,'Latest current edit waiting for debounce');await releaseOpen(other);await expect(other.locator('#save-state')).toContainText('previous concept protected');
  other.once('dialog',dialog=>dialog.accept());await other.locator('#replace-saved').click();await expect(other.locator('#save-state')).toHaveText('Locally saved');
  const revision=()=>other.evaluate(()=>new Promise<unknown>(resolve=>{const open=indexedDB.open('clothing-studio');open.onsuccess=()=>{const db=open.result,tx=db.transaction('project'),get=tx.objectStore('project').get('current-revision');get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};}));
  const confirmed=await revision();await other.clock.runFor(1000);expect(await revision()).toBe(confirmed);expect((await saved(other) as {title:string}).title).toBe('Latest current edit waiting for debounce');await other.close();
});
