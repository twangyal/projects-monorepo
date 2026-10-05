import {observeNativeExport} from './native-export-observer.js';
import {storedSequenceText,sequenceStoredState,legacySequenceText} from './sequence-storage-fixtures.js';
import {test,expect,chromium} from '@playwright/test';
import {sequenceSourceA,sequenceSourceB,originalSequence,sequenceBackup,sequenceDownload,sequenceCanvas,verifySequencePixels,sequenceProjectedX,sequenceCostume,decodeSequenceVideo,sequenceSha,remoteSequenceV1,migratedRemoteSequence} from './sequence-fixtures.js';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function openScene(page,film=sequenceSourceA()){
  await page.goto('/');await expect(page.locator('#stage')).toBeVisible();await page.locator('#import').setInputFiles({name:'original-sequence-source.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});await expect(page.locator('#title')).toHaveValue(film.title);
}
test('original complete scene opens before the separate Scene sequence authoring panel',async({page})=>{
  await openScene(page);await expect(page.getByRole('region',{name:'Scene sequence',exact:true})).toBeVisible({timeout:2000});await expect(page.locator('#sequence-add-current')).toBeEnabled();
});

const sourceRows=page=>page.locator('#sequence-sources [data-sequence-source-id]');
const clipRows=page=>page.locator('#sequence-clips [data-sequence-clip-id]');
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
const rawSequence=storedSequenceText;
async function rawScene(page){return page.evaluate(()=>localStorage.getItem('shot-studio-v1'));}
async function openSequence(page,document=originalSequence()){
  await page.goto('/');await expect(page.locator('#sequence-panel')).toBeVisible();page.once('dialog',d=>d.accept());await page.locator('#sequence-open').setInputFiles({name:'original-scenes.shot-sequence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(document))});await expect(page.locator('#sequence-title')).toHaveValue(document.title);await expect.poll(async()=>JSON.parse(await rawSequence(page))).toEqual(document);
}
async function seekSequence(page,time){await page.locator('#sequence-scrub').evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},time);await settle(page);}
async function importSource(page,film,name='original-source.json'){const before=await sourceRows(page).count();await page.locator('#sequence-import-source').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(film))});await expect(sourceRows(page)).toHaveCount(before+1);await sourceRows(page).last().click();}
async function addShot(page,index=1){const before=await clipRows(page).count();await page.locator(`[data-source-shot-index="${index}"]`).click();await page.locator('#sequence-add-shot').click();await expect(clipRows(page)).toHaveCount(before+1);}
async function gateReads(page){await page.evaluate(()=>{
  const text=File.prototype.text,buffer=File.prototype.arrayBuffer;window.sequenceReadGate={pending:[],enabled:true};
  const hold=async(file,result)=>{const value=await result;if(file.name.startsWith('held-')&&window.sequenceReadGate.enabled)await new Promise(resolve=>window.sequenceReadGate.pending.push(resolve));return value;};
  File.prototype.text=function(){return hold(this,text.call(this));};File.prototype.arrayBuffer=function(){return hold(this,buffer.call(this));};
});}
async function releaseReads(page){await page.evaluate(()=>{window.sequenceReadGate.enabled=false;window.sequenceReadGate.pending.splice(0).forEach(resolve=>resolve());});}

test('current and file scenes remain detached while clips reorder repeat remove and undo independently',async({page})=>{
  await openScene(page);const scene=await rawScene(page);await page.locator('#sequence-add-current').click();await expect(sourceRows(page)).toHaveCount(1);let saved=await sequenceBackup(page);expect(saved.sources[0].film).toEqual(sequenceSourceA());
  await page.locator('#title').fill('Current scene changed later');await page.locator('#title').press('Tab');expect((await sequenceBackup(page)).sources[0].film).toEqual(sequenceSourceA());
  await sourceRows(page).first().click();await addShot(page);await importSource(page,sequenceSourceB());await addShot(page);await page.locator('#sequence-repeat').click();await expect(clipRows(page)).toHaveCount(3);saved=await sequenceBackup(page);expect(saved.clips.map(c=>c.sourceId)).toEqual([saved.sources[0].id,saved.sources[1].id,saved.sources[1].id]);
  await page.locator('#sequence-earlier').click();const reordered=await sequenceBackup(page);expect(reordered.clips.map(c=>c.id)).toEqual([saved.clips[0].id,saved.clips[2].id,saved.clips[1].id]);await page.locator('#sequence-undo').click();expect(await sequenceBackup(page)).toEqual(saved);await page.locator('#sequence-redo').click();expect(await sequenceBackup(page)).toEqual(reordered);
  await page.locator('#sequence-remove').click();await expect(clipRows(page)).toHaveCount(2);await sourceRows(page).first().click();const before=await sequenceBackup(page);if(await page.locator('#sequence-source-remove').isEnabled()){await page.locator('#sequence-source-remove').click();await expect(page.locator('#sequence-status')).toContainText(/referenc|used|clip/i);}else await expect(page.locator('#sequence-source-remove')).toBeDisabled();expect(await sequenceBackup(page)).toEqual(before);
  expect(JSON.parse(await rawScene(page)).title).toBe('Current scene changed later');expect(JSON.parse(scene).title).toBe(sequenceSourceA().title);
});

test('source-global clocks repeat exactly and explicit clip endpoints do not jump to an adjacent cut',async({page})=>{
  await openSequence(page);const scene=await rawScene(page);
  for(const time of [.25,1.2,1.8,2,2.25,3.6,4,4.25,5.8,6]){await seekSequence(page,time);verifySequencePixels(await sequenceCanvas(page),time);}
  await clipRows(page).first().click();await page.locator('#sequence-preview-end').click();await settle(page);const image=await sequenceCanvas(page),red=sequenceCostume(image,0),blue=sequenceCostume(image,2),green=sequenceCostume(image,1);expect(red.count).toBeLessThanOrEqual(20);expect(blue.count).toBeLessThanOrEqual(20);expect(Math.abs(green.x-sequenceProjectedX(2,1))).toBeLessThan(16);await expect(page.locator('#sequence-source-time')).toContainText(/3(?:\.0+)?/);
  await page.locator('#sequence-play').click();await expect.poll(()=>page.locator('#sequence-scrub').inputValue()).not.toBe('2');await page.locator('#sequence-stop').click();expect(Number(await page.locator('#sequence-scrub').inputValue())).toBeLessThan(1);expect(await rawScene(page)).toBe(scene);
});

test('real six-second sequence WebM contains both immutable sources and repeats the original source clock',async({page},info)=>{
  test.setTimeout(45000);await openSequence(page);const before=await sequenceBackup(page),result=await sequenceDownload(page,'#sequence-export');expect(result.download.suggestedFilename()).toMatch(/\.webm$/i);const receipt=await decodeSequenceVideo(result.bytes,info.outputPath('original-six-second-sequence.webm'));expect(await sequenceBackup(page)).toEqual(before);expect(await page.locator('#take-list [data-take-id]').count()).toBe(0);await writeFile(info.outputPath('sequence-video-verification.json'),JSON.stringify(receipt,null,2));
});

test('saved take copies its complete editable film without retaining a link to later rename or deletion',async({page})=>{
  await openScene(page,sequenceSourceB());await page.locator('#take-name').fill('Blue recorded source');await page.locator('#record-take').click();await expect(page.locator('#take-list [data-take-id]')).toHaveCount(1,{timeout:15000});await page.locator('#take-list [data-take-id]').first().click();await page.locator('#sequence-add-take').click();await expect(sourceRows(page)).toHaveCount(1);const copied=await sequenceBackup(page);expect(copied.sources[0].film).toEqual(sequenceSourceB());expect(copied.sources[0].label).toBe('Blue recorded source');
  page.once('dialog',d=>d.accept());await page.locator('#delete-take').click();await expect(page.locator('#take-list [data-take-id]')).toHaveCount(0);expect(await sequenceBackup(page)).toEqual(copied);
});

test('raw title source and clip fields remain literal and committed backups do not apply invalid drafts',async({page})=>{
  await openSequence(page);const before=await sequenceBackup(page);
  for(const [input,apply] of [['#sequence-title','#sequence-title-apply'],['#sequence-source-label','#sequence-source-rename'],['#sequence-clip-label','#sequence-clip-rename']]){
    if(input.includes('source'))await sourceRows(page).first().click();if(input.includes('clip'))await clipRows(page).first().click();const field=page.locator(input),previous=await field.inputValue();await field.fill('');await field.evaluate(node=>node.dataset.originalNode='retained');if(await page.locator(apply).isEnabled())await page.locator(apply).click();await expect(field).toHaveValue('');await expect(field).toHaveAttribute('data-original-node','retained');expect(await sequenceBackup(page)).toEqual(before);page.once('dialog',dialog=>dialog.accept());await page.locator('#sequence-discard-edits').click();await expect(field).toHaveValue(previous);
  }
  await page.locator('#sequence-title').fill('Literal <img src=x> sequence');await page.locator('#sequence-title-apply').click();const saved=await sequenceBackup(page);expect(saved.title).toBe('Literal <img src=x> sequence');await expect(page.locator('#sequence-panel img')).toHaveCount(0);await page.locator('#sequence-undo').click();expect(await sequenceBackup(page)).toEqual(before);
});

for(const kind of ['source','document'])test(`late native ${kind} read cannot publish after changed-back sequence title input`,async({page})=>{
  await openSequence(page);const before=await sequenceBackup(page);await gateReads(page);const target=kind==='source'?'#sequence-import-source':'#sequence-open',value=kind==='source'?sequenceSourceB():{...originalSequence(),title:'Held replacement'};
  await page.locator(target).setInputFiles({name:'held-original.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await expect.poll(()=>page.evaluate(()=>window.sequenceReadGate.pending.length)).toBeGreaterThan(0);const field=page.locator('#sequence-title');await field.fill('New raw title');await field.fill(before.title);await field.evaluate(node=>node.setSelectionRange(3,3));await releaseReads(page);await settle(page);await expect(field).toHaveValue(before.title);await expect(field).toBeFocused();expect(await field.evaluate(node=>node.selectionStart)).toBe(3);expect(await sequenceBackup(page)).toEqual(before);
});

test('native source failures and cap refusal preserve independent scene and sequence documents',async({page})=>{
  await openSequence(page);const scene=await rawScene(page),before=await sequenceBackup(page);await page.locator('#sequence-import-source').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});await expect(page.locator('#sequence-status')).toContainText(/invalid|JSON|parse|unexpected/i);expect(await sequenceBackup(page)).toEqual(before);
  await importSource(page,sequenceSourceA(),'third.json');await importSource(page,sequenceSourceB(),'fourth.json');const full=await sequenceBackup(page);if(await page.locator('#sequence-import-source').isEnabled()){await page.locator('#sequence-import-source').setInputFiles({name:'fifth.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(sequenceSourceA()))});await expect(page.locator('#sequence-status')).toContainText(/four|4|limit|source/i);}expect(await sequenceBackup(page)).toEqual(full);expect(await rawScene(page)).toBe(scene);
  const huge=Buffer.alloc(327681,32);await page.locator('#sequence-open').setInputFiles({name:'overbound.json',mimeType:'application/json',buffer:huge});await expect(page.locator('#sequence-status')).toContainText(/large|320|limit|byte/i);expect(await sequenceBackup(page)).toEqual(full);
});

test('protected malformed sequence draft survives edits Undo and failed explicit replacement until consent succeeds',async({page})=>{
  await page.goto('/');const raw='{"unreadable": "keep exact original"';await page.evaluate(value=>localStorage.setItem('shot-studio-sequence-v1',value),raw);await page.reload();await expect(page.locator('#sequence-recovery-legacy-download')).toBeVisible();const recovered=JSON.parse((await sequenceDownload(page,'#sequence-recovery-legacy-download')).bytes.toString());expect(recovered).toEqual({kind:'shot-studio-sequence-recovery',raw});
  await page.locator('#sequence-add-current').click();await expect(sourceRows(page)).toHaveCount(1);const memory=await sequenceBackup(page);expect(await rawSequence(page)).toBe(raw);await page.locator('#sequence-undo').click();expect(await rawSequence(page)).toBe(raw);await page.locator('#sequence-redo').click();expect(await sequenceBackup(page)).toEqual(memory);
  await page.evaluate(()=>{const native=IDBObjectStore.prototype.put;window.sequenceWriteGate={fail:true};IDBObjectStore.prototype.put=function(value,key){if(this.transaction.db.name==='shot-studio-sequence-documents'&&window.sequenceWriteGate.fail)throw new DOMException('Original fixture quota refusal','QuotaExceededError');return native.call(this,value,key);};});page.once('dialog',d=>d.accept());await page.locator('#sequence-replace-saved').click();expect(await rawSequence(page)).toBe(raw);await expect(page.locator('#sequence-replace-saved')).toBeVisible();await page.evaluate(()=>window.sequenceWriteGate.fail=false);page.once('dialog',d=>d.accept());await page.locator('#sequence-replace-saved').click();await expect.poll(()=>rawSequence(page)).toBe(JSON.stringify(memory));expect(await legacySequenceText(page)).toBe(raw);
});

for(const reason of ['cancel','pagehide'])test(`real sequence encoder ${reason} retires output and native samples without modifying either document`,async({page})=>{
  await observeNativeExport(page);await openSequence(page);const document=await sequenceBackup(page),scene=await rawScene(page),downloads=[];page.on('download',file=>downloads.push(file.suggestedFilename()));await page.locator('#sequence-export').click();await expect.poll(()=>page.evaluate(()=>window.exportOracle.video.some(encoder=>encoder.state==='configured'))).toBe(true);
  if(reason==='cancel')await page.locator('#sequence-cancel').click();else await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await expect.poll(()=>page.evaluate(()=>window.exportOracle.video.every(encoder=>encoder.state==='closed'))).toBe(true);expect(downloads).toEqual([]);expect(await rawSequence(page)).toBe(JSON.stringify(document));expect(await rawScene(page)).toBe(scene);
});

test('complete sequence bytes survive full browser-process restart and a fresh-profile native import',async({},info)=>{
  const profile=await mkdtemp(join(tmpdir(),'shot90-sequence-')),options={...info.project.use.launchOptions,baseURL:info.project.use.baseURL,headless:true,acceptDownloads:true};const sessions=[];let canonical;
  async function session(directory,label,run){const context=await chromium.launchPersistentContext(directory,options),browser=context.browser(),receipt={label,version:browser?.version(),closed:false};sessions.push(receipt);try{await run(await context.newPage());}finally{await context.close();receipt.closed=true;await writeFile(info.outputPath('sequence-browser-lifecycle.json'),JSON.stringify(sessions,null,2));}}
  await session(profile,'initial complete save',async page=>{await openSequence(page);canonical=(await sequenceDownload(page)).bytes;expect(JSON.parse(canonical)).toEqual(originalSequence());});
  await session(profile,'same profile reopened',async page=>{await page.goto('/');await expect(page.locator('#sequence-title')).toHaveValue(originalSequence().title);expect((await sequenceDownload(page)).bytes).toEqual(canonical);});
  await session(await mkdtemp(join(tmpdir(),'shot90-portable-')),'fresh profile explicit import',async page=>{await page.goto('/');page.once('dialog',d=>d.accept());await page.locator('#sequence-open').setInputFiles({name:'portable.shot-sequence.json',mimeType:'application/json',buffer:canonical});await expect(page.locator('#sequence-title')).toHaveValue(originalSequence().title);expect((await sequenceDownload(page)).bytes).toEqual(canonical);});await writeFile(info.outputPath('complete-original.shot-sequence.json'),canonical);await writeFile(info.outputPath('sequence-portable-verification.json'),JSON.stringify({bytes:canonical.length,sha256:sequenceSha(canonical),processes:sessions.length,allClosed:sessions.every(s=>s.closed)},null,2));
});

test('390px keyboard sequence navigation keeps raw ordinary camera spelling and both canvases contained',async({page},info)=>{
  await openSequence(page);const field=page.locator('#fov');await field.fill('');await field.evaluate(node=>node.dataset.originalNode='retained');await clipRows(page).first().focus();await page.keyboard.press('Enter');await page.locator('#sequence-preview-end').focus();await page.keyboard.press('Enter');await page.locator('#sequence-preview-start').focus();await page.keyboard.press('Enter');await expect(field).toHaveValue('');await expect(field).toHaveAttribute('data-original-node','retained');await page.setViewportSize({width:390,height:844});await page.locator('#sequence-panel').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('sequence-390px.png'),fullPage:true});
});

test('genuine legacy scene-file sources migrate completely while their literal original file stays unchanged',async({page})=>{
  await page.goto('/');const legacy={schemaVersion:1,title:'Original legacy blue scene',light:.55,actors:[{name:'Blue loop',color:'#0000ff',x:-1,z:0,action:'walk'},{name:'Green source control',color:'#00ff00',x:2,z:0,action:'idle'}],shots:[{name:'Legacy camera',duration:2,eye:[0,2.2,8],target:[0,1.15,0],fov:50}]},original=JSON.stringify(legacy);
  await importSource(page,legacy,'literal-schema1.json');const document=await sequenceBackup(page);expect(document.sources[0].film).toEqual({...legacy,schemaVersion:3,actors:legacy.actors.map(actor=>({...actor,performanceMode:'loop'})),shots:legacy.shots.map(shot=>({...shot,cameraMode:'static'}))});expect(JSON.stringify(legacy)).toBe(original);await addShot(page,0);expect((await sequenceBackup(page)).clips[0].shotIndex).toBe(0);
});


test('published name-based v1 and earlier rich v1 files both reopen as complete canonical v2',async({page})=>{
  await page.goto('/');
  for(const [file,expected] of [[remoteSequenceV1(),migratedRemoteSequence()],[{...originalSequence(),schemaVersion:1,clips:originalSequence().clips.map(({inTime,outTime,...clip})=>{void inTime;void outTime;return clip;})},originalSequence()]]){
    page.once('dialog',dialog=>dialog.accept());await page.locator('#sequence-open').setInputFiles({name:'legacy-complete.shot-sequence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});await expect(page.locator('#sequence-title')).toHaveValue(file.title);await expect.poll(async()=>JSON.parse(await rawSequence(page))).toEqual(expected);const exported=await sequenceBackup(page);expect(exported).toEqual(expected);expect(exported.schemaVersion).toBe(3);expect(exported.sources.map(source=>source.film)).toEqual([sequenceSourceA(),sequenceSourceB()]);expect(exported.clips.map(clip=>clip.shotIndex)).toEqual([1,1,1]);
  }
});

test('startup migration exposes canonical v2 while preserving the exact published v1 local record without a load write',async({page})=>{
  await page.goto('/');const legacy=JSON.stringify(remoteSequenceV1(),null,2)+'\n';await page.evaluate(raw=>localStorage.setItem('shot-studio-sequence-v1',raw),legacy);await page.reload();await expect(page.locator('#sequence-title')).toHaveValue(remoteSequenceV1().title);expect(await rawSequence(page)).toBe(legacy);expect(await sequenceBackup(page)).toEqual(migratedRemoteSequence());expect(await rawSequence(page)).toBe(legacy);await page.reload();await expect(page.locator('#sequence-title')).toHaveValue(remoteSequenceV1().title);expect(await rawSequence(page)).toBe(legacy);
});

test('a stale same-origin tab refuses a foreign write and preserves exact recovery until reviewed replacement',async({page,context})=>{
  await openSequence(page);const other=await context.newPage();
  try{
    await other.goto('/');await expect(other.locator('#sequence-title')).toHaveValue(originalSequence().title);await page.locator('#sequence-title').fill('First tab durable sequence');await page.locator('#sequence-title-apply').click();await page.locator('#sequence-repeat').click();const durable=await rawSequence(page);expect(JSON.parse(durable).title).toBe('First tab durable sequence');expect(JSON.parse(durable).clips).toHaveLength(4);
    await other.locator('#sequence-title').fill('Second tab unsaved memory');await other.locator('#sequence-title-apply').click();await expect(other.locator('#sequence-replace-saved')).toBeVisible();expect(await rawSequence(other)).toBe(durable);const memory=await sequenceBackup(other);expect(memory.title).toBe('Second tab unsaved memory');expect(memory.clips).toHaveLength(3);expect(memory.sources).toEqual(originalSequence().sources);const preserved=(await sequenceDownload(other,'#sequence-recovery-download')).bytes;expect(preserved).toEqual((await sequenceStoredState(page)).archive);
    other.once('dialog',dialog=>dialog.dismiss());await other.locator('#sequence-replace-saved').click();expect(await rawSequence(other)).toBe(durable);expect(await sequenceBackup(other)).toEqual(memory);await page.locator('#sequence-title').fill('First tab changed again after review');await page.locator('#sequence-title-apply').click();const latest=await rawSequence(page);expect(JSON.parse(latest).title).toBe('First tab changed again after review');let reviewedMessage='';other.once('dialog',dialog=>{reviewedMessage=dialog.message();return dialog.accept();});await other.locator('#sequence-replace-saved').click();await expect.poll(async()=>JSON.parse(await rawSequence(other))).toEqual(memory);expect(reviewedMessage).toContain('First tab changed again after review');expect(await legacySequenceText(other)).toBeNull();await page.reload();await expect(page.locator('#sequence-title')).toHaveValue(memory.title);expect(await sequenceBackup(page)).toEqual(memory);
  }finally{await other.close();}
});

test('cancelled native startup keeps sequence and ordinary authoring locked until the support query drains',async({page})=>{
 await page.addInitScript(()=>{
  const Native=VideoEncoder;let calls=0;window.sequenceEncoderGate={held:false,release:null};
  window.VideoEncoder=class extends Native{static async isConfigSupported(config){const supported=await Native.isConfigSupported(config);if(++calls===2){window.sequenceEncoderGate.held=true;await new Promise(r=>window.sequenceEncoderGate.release=r);}return supported;}};
 });
 await openSequence(page);const before=await sequenceBackup(page),scene=await rawScene(page),downloads=[];page.on('download',file=>downloads.push(file.suggestedFilename()));await page.locator('#sequence-export').click();await expect.poll(()=>page.evaluate(()=>window.sequenceEncoderGate.held)).toBe(true);await page.locator('#sequence-cancel').click();
 await expect(page.locator('#sequence-export')).toBeDisabled();await expect(page.locator('#sequence-title')).toBeDisabled();await expect(page.locator('#eyeX')).toBeDisabled();
 await page.evaluate(()=>window.sequenceEncoderGate.release());await expect(page.locator('#sequence-export')).toBeEnabled();await expect(page.locator('#eyeX')).toBeEnabled();expect(downloads).toEqual([]);expect(await sequenceBackup(page)).toEqual(before);expect(await rawScene(page)).toBe(scene);
});
