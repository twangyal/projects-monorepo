import { expect, test, chromium, type Page, type Download } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { rawProject, scalar, TINY, literalRaster, originalPng } from '../oracle/color-fixtures.ts';
import type { Project, Raster } from '../../src/types.ts';

const DB = 'color-context-lab.v1';
async function fileBytes(file: Download) { const path=await file.path();if(!path)throw new Error('Expected a native downloaded file.');return readFile(path); }
async function download(page:Page,id:string) {
  await expect(page.locator(id)).toBeEnabled();const pending=page.waitForEvent('download',{timeout:10000});await page.locator(id).click();return fileBytes(await pending);
}
async function backup(page:Page):Promise<Project> { return JSON.parse((await download(page,'#download-project')).toString('utf8')) as Project; }
async function saved(page:Page) { await expect(page.locator('#save-status')).toContainText(/Saved/i);await expect(page.locator('#save-status')).not.toContainText(/Not saved|unsaved/i); }
async function open(page:Page,project=rawProject()) {
  await expect(page.locator('#project-file')).toBeEnabled();await page.locator('#project-file').setInputFiles({name:'original-color-project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#project-title')).toHaveValue(project.title);await expect(page.locator('#preview-status')).toHaveText('Applied settings preview ready.');await expect(page.locator('#metrics')).toContainText('Artwork pixels unchanged');
}
async function imported(page:Page,raster:Raster,name='original-test.png') {
  await expect(page.locator('#image-file')).toBeEnabled();await page.locator('#image-file').setInputFiles({name,mimeType:'image/png',buffer:originalPng(raster)});
  await expect(page.locator('#source-info')).toContainText(name);await expect(page.locator('#preview-status')).toHaveText('Applied settings preview ready.');
  expect((await backup(page)).image.source.fileName).toBe(name);
}
function expectPng(bytes:Buffer,raster:Raster) {const actual=PNG.sync.read(bytes);expect(actual.width).toBe(raster.width);expect(actual.height).toBe(raster.height);expect(actual.data).toEqual(Buffer.from(raster.rgba));}
async function rawRecord(page:Page,write?:{value:unknown}) {
  return page.evaluate(({name,write})=>new Promise<{present:boolean;value:unknown}>((resolve,reject)=>{
    const request=indexedDB.open(name,1);request.onerror=()=>reject(request.error);request.onupgradeneeded=()=>request.result.createObjectStore('projects');
    request.onsuccess=()=>{const db=request.result,tx=db.transaction('projects',write?'readwrite':'readonly'),store=tx.objectStore('projects');let present=false,value:unknown;
      if(write){store.put(write.value,'current');present=true;value=write.value;}
      else{const key=store.getKey('current'),read=store.get('current');key.onsuccess=()=>{present=key.result!==undefined;};read.onsuccess=()=>{value=read.result;};}
      tx.oncomplete=()=>{db.close();resolve({present,value});};tx.onabort=()=>{db.close();reject(tx.error);};
    };
  }),{name:DB,write});
}
interface Control { gate:string|null;held:string|null;release:(()=>void)|null;holdLoad:boolean;releaseLoad:(()=>void)|null;aborted:number;abort:boolean;terminations:number }
type ProbeWindow=Window&{__colorNative:Control};
async function installNative(page:Page) {
  await page.addInitScript(()=>{
    const control:Control={gate:new URL(location.href).searchParams.has('native-test-hold-load')?'load':null,held:null,release:null,holdLoad:false,releaseLoad:null,aborted:0,abort:false,terminations:0};(window as unknown as ProbeWindow).__colorNative=control;
    const fileRead=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=function(){return fileRead.call(this).then(bytes=>this.name==='held-color.json'&&control.gate==='file'?new Promise<ArrayBuffer>(resolve=>{control.held='file';control.release=()=>{control.gate=null;control.held=null;control.release=null;resolve(bytes);};}):bytes);};
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.addEventListener('message',event=>{if(control.gate!=='worker')return;event.stopImmediatePropagation();control.held='worker';control.release=()=>{control.gate=null;control.held=null;control.release=null;this.dispatchEvent(new MessageEvent('message',{data:event.data}));};});}
      terminate(){control.terminations++;super.terminate();}
    };
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){const request=key===undefined?put.call(this,value):put.call(this,value,key);if(control.abort&&this.transaction.db.name==='color-context-lab.v1'){control.abort=false;request.addEventListener('success',()=>{control.aborted++;this.transaction.abort();},{once:true});}return request;};
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(names:string|string[],mode?:IDBTransactionMode,options?:IDBTransactionOptions){const tx=transaction.call(this,names,mode,options),phase=mode==='readonly'?'load':'save';
      if(this.name==='color-context-lab.v1'&&(control.gate===phase||(phase==='load'&&control.holdLoad))){control.held=phase;
        const finish=()=>{control.holdLoad=false;if(control.gate===phase)control.gate=null;if(control.held===phase)control.held=null;if(control.release===finish)control.release=null;control.releaseLoad=null;};
        control.release=finish;if(phase==='load')control.releaseLoad=finish;
        const alive=()=>{if(control.gate!==phase&&!(phase==='load'&&control.holdLoad))return;const request=tx.objectStore('projects').get('current');request.addEventListener('success',alive,{once:true});};alive();}return tx;};
  });
}
async function gate(page:Page,name:string){await page.evaluate(name=>{(window as unknown as ProbeWindow).__colorNative.gate=name;},name);}
async function held(page:Page,name:string){await expect.poll(()=>page.evaluate(()=>(window as unknown as ProbeWindow).__colorNative.held)).toBe(name);}
async function release(page:Page){await page.evaluate(()=>(window as unknown as ProbeWindow).__colorNative.release?.());await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function apply(page:Page){await page.locator('#apply-changes').click();await expect(page.locator('#preview-status')).toHaveText('Applied settings preview ready.');await expect(page.locator('#metrics')).toContainText('Artwork pixels unchanged');}
const observed=new WeakMap<Page,{errors:string[];external:string[]}>();
test.beforeEach(async({page,baseURL})=>{page.on('dialog',dialog=>dialog.accept());const data={errors:[] as string[],external:[] as string[]};observed.set(page,data);page.on('pageerror',error=>data.errors.push(error.message));page.on('request',request=>{if(!['data:','blob:'].some(prefix=>request.url().startsWith(prefix))&&new URL(request.url()).origin!==new URL(baseURL!).origin)data.external.push(request.url());});});
test.afterEach(async({page})=>{expect(observed.get(page)?.errors).toEqual([]);expect(observed.get(page)?.external).toEqual([]);});


test('new artist workspace exposes the real Import PNG control', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Import PNG', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Normalized original · neutral surround', exact: true })).toBeVisible();
});

test('real opaque PNG import creates normalized artwork and explicit Apply drives exact source/result/project exports',async({page})=>{
  await page.goto('/');const raster=literalRaster(10,8);for(let i=3;i<raster.rgba.length;i+=4)raster.rgba[i]=255;
  await imported(page,raster);const before=await backup(page);expect(Buffer.from(before.image.rgba,'base64')).toEqual(Buffer.from(raster.rgba));
  await page.locator('#surround-mode').selectOption('checker');await page.locator('#border-size').fill('005');await page.locator('#color-a').fill('#ff0000');await page.locator('#color-b').fill('#0000ff');await page.locator('#cell-size').fill('4');
  await expect(page.locator('#download-result')).toBeDisabled();await expect(page.locator('#download-report')).toBeDisabled();expect(await backup(page)).toEqual(before);
  await apply(page);const project=await backup(page);expect(project.settings).toEqual({mode:'checker',border:5,colorA:'#ff0000',colorB:'#0000ff',cellSize:4});
  expectPng(await download(page,'#download-source'),{width:10,height:8,rgba:raster.rgba});expectPng(await download(page,'#download-result'),scalar(project).result);
  await page.locator('#undo').click();expect(await backup(page)).toEqual(before);await page.locator('#redo').click();expect(await backup(page)).toEqual(project);
  await saved(page);expect(JSON.parse((await rawRecord(page)).value as string)).toEqual(project);await page.reload();expect(await backup(page)).toEqual(project);
});

test('canonical raw low-alpha pixels survive exact PNG and embedded report exports without using presentation Canvas',async({page})=>{
  const original=rawProject({border:5,mode:'checker',colorA:'#ffffff',colorB:'#000000',cellSize:4});await page.goto('/');await open(page,original);expect(await backup(page)).toEqual(original);
  expectPng(await download(page,'#download-source'),{width:3,height:2,rgba:TINY});expectPng(await download(page,'#download-result'),scalar(original).result);
  const report=(await download(page,'#download-report')).toString('utf8');expect(report).toContain(createHash('sha256').update(TINY).digest('hex'));
  expect(report).not.toContain('<script>');expect(report).not.toContain('<img src=x>');expect(report).toContain('default-src');
  const embedded=[...report.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];expect(embedded).toHaveLength(2);
  expectPng(Buffer.from(embedded[0]![1]!,'base64'),scalar(original).baseline);expectPng(Buffer.from(embedded[1]![1]!,'base64'),scalar(original).result);
  await saved(page);await page.reload();expect(await backup(page)).toEqual(original);
});

test('transparent PNG file imports retain its first normalized raster honestly rather than claiming encoded-source equivalence',async({page})=>{
  await page.goto('/');await imported(page,{width:3,height:2,rgba:TINY},'transparent-original.png');const normalized=await backup(page);
  expect(normalized.image.source).toEqual({fileName:'transparent-original.png',format:'png',width:3,height:2});expect(normalized.image.width).toBe(3);expect(normalized.image.height).toBe(2);
  expectPng(await download(page,'#download-source'),{width:3,height:2,rgba:new Uint8ClampedArray(Buffer.from(normalized.image.rgba,'base64'))});
  await expect(page.locator('body')).toContainText(/normalized|normalization/i);await expect(page.locator('body')).toContainText(/keep.*original|original.*not retained/i);
});

test('invalid raw numeric spelling and active caret survive genuine delayed save completion; drafts never enter exports',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);await gate(page,'save');
  await page.locator('#project-title').fill('A committed title');await apply(page);await held(page,'save');const current=await backup(page);
  await page.locator('#border-size').fill('');await page.locator('#border-size').focus();await release(page);await saved(page);
  await expect(page.locator('#border-size')).toHaveValue('');await expect(page.locator('#border-size')).toBeFocused();
  expect(await backup(page)).toEqual(current);await expect(page.locator('#download-result')).toBeDisabled();await expect(page.locator('#download-report')).toBeDisabled();
  await page.locator('#undo').click();expect(await backup(page)).toEqual(current);await expect(page.locator('#border-size')).toHaveValue('');
  await page.locator('#discard-changes').click();await expect(page.locator('#border-size')).toHaveValue(String(current.settings.border));await expect(page.locator('#download-result')).toBeEnabled();
});

test('a real delayed complete File is permanently invalidated by changed-back input and keeps current drafts/history',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);const current=await backup(page);await gate(page,'file');
  await page.locator('#project-file').setInputFiles({name:'held-color.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...rawProject(),title:'Never publish late project'}))});await held(page,'file');
  await page.locator('#project-title').fill('Unsent replacement guard');await page.locator('#project-title').fill(current.title);await release(page);
  expect(await backup(page)).toEqual(current);await expect(page.locator('#project-title')).toHaveValue(current.title);
  await page.locator('#project-file').setInputFiles({name:'bad-utf8.json',mimeType:'application/json',buffer:Buffer.from([0xff,0xfe,123,125])});
  await expect(page.locator('#error')).toBeVisible();expect(await backup(page)).toEqual(current);
});

test('Stop and retired real worker events cannot publish imported artwork or obsolete export downloads',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);const original=await backup(page),oldSaved=await rawRecord(page);await gate(page,'worker');
  await page.locator('#image-file').setInputFiles({name:'retired-real-image.png',mimeType:'image/png',buffer:originalPng(literalRaster(7,9))});await held(page,'worker');
  await page.locator('#stop-job').click();await release(page);expect(await backup(page)).toEqual(original);expect(await rawRecord(page)).toEqual(oldSaved);
  const downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));await gate(page,'worker');await page.locator('#download-report').click();await held(page,'worker');
  await page.locator('#project-title').fill('Temporary export intent');await page.locator('#project-title').fill(original.title);await release(page);
  expect(downloads).toEqual([]);await expect(page.locator('#download-report')).toBeDisabled();expect((await backup(page)).image).toEqual(original.image);
});

test('real transaction request success is not save success and Retry saving restores only the complete applied project',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);const original=await rawRecord(page);
  await page.evaluate(()=>(window as unknown as ProbeWindow).__colorNative.abort=true);await page.locator('#project-title').fill('Unsaved applied project');await apply(page);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as ProbeWindow).__colorNative.aborted)).toBe(1);await expect(page.locator('#save-status')).toContainText(/not saved|unsaved/i);expect(await rawRecord(page)).toEqual(original);
  const memory=await backup(page);await page.locator('#retry-save').click();await saved(page);expect(JSON.parse((await rawRecord(page)).value as string)).toEqual(memory);await page.reload();expect(await backup(page)).toEqual(memory);
});

test('protected corrupt storage allows explicit memory-only work and durable-only clear without autosave resurrection',async({page})=>{
  await page.goto('/');await open(page);await saved(page);const raw='{"schemaVersion":99,"untrusted":"preserve exact recovery"}';await rawRecord(page,{value:raw});await page.reload();
  await expect(page.locator('#continue-unsaved')).toBeVisible();expect((await download(page,'#raw-backup')).toString('utf8')).toBe(raw);await page.locator('#continue-unsaved').click();
  await page.locator('#project-title').fill('Explicit memory-only edit');await apply(page);expect((await rawRecord(page)).value).toBe(raw);
  const applied=await backup(page);await page.locator('#project-title').fill('Keep this unapplied title');await page.locator('#save-current').click();await saved(page);
  expect(JSON.parse((await rawRecord(page)).value as string)).toEqual(applied);await expect(page.locator('#project-title')).toHaveValue('Keep this unapplied title');
  await page.locator('#clear-saved').click();await expect.poll(async()=>(await rawRecord(page)).present).toBe(false);expect(await backup(page)).toEqual(applied);await expect(page.locator('#project-title')).toHaveValue('Keep this unapplied title');
  await apply(page);expect((await rawRecord(page)).present).toBe(false);
});

test('stored null is corrupt presence and Continue without saving never overwrites it with the procedural demo',async({page})=>{
  await page.goto('/');await expect(page.locator('#project-file')).toBeEnabled();await rawRecord(page,{value:null});await page.reload();
  await expect(page.locator('#continue-unsaved')).toBeVisible();await page.locator('#continue-unsaved').click();await page.locator('#project-title').fill('Still not replacing null');await apply(page);
  expect(await rawRecord(page)).toEqual({present:true,value:null});
});

test('startup remains mutation-locked throughout an actual held readonly transaction even if Stop is clicked',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);const original=await backup(page);
  // A test-only URL flag controls native transaction timing, never project values.
  await page.goto('/?native-test-hold-load=1');await held(page,'load');
  const stop=page.locator('#stop-job');if(await stop.isVisible()&&await stop.isEnabled())await stop.click();
  await expect(page.locator('#apply-changes')).toBeDisabled();await expect(page.locator('#image-file')).toBeDisabled();await expect(page.locator('#project-file')).toBeDisabled();
  await release(page);await expect(page.locator('#project-title')).toHaveValue(original.title);expect(await backup(page)).toEqual(original);
});

test('clear queues after an admitted native write and never deletes current history/raw drafts or recreates the saved key',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);await gate(page,'save');await page.locator('#project-title').fill('Applied while write is held');await apply(page);await held(page,'save');
  const memory=await backup(page);await page.locator('#border-size').fill('');await page.locator('#clear-saved').click();await release(page);
  await expect.poll(async()=>(await rawRecord(page)).present).toBe(false);expect(await backup(page)).toEqual(memory);await expect(page.locator('#border-size')).toHaveValue('');
  await page.locator('#discard-changes').click();await page.locator('#project-title').fill('Later protected edit');await apply(page);expect((await rawRecord(page)).present).toBe(false);
});

test('a real persistent Chromium process restart restores exact raw pixels/settings and no unsent field',async({baseURL,launchOptions})=>{
  const profile=await mkdtemp(join(tmpdir(),'color70-persistent-'));let context=await chromium.launchPersistentContext(profile,{...launchOptions,headless:true,acceptDownloads:true});
  try{let page=context.pages()[0]!;page.on('dialog',dialog=>dialog.accept());await page.goto(baseURL!);await open(page);await page.locator('#border-size').fill('7');await apply(page);await saved(page);const project=await backup(page),raw=await rawRecord(page);
    await context.close();context=await chromium.launchPersistentContext(profile,{...launchOptions,headless:true,acceptDownloads:true});page=context.pages()[0]!;await page.goto(baseURL!);await expect(page.locator('#project-title')).toHaveValue(project.title);
    expect(await backup(page)).toEqual(project);expect(await rawRecord(page)).toEqual(raw);expectPng(await download(page,'#download-source'),{width:3,height:2,rgba:TINY});
  }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('thirty-state history trims only old edits and no-op Apply preserves redo and all retained raw pixels',async({page})=>{
  await page.goto('/');await open(page);for(let i=1;i<=35;i++){await page.locator('#project-title').fill(`Authored edit${i}`);await apply(page);}
  for(let i=0;i<29;i++)await page.locator('#undo').click();await expect(page.locator('#project-title')).toHaveValue('Authored edit6');await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#apply-changes').click();await expect(page.locator('#redo')).toBeEnabled();await page.locator('#redo').click();await expect(page.locator('#project-title')).toHaveValue('Authored edit7');expect((await backup(page)).image.rgba).toBe(Buffer.from(TINY).toString('base64'));
});

test('maximum canonical720-square input and976-square output produce complete independently decoded artifacts',async({page})=>{
  test.setTimeout(120000);const raster=literalRaster(720,720),project=rawProject({border:128,mode:'checker',colorA:'#ff0011',colorB:'#00ff77',cellSize:127},720,720,raster.rgba);
  await page.goto('/');await open(page,project);const projectBytes=await download(page,'#download-project');expect(JSON.parse(projectBytes.toString('utf8'))).toEqual(project);const expected=scalar(project),resultPng=await download(page,'#download-result');expectPng(resultPng,expected.result);
  const report=await download(page,'#download-report');expect(report.length).toBeLessThanOrEqual(16*1024*1024);const embedded=[...report.toString('utf8').matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];expect(embedded).toHaveLength(2);expectPng(Buffer.from(embedded[0]![1]!,'base64'),expected.baseline);expectPng(Buffer.from(embedded[1]![1]!,'base64'),expected.result);
  const measured=(bytes:Buffer)=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  await mkdir(test.info().outputDir,{recursive:true});const measurementsPath=test.info().outputPath('maximum-artifact-measurements.json');
  await writeFile(measurementsPath,JSON.stringify({source:{width:720,height:720,...measured(Buffer.from(raster.rgba))},output:{width:976,height:976,...measured(Buffer.from(expected.result.rgba))},project:measured(projectBytes),resultPng:measured(resultPng),baselinePng:measured(Buffer.from(embedded[0]![1]!,'base64')),report:measured(report)},null,2));
  await test.info().attach('maximum-artifact-measurements.json',{path:measurementsPath,contentType:'application/json'});
  const desktopPath=test.info().outputPath('workbench-desktop.png');await page.screenshot({path:desktopPath,fullPage:true});await test.info().attach('workbench-desktop.png',{path:desktopPath,contentType:'image/png'});
  await saved(page);await page.setViewportSize({width:390,height:844});await page.locator('#comparison-view').selectOption('actual');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const mobilePath=test.info().outputPath('workbench-390px.png');await page.screenshot({path:mobilePath,fullPage:true});await test.info().attach('workbench-390px.png',{path:mobilePath,contentType:'image/png'});
  await page.reload();expect(await backup(page)).toEqual(project);
});

test('390px keyboard workflow retains exact invalid fields and never assigns a shape score to uploaded art',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await open(page);await page.locator('#border-size').focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('7.5');await page.locator('#apply-changes').focus();await page.keyboard.press('Enter');
  await expect(page.locator('#border-size')).toHaveValue('7.5');expect((await backup(page)).settings.border).toBe(48);await page.locator('#discard-changes').focus();await page.keyboard.press('Enter');
  await page.locator('#comparison-view').selectOption('actual');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await expect(page.getByRole('heading',{name:'Controlled shape experiment',exact:true})).toBeVisible();await expect(page.locator('#experiment')).toContainText(/procedural|shape/i);expect(await page.locator('#experiment').innerText()).not.toContain('<img src=x> original.png');
  await page.locator('#project-title').focus();await expect(page.locator('#project-title')).toBeFocused();
});

test('page lifecycle retires held normalization output and leaves the restored in-memory editor usable',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);const original=await backup(page);await gate(page,'worker');
  await page.locator('#image-file').setInputFiles({name:'pagehide-pending.png',mimeType:'image/png',buffer:originalPng(literalRaster(5,7))});await held(page,'worker');
  await page.locator('#border-size').fill('');
  // Explicit public lifecycle events test software cleanup; this is not a claim of an actual BFCache hit.
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await release(page);await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
  expect(await backup(page)).toEqual(original);await expect(page.locator('#border-size')).toHaveValue('');await page.locator('#border-size').fill('48');await page.locator('#project-title').fill('Usable after lifecycle retirement');await apply(page);expect((await backup(page)).title).toBe('Usable after lifecycle retirement');
});


test('Retry loading ignores newer raw intent and declining explicit replacement preserves protected memory and repaired native data',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);await rawRecord(page,{value:'{"schemaVersion":99}'});await page.reload();await page.locator('#continue-unsaved').click();
  await page.locator('#project-title').fill('Memory-only project');await apply(page);const memory=await backup(page),repair=rawProject({colorA:'#c02080'}),repaired=JSON.stringify(repair);
  await rawRecord(page,{value:repaired});await gate(page,'load');await page.locator('#retry-load').click();await held(page,'load');
  await page.locator('#project-title').fill('New raw intent during loading');await release(page);expect(await backup(page)).toEqual(memory);await expect(page.locator('#project-title')).toHaveValue('New raw intent during loading');expect((await rawRecord(page)).value).toBe(repaired);
  page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#retry-load').click();
  await expect(page.locator('#project-title')).toHaveValue('New raw intent during loading');expect(await backup(page)).toEqual(memory);
  page.on('dialog',dialog=>dialog.accept());await page.locator('#retry-load').click();await expect(page.locator('#project-title')).toHaveValue(repair.title);expect(await backup(page)).toEqual(repair);expect((await rawRecord(page)).value).toBe(repaired);
});

test('a new PNG normalization admission retires an older Retry loading without cancelling or replacing the newer import',async({page})=>{
  await installNative(page);await page.goto('/');await open(page);await saved(page);
  await rawRecord(page,{value:'{"schemaVersion":99}'});await page.reload();await page.locator('#continue-unsaved').click();
  await page.locator('#project-title').fill('Memory before new image');await apply(page);const memory=await backup(page);
  const repair=rawProject({colorA:'#c02080'});repair.title='Earlier recovered project';await rawRecord(page,{value:JSON.stringify(repair)});
  // Keep a genuine readonly transaction alive while retaining all native request results.
  await page.evaluate(()=>{(window as unknown as ProbeWindow).__colorNative.holdLoad=true;});await page.locator('#retry-load').click();await held(page,'load');
  await gate(page,'worker');await page.locator('#image-file').setInputFiles({name:'newer-owned-image.png',mimeType:'image/png',buffer:originalPng(literalRaster(7,5))});await held(page,'worker');
  // The second gate retains the real normalization result, independently of the old database read.
  await page.evaluate(()=>(window as unknown as ProbeWindow).__colorNative.releaseLoad?.());
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(page.locator('#project-title')).toHaveValue(memory.title);
  await release(page);await expect(page.locator('#source-info')).toContainText('newer-owned-image.png');await expect(page.locator('#preview-status')).toHaveText('Applied settings preview ready.');
  expect((await backup(page)).image.source.fileName).toBe('newer-owned-image.png');expect((await rawRecord(page)).value).toBe(JSON.stringify(repair));
});

test('published complete experiment exposes every fit and per-seed condition and downloads the exact public artifact without assigning artwork results',async({page})=>{
  const published=await readFile(join(process.cwd(),'public','experiment-report.json'));
  const report=JSON.parse(published.toString('utf8')) as {status:string;readiness:{status:string};models:unknown[];evaluations:{seed:number;flipFraction:number;accuracy:number;balancedAccuracy:number}[];testSamples:unknown[];limitations:string[]};
  expect(report.status).toBe('complete');expect(report.readiness.status).toBe('pass');expect(report.models).toHaveLength(18);expect(report.evaluations).toHaveLength(108);expect(report.testSamples).toHaveLength(640);
  for(const seed of[1729,2718,3141])expect(report.evaluations.filter(value=>value.seed===seed)).toHaveLength(36);
  expect(report.evaluations.every(value=>value.flipFraction===0&&value.accuracy===1&&value.balancedAccuracy===1)).toBe(true);
  await page.goto('/');await expect(page.locator('#experiment-status')).toHaveText('complete · development readiness: pass');
  await expect(page.locator('#experiment-results')).toContainText('no change in predicted labels');await expect(page.locator('#experiment-results')).toContainText('This does not demonstrate artwork protection');
  const development=page.locator('#experiment-results details').filter({has:page.getByText('Inspect all development fits',{exact:true})});await development.locator('summary').click();await expect(development.locator('tr')).toHaveCount(19);
  const conditions=page.locator('#experiment-results table').filter({has:page.getByRole('columnheader',{name:'Condition',exact:true})});await expect(conditions.locator('tr')).toHaveCount(37);
  const records=page.locator('#experiment-results details').filter({has:page.getByText('Inspect full per-seed records and predictions',{exact:true})});await records.locator('summary').click();await expect(records.locator('pre')).toBeVisible();expect(JSON.parse(await records.locator('pre').innerText())).toEqual(JSON.parse(published.toString('utf8')));
  for(const limitation of report.limitations)await expect(page.locator('#experiment-results')).toContainText(limitation);
  expect(await download(page,'#download-experiment')).toEqual(published);
  await open(page);await page.locator('#project-title').fill('A separate artist comparison');await apply(page);expect(await download(page,'#download-experiment')).toEqual(published);
  await expect(page.locator('#experiment-results')).toContainText('No result applies to uploaded artwork');expectPng(await download(page,'#download-result'),scalar(await backup(page)).result);
});

test('bounded malformed and unavailable experiment responses claim no outcome while independent artwork comparison and exports remain usable',async({page})=>{
  const responses=[{status:200,body:'{"status":"complete","models":[]}'},{status:200,body:' '.repeat(512*1024+1)},{status:503,body:'Experiment temporarily unavailable'}];
  for(const response of responses){
    await page.route('**/experiment-report.json',route=>route.fulfill({...response,contentType:'application/json'}));await page.goto('/');
    await expect(page.locator('#experiment-status')).toHaveText('Results unavailable — no experiment outcome is claimed.');await expect(page.locator('#download-experiment')).toBeDisabled();await expect(page.locator('#experiment-results table')).toHaveCount(0);
    const project=rawProject({border:1,colorA:'#ffffff'});await open(page,project);expect(await backup(page)).toEqual(project);expectPng(await download(page,'#download-result'),scalar(project).result);
    await page.locator('#project-title').fill('Artwork remains usable without research results');await apply(page);await saved(page);expect((await backup(page)).title).toBe('Artwork remains usable without research results');
    await expect(page.locator('#download-experiment')).toBeDisabled();await page.unroute('**/experiment-report.json');
  }
});
