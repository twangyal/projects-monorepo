import {storedSequenceText,legacySequenceText} from './sequence-storage-fixtures.js';
import {test,expect} from '@playwright/test';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {trimSequence,legacyTrimSequence,migratedTrimSequence,trimBackup,trimDownload,trimSha,seekTrim,settleTrim,trimCanvas,verifyTrimPixels,decodeTrimVideo} from './sequence-trim-fixtures.js';

const KEY='shot-studio-sequence-v1';
const clips=page=>page.locator('#sequence-clips [data-sequence-clip-id]');
const fieldIn=page=>page.locator('#sequence-clip-in');
const fieldOut=page=>page.locator('#sequence-clip-out');
const raw=storedSequenceText;
async function load(page,value=trimSequence()){
 await page.goto('/');await expect(page.locator('#sequence-open')).toBeEnabled();const accept=dialog=>dialog.accept();page.on('dialog',accept);
 try{await page.locator('#sequence-open').setInputFiles({name:'literal-trim.shot-sequence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await expect(page.locator('#sequence-title')).toHaveValue(value.title);await expect.poll(async()=>JSON.parse(await raw(page))).toEqual(value);}finally{page.off('dialog',accept);}
 // Import is an Undo edit. Start range assertions from a genuinely persisted reload.
 const persisted=await raw(page);await page.reload();await expect(page.locator('#sequence-title')).toHaveValue(value.title);expect(await raw(page)).toBe(persisted);
 await clips(page).first().click();
}
async function apply(page,start,end){await fieldIn(page).fill(String(start));await fieldOut(page).fill(String(end));await page.locator('#sequence-range-apply').click();}
async function gateFile(page){await page.evaluate(()=>{const native=File.prototype.text;window.trimFileGate={pending:[],enabled:true};File.prototype.text=async function(){const text=await native.call(this);if(this.name.startsWith('held-')&&window.trimFileGate.enabled)await new Promise(resolve=>window.trimFileGate.pending.push(resolve));return text;};});}
async function releaseFile(page){await page.evaluate(()=>{window.trimFileGate.enabled=false;window.trimFileGate.pending.splice(0).forEach(resolve=>resolve());});await settleTrim(page);}
async function holdImport(page,value){const accept=dialog=>dialog.accept();page.on('dialog',accept);await page.locator('#sequence-open').setInputFiles({name:'held-original.shot-sequence.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});await expect.poll(()=>page.evaluate(()=>window.trimFileGate.pending.length)).toBe(1);page.off('dialog',accept);}

test('range Apply and whole-shot Reset each produce exactly one undoable edit without changing source films',async({page})=>{
 await load(page);const initial=await trimBackup(page),sourceBytes=JSON.stringify(initial.sources);await expect(fieldIn(page)).toHaveAttribute('step','any');await expect(fieldOut(page)).toHaveAttribute('step','any');
 await apply(page,1.25,2.75);const changed=await trimBackup(page);expect(changed.clips[0]).toEqual({...initial.clips[0],inTime:1.25,outTime:2.75});expect(changed.clips.slice(1)).toEqual(initial.clips.slice(1));expect(JSON.stringify(changed.sources)).toBe(sourceBytes);await expect(page.locator('#sequence-range-info')).toContainText('1.5');
 await page.locator('#sequence-undo').click();expect(await trimBackup(page)).toEqual(initial);await expect(page.locator('#sequence-undo')).toBeDisabled();await page.locator('#sequence-redo').click();expect(await trimBackup(page)).toEqual(changed);
 await page.locator('#sequence-range-reset').click();const reset=await trimBackup(page);expect(reset.clips[0]).toEqual({...initial.clips[0],inTime:0,outTime:4});expect(JSON.stringify(reset.sources)).toBe(sourceBytes);await page.locator('#sequence-undo').click();expect(await trimBackup(page)).toEqual(changed);await page.locator('#sequence-redo').click();expect(await trimBackup(page)).toEqual(reset);
});

test('trimmed preview uses original travel and performer clocks at interior cuts and explicit endpoints',async({page},info)=>{
 await load(page);const before=await trimBackup(page),ordinary=await page.evaluate(()=>localStorage.getItem('shot-studio-v1')),samples=[];
 for(const time of [0,.2,1.1,1.8,2,2.3,3.6,4,4.2,5.8,6]){await seekTrim(page,time);samples.push(verifyTrimPixels(await trimCanvas(page),time));}
 await clips(page).first().click();await page.locator('#sequence-preview-end').click();await settleTrim(page);verifyTrimPixels(await trimCanvas(page),2,{index:0,local:2,shotLocal:3,sourceGlobal:5.3,cameraX:1,kind:'red'});await expect(page.locator('#sequence-source-time')).toContainText('5.30');
 await page.locator('#sequence-preview-start').click();await settleTrim(page);verifyTrimPixels(await trimCanvas(page),0);await expect(page.locator('#sequence-source-time')).toContainText('3.30');expect(await trimBackup(page)).toEqual(before);expect(await page.evaluate(()=>localStorage.getItem('shot-studio-v1'))).toBe(ordinary);
 await writeFile(info.outputPath('original-trim-preview-pixels.json'),JSON.stringify({sourcesSha256:trimSha(JSON.stringify(before.sources)),samples},null,2));
});

test('actual six-second trimmed WebM preserves original source phases and repeated excerpts',async({page},info)=>{
 test.setTimeout(45000);await load(page);const before=await trimBackup(page),video=await trimDownload(page,'#sequence-export');expect(video.name).toMatch(/\.webm$/i);const receipt=await decodeTrimVideo(video.bytes,info.outputPath('original-trim-six-seconds.webm'));expect(await trimBackup(page)).toEqual(before);expect(await page.locator('#take-list [data-take-id]').count()).toBe(0);await writeFile(info.outputPath('original-trim-video.json'),JSON.stringify(receipt,null,2));await writeFile(info.outputPath('original-trim-backup.json'),JSON.stringify(before));
});

test('invalid ranges preserve native raw nodes and focus and an identical Apply preserves redo',async({page})=>{
 await load(page);const original=await trimBackup(page);await apply(page,1.25,2.75);const changed=await trimBackup(page);await page.locator('#sequence-undo').click();await expect(page.locator('#sequence-redo')).toBeEnabled();
 const start=fieldIn(page),end=fieldOut(page);await start.fill('1.0000');await end.fill('');await start.evaluate(node=>node.dataset.trimIdentity='same-start');await end.evaluate(node=>node.dataset.trimIdentity='same-end');await end.focus();await page.locator('#sequence-range-apply').evaluate(button=>button.click());await expect(end).toBeFocused();await expect(start).toHaveValue('1.0000');await expect(end).toHaveValue('');await expect(start).toHaveAttribute('data-trim-identity','same-start');await expect(end).toHaveAttribute('data-trim-identity','same-end');expect(await trimBackup(page)).toEqual(original);await expect(page.locator('#sequence-redo')).toBeEnabled();
 await start.fill('1.0000');await end.fill('3.0000');await page.locator('#sequence-range-apply').click();expect(await trimBackup(page)).toEqual(original);await expect(page.locator('#sequence-redo')).toBeEnabled();await page.locator('#sequence-redo').click();expect(await trimBackup(page)).toEqual(changed);
});

test('represented minimum span and source bounds refuse atomically without clamping authored values',async({page})=>{
 await load(page);const before=await trimBackup(page);
 for(const [start,end] of [[1,1],[2,1],[-.1,1],[0,4.0001],[.2,.3]]){await apply(page,start,end);if(start===.2&&end===.3)await expect(page.locator('#sequence-status')).toContainText('0.09999999999999998');expect(await trimBackup(page)).toEqual(before);await expect(fieldIn(page)).toHaveValue(String(start));await expect(fieldOut(page)).toHaveValue(String(end));await expect(page.locator('#sequence-undo')).toBeDisabled();}
 await apply(page,0,.1);const exact=await trimBackup(page);expect(exact.clips[0].inTime).toBe(0);expect(exact.clips[0].outTime).toBe(.1);await page.locator('#sequence-undo').click();expect(await trimBackup(page)).toEqual(before);
});

test('repeating and reordering preserve independent committed ranges and all original source bytes',async({page})=>{
 await load(page);const initial=await trimBackup(page);await page.locator('#sequence-repeat').click();const repeated=await trimBackup(page),copy=repeated.clips.find(clip=>!initial.clips.some(old=>old.id===clip.id));expect(copy).toBeTruthy();expect({...copy,id:initial.clips[0].id}).toEqual(initial.clips[0]);
 await apply(page,1.4,2.4);const edited=await trimBackup(page);expect(edited.clips.find(clip=>clip.id===initial.clips[0].id)).toEqual(initial.clips[0]);expect(edited.clips.find(clip=>clip.id===copy.id)).toEqual({...copy,inTime:1.4,outTime:2.4});await page.locator('#sequence-earlier').click();const moved=await trimBackup(page);expect(moved.clips.find(clip=>clip.id===copy.id)).toEqual({...copy,inTime:1.4,outTime:2.4});expect(moved.clips.map(clip=>clip.id)).not.toEqual(edited.clips.map(clip=>clip.id));expect(moved.sources).toEqual(initial.sources);await page.locator('#sequence-undo').click();expect(await trimBackup(page)).toEqual(edited);
});

for(const [version,form] of [[1,'name'],[1,'rich'],[2,'rich']])test(`literal schema${version} ${form} startup migrates full ranges without rewriting saved bytes`,async({page})=>{
 const old=legacyTrimSequence(version,form),text=JSON.stringify(old,null,2),expected=migratedTrimSequence(old);await page.goto('/');await page.evaluate(({key,text})=>localStorage.setItem(key,text),{key:KEY,text});await page.reload();await expect(page.locator('#sequence-title')).toHaveValue(old.title);expect(await raw(page)).toBe(text);expect(await trimBackup(page)).toEqual(expected);expect(await raw(page)).toBe(text);await clips(page).first().click();await apply(page,1,3);expected.clips[0].inTime=1;expected.clips[0].outTime=3;expect(await trimBackup(page)).toEqual(expected);await expect.poll(async()=>JSON.parse(await raw(page))).toEqual(expected);expect(await legacySequenceText(page)).toBe(text);await page.reload();await expect(fieldIn(page)).toHaveValue('1');expect(await trimBackup(page)).toEqual(expected);
});

test('changed-back trim intent retires a held genuine sequence File read without clearing raw fields',async({page})=>{
 await load(page);const before=await trimBackup(page);await gateFile(page);const incoming=trimSequence();incoming.title='Older held replacement';await holdImport(page,incoming);const start=fieldIn(page);await start.fill('1.75');await start.fill('1.0000');await start.evaluate(node=>node.dataset.trimIdentity='held-start');await start.focus();await releaseFile(page);await expect(start).toBeFocused();await expect(start).toHaveValue('1.0000');await expect(start).toHaveAttribute('data-trim-identity','held-start');expect(await trimBackup(page)).toEqual(before);expect(JSON.parse(await raw(page))).toEqual(before);
});

test('controlled pagehide retires a pending real import and failed imports preserve applied ranges',async({page})=>{
 await load(page);const before=await trimBackup(page);await gateFile(page);const incoming=trimSequence();incoming.title='Retired on pagehide';await holdImport(page,incoming);await page.evaluate(()=>{dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});await releaseFile(page);expect(await trimBackup(page)).toEqual(before);const accept=dialog=>dialog.accept();page.on('dialog',accept);await page.locator('#sequence-open').setInputFiles({name:'invalid-range.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...incoming,clips:[{...incoming.clips[0],outTime:99}]}))});await expect(page.locator('#sequence-status')).toContainText(/range|out|duration|invalid|shot/i);page.off('dialog',accept);expect(await trimBackup(page)).toEqual(before);expect(JSON.parse(await raw(page))).toEqual(before);
});

test('390px keyboard editing and cancelled discard keep unfinished range and neighboring literal label intact',async({page},info)=>{
 await load(page);await page.setViewportSize({width:390,height:844});const before=await trimBackup(page),label=page.locator('#sequence-clip-label');await label.fill('Unapplied Ω <literal>');await label.evaluate(node=>{node.dataset.trimLabelIdentity='same';node.setSelectionRange(3,3);});await fieldOut(page).fill('');await fieldOut(page).evaluate(node=>node.dataset.trimIdentity='same-out');page.once('dialog',dialog=>dialog.dismiss());await clips(page).nth(1).click();await expect(fieldOut(page)).toHaveValue('');await expect(fieldOut(page)).toHaveAttribute('data-trim-identity','same-out');await expect(label).toHaveValue('Unapplied Ω <literal>');await expect(label).toHaveAttribute('data-trim-label-identity','same');expect(await trimBackup(page)).toEqual(before);
 page.once('dialog',dialog=>dialog.accept());await page.locator('#sequence-discard-edits').click();await fieldIn(page).fill('1.25');await fieldOut(page).fill('2.75');await page.locator('#sequence-range-apply').focus();await page.keyboard.press('Enter');expect((await trimBackup(page)).clips[0]).toEqual({...before.clips[0],inTime:1.25,outTime:2.75});await page.locator('#sequence-preview-end').focus();await page.keyboard.press('Enter');await expect(page.locator('#sequence-source-time')).toContainText('5.05');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.locator('#sequence-range-info').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('trim-390px.png'),fullPage:true});
});

test('a stale tab retains new trim in protected memory without overwriting a foreign saved range',async({page,context})=>{
 await load(page);const initial=await trimBackup(page),stale=await context.newPage();await stale.goto('/');await expect(stale.locator('#sequence-title')).toHaveValue(initial.title);await clips(stale).first().click();await apply(page,1.2,2.8);const winner=await raw(page);await apply(stale,1.4,2.6);await expect(stale.locator('#sequence-save-status')).toContainText(/protected|memory|another|changed/i);const memory=await trimBackup(stale);expect(memory.clips[0]).toEqual({...initial.clips[0],inTime:1.4,outTime:2.6});expect(await raw(stale)).toBe(winner);expect(memory.sources).toEqual(initial.sources);await stale.locator('#sequence-undo').click();expect(await trimBackup(stale)).toEqual(initial);expect(await raw(stale)).toBe(winner);await stale.close();
});

test('actual export cancellation after progress leaves committed source ranges and history intact',async({page})=>{
 await load(page);const before=await trimBackup(page);await page.locator('#sequence-export').click();await expect.poll(()=>page.locator('#sequence-export-progress').evaluate(node=>node.value)).toBeGreaterThan(0);await expect(fieldIn(page)).toBeDisabled();await expect(fieldOut(page)).toBeDisabled();await page.locator('#sequence-cancel').click();await expect(page.locator('#sequence-export')).toBeEnabled();expect(await trimBackup(page)).toEqual(before);await expect(page.locator('#sequence-undo')).toBeDisabled();
});

test('complete trimmed backup survives a whole persistent-browser restart byte for byte',async({browser},info)=>{
 test.setTimeout(45000);const profile=await mkdtemp(join(tmpdir(),'shot114-trim-profile-')),sessions=[];const options={...info.project.use.launchOptions,headless:true,baseURL:info.project.use.baseURL,acceptDownloads:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})};let firstBytes;
 try{for(let index=0;index<2;index++){const context=await browser.browserType().launchPersistentContext(profile,options),entry={opened:true,closed:false};sessions.push(entry);try{const page=context.pages()[0]??await context.newPage();if(!index){await load(page);await apply(page,1.125,2.875);firstBytes=(await trimDownload(page)).bytes;await writeFile(info.outputPath('persistent-original-trim.json'),firstBytes);}else{await page.goto('/');await expect(page.locator('#sequence-title')).toHaveValue(trimSequence().title);await expect(fieldIn(page)).toHaveValue('1.125');const restored=(await trimDownload(page)).bytes;await writeFile(info.outputPath('persistent-reopened-trim.json'),restored);expect(restored.equals(firstBytes)).toBe(true);expect(JSON.parse(restored).sources).toEqual(trimSequence().sources);}}finally{await context.close();entry.closed=true;}}}finally{await rm(profile,{recursive:true,force:true});await writeFile(info.outputPath('persistent-trim-receipt.json'),JSON.stringify({bytes:firstBytes?.length,sha256:firstBytes?trimSha(firstBytes):null,processContexts:sessions,allClosed:sessions.every(entry=>entry.closed)},null,2));}
});
