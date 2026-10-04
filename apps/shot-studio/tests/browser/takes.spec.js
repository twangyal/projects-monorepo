import {test,expect,chromium} from '@playwright/test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {takeFilm,openTakeFilm,recordTake,downloadTake,parseTake,frameTake,sha,libraryReceipt,abortNextWrite,inspectRecording} from './take-fixtures.js';

const rows=page=>page.locator('#take-list [data-take-id]');
async function importTake(page,bytes,name='original.shot-take'){
  await page.locator('#import-take').setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});
}
async function sceneRaw(page){return page.evaluate(()=>localStorage.getItem('shot-studio-v1'));}
async function createArchive(page){await openTakeFilm(page);await recordTake(page,'First retained take');return(await downloadTake(page)).bytes;}
async function holdBlobReads(page){await page.evaluate(()=>{
  const original=Blob.prototype.arrayBuffer;window.takeReadGate={pending:[],enabled:true};
  Blob.prototype.arrayBuffer=async function(){const value=await original.call(this);if(window.takeReadGate.enabled)await new Promise(resolve=>window.takeReadGate.pending.push(resolve));return value;};
});}
async function releaseBlobReads(page){await page.evaluate(()=>{window.takeReadGate.enabled=false;window.takeReadGate.pending.splice(0).forEach(resolve=>resolve());});}
async function literalInput(page,id,text,caret=2){await page.locator(id).fill(text);await page.locator(id).evaluate((node,caret)=>node.setSelectionRange(caret,caret),caret);}

test('records two original alternatives as immutable playable takes and restores one undoably',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openTakeFilm(page);await expect(page.getByRole('button',{name:'Record take',exact:true})).toBeVisible({timeout:2000});
  await recordTake(page,'East <literal> take');const first=await downloadTake(page),a=parseTake(first.bytes);
  expect(a.manifest.film).toEqual(takeFilm());expect(a.manifest.name).toBe('East <literal> take');expect(a.manifest.origin).toBe('recorded-here');expect(a.manifest.id).toBeUndefined();
  const east=await inspectRecording(a.video,info.outputPath('east.webm'));
  await page.locator('#import').setInputFiles({name:'west.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(takeFilm(true)))});
  await expect(page.locator('#title')).toHaveValue('Westward alternative');await recordTake(page,'West alternative');
  const second=await downloadTake(page),b=parseTake(second.bytes);expect(b.manifest.film).toEqual(takeFilm(true));expect(sha(a.video)).not.toBe(sha(b.video));
  const west=await inspectRecording(b.video,info.outputPath('west.webm'),true);
  const current=await sceneRaw(page);await rows(page).first().click();await page.locator('#play-take').click();
  await expect.poll(()=>page.locator('#take-video').evaluate(video=>video.currentSrc||video.src)).toMatch(/^blob:/);
  const playbackHash=await page.locator('#take-video').evaluate(async video=>{const bytes=await(await fetch(video.currentSrc||video.src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');});expect(playbackHash).toBe(sha(a.video));
  await expect.poll(()=>page.locator('#take-video').evaluate(video=>video.currentTime)).toBeGreaterThan(.15);
  expect(await sceneRaw(page)).toBe(current);await page.locator('#stop-take').click();
  await page.locator('#restart-take').click();await expect.poll(()=>page.locator('#take-video').evaluate(video=>video.currentTime)).toBeGreaterThan(.05);
  await page.locator('#stop-take').click();
  page.once('dialog',dialog=>dialog.accept());await page.locator('#restore-take').click();await expect(page.locator('#title')).toHaveValue('Eastward original');
  await page.locator('#undo').click();expect(await sceneRaw(page)).toBe(current);await page.locator('#redo').click();await expect(page.locator('#title')).toHaveValue('Eastward original');
  expect((await downloadTake(page)).bytes).toEqual(first.bytes);
  await writeFile(info.outputPath('take-verification.json'),JSON.stringify({east,west,archives:[{bytes:first.bytes.length,sha256:sha(first.bytes)},{bytes:second.bytes.length,sha256:sha(second.bytes)}]},null,2));
  await first.download.saveAs(info.outputPath('east.shot-take'));await second.download.saveAs(info.outputPath('west.shot-take'));expect(errors).toEqual([]);
});

test('rename and confirmed delete preserve captured film and media; opening obeys raw draft guards',async({page})=>{
  const original=parseTake(await createArchive(page));
  await page.locator('#take-rename').fill('Renamed <script> literal');await page.locator('#rename-take').click();
  await expect(rows(page)).toContainText('Renamed <script> literal');const renamed=parseTake((await downloadTake(page)).bytes);
  expect(renamed.manifest.name).toBe('Renamed <script> literal');expect(renamed.manifest.film).toEqual(original.manifest.film);expect(renamed.video).toEqual(original.video);expect(renamed.manifest.recordedAt).toBe(original.manifest.recordedAt);
  await literalInput(page,'#shotName','',0);const raw=await sceneRaw(page);
  await page.locator('#restore-take').click();expect(await sceneRaw(page)).toBe(raw);await expect(page.locator('#shotName')).toHaveValue('');
  page.once('dialog',d=>d.dismiss());await page.locator('#delete-take').click();await expect(rows(page)).toHaveCount(1);
  page.once('dialog',d=>d.accept());await page.locator('#delete-take').click();await expect(rows(page)).toHaveCount(0);
  expect(await sceneRaw(page)).toBe(raw);await expect(page.locator('#shotName')).toHaveValue('');
});

test('actual aborted IndexedDB append retains prior pair and a complete unsaved backup then retries once',async({page})=>{
  const original=await createArchive(page),before=await libraryReceipt(page);await abortNextWrite(page);
  await page.locator('#take-name').fill('Completed but not saved');await page.locator('#record-take').click();
  await expect(page.locator('#retry-take')).toBeVisible({timeout:20000});await expect.poll(()=>page.evaluate(()=>window.takeAbort.fired)).toBe(true);
  expect(await libraryReceipt(page)).toEqual(before);
  const recovery=parseTake((await downloadTake(page)).bytes);expect(recovery.manifest.name).toBe('Completed but not saved');expect(recovery.manifest.film).toEqual(takeFilm());
  await page.locator('#retry-take').click();await expect(rows(page)).toHaveCount(2);await expect(page.locator('#take-status')).toContainText(/saved/i);
  const after=await libraryReceipt(page);expect(after.revision).toBe(before.revision+1);expect(new Set(after.records.map(r=>r.metadata.id)).size).toBe(2);
  await rows(page).first().click();expect((await downloadTake(page)).bytes).toEqual(original);
});

test('two tabs require explicit library reload after CAS conflict and never overwrite another take',async({page,context})=>{
  await createArchive(page);const other=await context.newPage();await other.goto('/');await expect(rows(other)).toHaveCount(1);await rows(other).first().click();
  await page.locator('#take-rename').fill('Name committed by first tab');await page.locator('#rename-take').click();await expect(rows(page)).toContainText('Name committed by first tab');
  await other.locator('#take-rename').fill('Stale overwrite refused');await other.locator('#rename-take').click();
  await expect(other.locator('#take-status')).toContainText(/changed|conflict|reload|retry/i);expect((await libraryReceipt(page)).records[0].metadata.name).toBe('Name committed by first tab');
  await other.locator('#retry-library').click();await expect(rows(other)).toContainText('Name committed by first tab');await other.close();
});

test('a present invalid library remains protected while ordinary film editing stays usable',async({page})=>{
  await page.goto('/');await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('shot-studio-takes',1);r.onerror=()=>reject(Error('open'));r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readwrite');tx.objectStore('state').put(undefined,'library');tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(Error('abort'));};}));
  await page.reload();await expect(page.locator('#retry-library')).toBeVisible();await expect(page.locator('#record-take')).toBeDisabled();
  await page.locator('#title').fill('Ordinary editor still works');await page.locator('#title').press('Tab');await expect(page.locator('#title')).toHaveValue('Ordinary editor still works');
  await page.locator('#retry-library').click();await expect(page.locator('#record-take')).toBeDisabled();
  expect(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('shot-studio-takes',1);r.onsuccess=()=>{const db=r.result,tx=db.transaction('state','readonly'),get=tx.objectStore('state').getKey('library');tx.oncomplete=()=>{db.close();resolve(get.result);};};}))).toBe('library');
});

for(const intent of ['changed-back raw field','pagehide'])test(`late real archive reads cannot publish after ${intent}`,async({page})=>{
  const bytes=await createArchive(page),before=await libraryReceipt(page),raw=await sceneRaw(page);await holdBlobReads(page);
  await importTake(page,bytes,'held.shot-take');await expect.poll(()=>page.evaluate(()=>window.takeReadGate.pending.length)).toBeGreaterThan(0);
  if(intent==='changed-back raw field'){
    await literalInput(page,'#shotName','Temporarily different',3);await literalInput(page,'#shotName','Original fixed view',3);
  }else await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await releaseBlobReads(page);await expect(page.locator('#cancel-take')).toBeHidden();
  expect(await libraryReceipt(page)).toEqual(before);expect(await sceneRaw(page)).toBe(raw);
  if(intent==='changed-back raw field'){await expect(page.locator('#shotName')).toBeFocused();expect(await page.locator('#shotName').evaluate(node=>[node.selectionStart,node.selectionEnd])).toEqual([3,3]);}
});

test('recording cancellation and pagehide stop actual capture without partial publication',async({page})=>{
  await page.addInitScript(()=>{const Native=MediaRecorder,capture=HTMLCanvasElement.prototype.captureStream;window.takeNative={recorders:[],streams:[]};globalThis.MediaRecorder=class extends Native{start(...args){super.start(...args);window.takeNative.recorders.push(this);}};HTMLCanvasElement.prototype.captureStream=function(...args){const stream=capture.apply(this,args);window.takeNative.streams.push(stream);return stream;};});
  await openTakeFilm(page);await page.locator('#take-name').fill('Cancelled actual recording');await page.locator('#record-take').click();await expect(page.locator('#cancel-take')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.takeNative.recorders.filter(r=>r.state==='recording').length)).toBe(1);await page.locator('#cancel-take').click();
  await expect(rows(page)).toHaveCount(0);await expect(page.locator('#record-take')).toBeEnabled();
  await page.locator('#record-take').click();await expect(page.locator('#cancel-take')).toBeVisible();await expect.poll(()=>page.evaluate(()=>window.takeNative.recorders.filter(r=>r.state==='recording').length)).toBe(1);
  await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
  await expect(page.locator('#cancel-take')).toBeHidden();await expect(rows(page)).toHaveCount(0);const state=await libraryReceipt(page);expect(state===null||state.records.length===0).toBe(true);await expect.poll(()=>page.evaluate(()=>window.takeNative.recorders.every(r=>r.state==='inactive')&&window.takeNative.streams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended'))).toBe(true);
});

test('four actual-video slots reject a fifth without eviction and reject malformed bounded archives',async({page})=>{
  const bytes=await createArchive(page),parsed=parseTake(bytes);
  for(let i=0;i<3;i++){await importTake(page,bytes,`declared-${i}.shot-take`);await expect(rows(page)).toHaveCount(i+2);}
  const full=await libraryReceipt(page);expect(full.records).toHaveLength(4);expect(new Set(full.records.map(r=>r.metadata.id)).size).toBe(4);expect(full.records.slice(1).every(r=>r.metadata.origin==='imported-declared')).toBe(true);
  if(await page.locator('#import-take').isDisabled()){await expect(page.locator('#record-take')).toBeDisabled();}else{await importTake(page,bytes,'fifth.shot-take');await expect(page.locator('#take-status')).toContainText(/four|4|full|limit/i);}expect(await libraryReceipt(page)).toEqual(full);
  page.once('dialog',d=>d.accept());await page.locator('#delete-take').click();await expect(rows(page)).toHaveCount(3);const before=await libraryReceipt(page);
  const corrupt=Buffer.from(bytes);corrupt[corrupt.length-1]^=1;
  const tooLarge=Buffer.alloc(16);tooLarge.write('SHOTTAK1');tooLarge.writeUInt32LE(1,8);tooLarge.writeUInt32LE(32*1024**2+1,12);
  const extra=frameTake({...parsed.manifest,unexpected:'must reject'},parsed.video);
  for(const [name,invalid] of [['hash',corrupt],['truncated',bytes.subarray(0,-1)],['trailing',Buffer.concat([bytes,Buffer.from([0])])],['oversize-header',tooLarge],['unknown',extra]]){
    await importTake(page,invalid,`${name}.shot-take`);await expect(page.locator('#cancel-take')).toBeHidden();await expect(page.locator('#take-status')).toContainText(/invalid|match|hash|length|large|limit|unsupported|archive|backup/i);expect(await libraryReceipt(page)).toEqual(before);
  }
});

test('complete archives retain exact bytes across whole browser restart and fresh-profile declared import',async({},info)=>{
  test.setTimeout(90000);const profile=await mkdtemp(join(tmpdir(),'shot86-profile-'));const baseURL=info.project.use.baseURL;
  const options={headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',acceptDownloads:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],baseURL};
  let context=await chromium.launchPersistentContext(profile,options);let page=await context.newPage();let bytes,receipt;
  try{bytes=await createArchive(page);receipt=await libraryReceipt(page);await page.screenshot({path:info.outputPath('desktop-take.png'),fullPage:true});}finally{await context.close();}
  context=await chromium.launchPersistentContext(profile,options);page=await context.newPage();
  try{await page.goto('/');await expect(rows(page)).toHaveCount(1);await rows(page).first().click();expect(await libraryReceipt(page)).toEqual(receipt);expect((await downloadTake(page)).bytes).toEqual(bytes);}finally{await context.close();}
  const fresh=await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(),'shot86-fresh-')),options);
  try{const imported=await fresh.newPage();await imported.goto('/');const current=await sceneRaw(imported);await importTake(imported,bytes);await expect(rows(imported)).toHaveCount(1);await rows(imported).first().click();const state=await libraryReceipt(imported);expect(state.records[0].metadata.id).not.toBe(receipt.records[0].metadata.id);expect(state.records[0].metadata.origin).toBe('imported-declared');expect(await sceneRaw(imported)).toBe(current);
    const before=parseTake(bytes),after=parseTake((await downloadTake(imported)).bytes);expect(after.video).toEqual(before.video);expect(after.manifest).toEqual({...before.manifest,origin:'imported-declared'});
    await imported.setViewportSize({width:390,height:844});await expect(imported.locator('#play-take')).toBeVisible();expect(await imported.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await imported.locator('#play-take').focus();await imported.keyboard.press('Enter');await expect.poll(()=>imported.locator('#take-video').evaluate(v=>v.currentTime)).toBeGreaterThan(.1);await imported.locator('#stop-take').click();await imported.screenshot({path:info.outputPath('narrow-imported-take.png'),fullPage:true});
    await writeFile(info.outputPath('restart-verification.json'),JSON.stringify({archiveBytes:bytes.length,archiveSha256:sha(bytes),receipt,importedReceipt:state},null,2));
  }finally{await fresh.close();}
});
