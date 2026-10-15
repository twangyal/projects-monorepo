import {test,expect,type Page} from '@playwright/test';
import {rollBackup,readRoll,assertMidi,rollDownload} from './roll-edit-fixtures.ts';

async function view(page:Page,name:string){await page.getByRole('button',{name,exact:true}).click();}
async function open(page:Page){
 await page.goto('/');await expect(page.locator('#project-title')).toBeEnabled();
 await view(page,'Project & export');
 page.on('dialog',dialog=>dialog.accept());
 await page.getByLabel('Open project file',{exact:true}).setInputFiles({name:'workspace.melody.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(rollBackup()))});
 await expect(page.locator('#project-title')).toHaveValue('Original fractional overlap');
 await view(page,'Compose');
}

test('focused composing hides unrelated forms and exposes every contextual section without replacing controls',async({page})=>{
 await open(page);
 await expect(page.locator('.piano-roll')).toBeVisible();
 await expect(page.locator('.capture-card')).toBeHidden();
 await expect(page.locator('.track-settings')).toBeHidden();
 await expect(page.locator('#composition-library')).toBeHidden();
 const roll=await page.locator('.piano-roll').elementHandle();
 for(const [name,selector] of [['Capture','.capture-card'],['Sound','.track-settings'],['Notes','#note-form'],['Arrange','#continuation-panel'],['Reference','#reference-panel'],['Project & export','#composition-library']]){
  await view(page,name);await expect(page.locator(selector)).toBeVisible();
  expect(await page.locator('.piano-roll').evaluate((node,original)=>node===original,roll)).toBe(true);
 }
 await page.keyboard.press('Escape');await expect(page.locator('[data-workspace-view="compose"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#workspace-mode').click();await expect(page.locator('.capture-card')).toBeVisible();await expect(page.locator('.track-settings')).toBeVisible();await expect(page.locator('#reference-panel')).toBeVisible();
 await page.locator('#workspace-mode').click();await expect(page.locator('.track-settings')).toBeHidden();
});

test('pointer and keyboard navigation retain valid and invalid drafts without committing or changing history',async({page})=>{
 await open(page);await view(page,'Sound');
 await page.locator('#track-name').fill('Unapplied name');await view(page,'Arrange');
 await view(page,'Project & export');expect(await readRoll(page)).toEqual(rollBackup());
 await view(page,'Sound');await expect(page.locator('#track-name')).toHaveValue('Unapplied name');
 await page.locator('#track-name').focus();await page.keyboard.press('Escape');
 await view(page,'Project & export');expect(await readRoll(page)).toEqual(rollBackup());
 await view(page,'Sound');await page.locator('#track-name').press('Enter');
 await view(page,'Notes');await page.locator('[data-note="fractional-low"]').click();await page.locator('[name="duration"]').fill('');
 await view(page,'Reference');await view(page,'Notes');await expect(page.locator('[name="duration"]')).toHaveValue('');
 await expect(page.locator('[data-note="fractional-low"]')).toHaveAttribute('aria-pressed','true');
 await view(page,'Project & export');const result=await readRoll(page);expect(result.document.composition.tracks[0].name).toBe('Unapplied name');expect(result.assets).toEqual(rollBackup().assets);
});

for(const width of [1280,390])test(`focused load edit history listen and export at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await open(page);
 await page.locator('[data-note="fractional-low"]').click();await expect(page.locator('#note-form')).toBeVisible();
 await page.locator('[name="pitch"]').fill('62');await page.getByRole('button',{name:'Apply note',exact:true}).click();
 await view(page,'Compose');await page.getByRole('button',{name:'Undo',exact:true}).click();await page.getByRole('button',{name:'Redo',exact:true}).click();
 await page.getByRole('button',{name:'Play composition',exact:true}).click();await view(page,'Project & export');
 await expect(page.getByRole('button',{name:'Stop audio',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Stop audio',exact:true}).click();
 const saved=await readRoll(page);expect(saved.assets).toEqual(rollBackup().assets);expect(saved.document.composition.tracks[0].notes[0].pitch).toBe(62);
 assertMidi(await rollDownload(page,'Export MIDI'),saved.document.composition);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.reload();await expect(page.locator('#project-title')).toHaveValue(saved.document.composition.title);
 await view(page,'Project & export');expect(await readRoll(page)).toEqual(saved);
});

import {installProbe,control,probe,seedRows,literalRow,selectCopy,originalCopy} from './library-fixtures.ts';
import {installAudioProbe,audioProbe,controlProbe} from './browser/continuation-fixtures.ts';
import {microphone,probe as microphoneProbe,releasePermission} from './backed-recording-fixtures.ts';

test('navigation preserves an already-authorized saved-composition read',async({page})=>{
 await installProbe(page);await open(page);await view(page,'Project & export');
 await seedRows(page,[literalRow(2)]);await selectCopy(page,literalRow(2).id);await control(page,'holdRead');
 await page.locator('#library-open').click();await expect.poll(async()=>(await probe(page)).pendingReads).toBe(1);
 await view(page,'Compose');await view(page,'Reference');await control(page,'releaseRead');
 await expect(page.locator('#project-title')).toHaveValue(originalCopy(2).document.composition.title);
 await view(page,'Project & export');expect((await readRoll(page)).document).toEqual(originalCopy(2).document);
});

test('switching sections neither starts nor retires a pending playback; global Stop retires it',async({page})=>{
 await installAudioProbe(page);await open(page);await controlProbe(page,'holdReplies');
 await page.getByRole('button',{name:'Play composition',exact:true}).click();
 await expect.poll(async()=>(await audioProbe(page)).pendingReplies).toBe(1);
 await view(page,'Reference');await view(page,'Project & export');
 expect((await audioProbe(page)).starts).toHaveLength(0);
 await page.getByRole('button',{name:'Stop audio',exact:true}).click();await controlProbe(page,'releaseAll');
 await expect.poll(async()=>(await audioProbe(page)).pendingReplies).toBe(0);
 expect((await audioProbe(page)).starts).toHaveLength(0);expect(await readRoll(page)).toEqual(rollBackup());
});

test('capture remains cancellable after navigation and releases late microphone permission',async({page})=>{
 await microphone(page,true);await open(page);await view(page,'Capture');
 await page.getByRole('button',{name:'Record melody',exact:true}).click();await expect(page.locator('#capture-state')).toContainText('permission');
 await view(page,'Project & export');await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await releasePermission(page);
 await expect.poll(async()=>(await microphoneProbe(page)).stopped).toBeGreaterThan(0);
 expect(await readRoll(page)).toEqual(rollBackup());
});

test('expanded-mode navigation keeps a valid track draft unapplied',async({page})=>{
 await open(page);await page.locator('#workspace-mode').click();await page.locator('#track-name').fill('Expanded raw draft');
 await page.getByRole('button',{name:'Focus workspace',exact:true}).click();await view(page,'Project & export');
 expect(await readRoll(page)).toEqual(rollBackup());
 await view(page,'Sound');await expect(page.locator('#track-name')).toHaveValue('Expanded raw draft');
});

for(const expanded of [false,true])test(`keyboard workspace mode change preserves text from expanded=${expanded}`,async({page})=>{
 await open(page);await view(page,'Sound');if(expanded)await page.locator('#workspace-mode').click();
 await page.locator('#track-name').fill('Keyboard retained track');
 await page.locator('#workspace-mode').focus();await page.keyboard.press('Enter');await view(page,'Project & export');
 expect(await readRoll(page)).toEqual(rollBackup());
});

test('protected recovery is visible and reachable from focused Compose',async({page})=>{
 await open(page);await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('melody-studio.projects');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),get=store.getAll();
  get.onsuccess=()=>{const value=get.result[0];value.pcm=new Blob([new Uint8Array(value.frameCount*2)]);store.put(value,value.id);};
  await new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
 });
 await page.reload();await expect(page.locator('#workspace-save-feedback')).toContainText('protected recovery');
 await page.getByRole('button',{name:'Review save recovery',exact:true}).click();await expect(page.locator('#retry-load')).toBeVisible();
});

test('phone composing shows the piano roll and contextual fields clear the actual toolbar height',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('#project-title')).toBeEnabled();
 const roll=await page.locator('.piano-roll').boundingBox();expect(roll!.y).toBeLessThan(744);
 await view(page,'Sound');const field=await page.locator('#track-name').boundingBox(),tools=await page.locator('.workspace-tools').boundingBox();
 expect(field!.y).toBeGreaterThanOrEqual(tools!.y+tools!.height);
});

test('persistent reference tools keep workspace navigation available while scrolling',async({page})=>{
 await page.setViewportSize({width:390,height:844});await open(page);await view(page,'Reference');
 await page.locator('#reference-panel').evaluate(node=>node.scrollIntoView({block:'end'}));
 const toolbar=await page.locator('.workspace-tools').boundingBox();expect(toolbar!.y).toBeGreaterThanOrEqual(0);expect(toolbar!.y).toBeLessThan(10);
 await view(page,'Compose');await expect(page.getByRole('button',{name:'Compose',exact:true})).toBeFocused();
});

test('cross-section capture cancellation returns keyboard focus to a visible workspace control',async({page})=>{
 await microphone(page,true);await open(page);await view(page,'Capture');await page.getByRole('button',{name:'Record melody',exact:true}).click();
 await expect(page.locator('#capture-state')).toContainText('permission');await view(page,'Project & export');
 await page.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Project & export',exact:true})).toBeFocused();
 await releasePermission(page);await expect.poll(async()=>(await microphoneProbe(page)).stopped).toBeGreaterThan(0);
});


test('focused capture demo produces editable notes and an exportable retained take',async({page})=>{
 await page.goto('/');await expect(page.locator('#project-title')).toBeEnabled();await view(page,'Capture');
 await page.getByRole('button',{name:'Try demo melody',exact:true}).click();
 await expect(page.locator('[data-note]').first()).toBeEnabled();await view(page,'Reference');
 await expect(page.locator('#reference-summary')).toContainText(/demo/i);
 await view(page,'Compose');await page.locator('[data-note]').first().click();await expect(page.locator('#note-form')).toBeVisible();
 await view(page,'Project & export');const result=await readRoll(page);expect(result.assets).toHaveLength(1);expect(result.document.composition.tracks[0].notes.length).toBeGreaterThan(3);
 const bytes=await rollDownload(page,'Export WAV');expect(bytes.toString('ascii',0,4)).toBe('RIFF');expect(bytes.toString('ascii',8,12)).toBe('WAVE');
});

for(const utility of ['Stop audio','About these tools'])test(`workspace utility ${utility} preserves unapplied track text`,async({page})=>{
 await open(page);await view(page,'Sound');await page.locator('#track-name').fill('Retained utility draft');
 const control=utility==='Stop audio'?page.getByRole('button',{name:utility,exact:true}):page.locator('#workspace-guidance summary');
 await control.focus();await page.keyboard.press('Enter');await view(page,'Project & export');
 expect(await readRoll(page)).toEqual(rollBackup());await view(page,'Sound');await expect(page.locator('#track-name')).toHaveValue('Retained utility draft');
});

test('passive title blur toward an audio utility keeps an authorized library read',async({page})=>{
 await installProbe(page);await open(page);await view(page,'Project & export');
 await seedRows(page,[literalRow(2)]);await selectCopy(page,literalRow(2).id);
 await page.locator('#project-title').fill('Unapplied title before authorized Open');await control(page,'holdRead');
 await page.locator('#library-open').click();await expect.poll(async()=>(await probe(page)).pendingReads).toBe(1);
 await page.getByRole('button',{name:'Stop audio',exact:true}).focus();await page.keyboard.press('Enter');
 await control(page,'releaseRead');await expect(page.locator('#project-title')).toHaveValue(originalCopy(2).document.composition.title);
});
