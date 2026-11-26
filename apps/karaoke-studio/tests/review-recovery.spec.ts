import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function tone(): Buffer {
  const frames = 16 * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
async function withClip(page: Page, run: (id: string) => Promise<void>) {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id));
  let ownedId: string | null = null;
  try {
    await page.goto('/');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'automatic-audition.wav', mimeType: 'audio/wav', buffer: tone() });
    const response = await accepted;
    expect(response.status()).toBe(202);
    ownedId = (await response.json()).job.projectId;
    expect(typeof ownedId).toBe('string');
    await expect(page.locator('#message')).toContainText('3 automatically timed lyric lines', { timeout: 15000 });
    await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
    expect(await page.locator('#projects').inputValue()).toBe(ownedId);
    await run(ownedId!);
  } finally {
    const session = await (await page.request.get('/api/session')).json();
    if (ownedId && session.activeJob?.projectId === ownedId) {
      await page.request.post(`/api/jobs/${session.activeJob.id}/cancel`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
      await expect.poll(async () => (await (await page.request.get(`/api/jobs/${session.activeJob.id}`)).json()).job.status).not.toBe('running');
    }
    const projects = (await (await page.request.get('/api/projects')).json()).projects;
    if (ownedId && projects.some((p: { id: string }) => p.id === ownedId)) {
      expect((await page.request.delete(`/api/projects/${ownedId}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} })).ok()).toBe(true);
    }
    const after: string[] = (await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id);
    expect(after.filter(id => before.has(id)).sort()).toEqual([...before].sort());
    if (ownedId) expect(after).not.toContain(ownedId);
  }
}



for (const width of [1280,390]) test(`opt-in recovery resumes raw review work after reload at ${width}px`, async ({page}) => withClip(page,async id => {
  await page.setViewportSize({width,height:900});
  const before=await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  const keep=page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true});
  await expect(keep).not.toBeChecked(); await keep.check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Recovered correction');
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('1.250');
  await page.getByLabel('Checked automatic line 1',{exact:true}).check();
  await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('');
  await page.getByLabel('Exclude automatic line 2',{exact:true}).check();
  await page.getByLabel('Checked automatic line 2',{exact:true}).check();
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.reload(); await page.locator('#projects').selectOption(id);
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await expect(keep).toBeChecked();
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).not.toHaveValue('Recovered correction');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Recovered correction');
  await expect(page.getByLabel('Reviewed start line 1 (seconds)',{exact:true})).toHaveValue('1.250');
  await expect(page.getByLabel('Reviewed start line 2 (seconds)',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Exclude automatic line 2',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Checked automatic line 1',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Checked automatic line 2',{exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(before);
  await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('Later correction');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  const saved=JSON.parse(await readFile((await(await pending).path())!,'utf8'));
  expect(saved.draft[0].text).toBe('Recovered correction'); expect(saved.draft[2].text).toBe('Later correction');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));

test('a newer recovery in another tab wins atomically while both sets of current edits stay',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('First saved correction');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const other=await page.context().newPage();
  try {
    await other.goto('/');await other.locator('#projects').selectOption(id);
    await other.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
    other.once('dialog',dialog=>dialog.accept());await other.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
    await expect(other.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('First saved correction');
    await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Newer saved correction');
    await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
    await other.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Other tab current draft');
    await expect(other.locator('#review-recovery-status')).toContainText('changed in another tab');
    await expect(other.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Other tab current draft');
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
    const saved=JSON.parse(await readFile((await(await pending).path())!,'utf8'));
    expect(saved.draft[0].text).toBe('Newer saved correction');
    other.once('dialog',dialog=>dialog.accept());await other.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
    await expect(other.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Newer saved correction');
    await other.getByLabel('Reviewed lyric line 3',{exact:true}).fill('Resumed after conflict');
    await expect(other.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  } finally { await other.close(); }
}));

test('a changed native recognition identity cannot silently restore or replace an old recovery',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Old reading correction');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const original=await(await page.request.get(`/api/projects/${id}/transcript`)).json();
  await page.route(`**/api/projects/${id}/transcript`,route=>route.fulfill({json:{...original,identity:'b'.repeat(64)}}));
  await page.reload();await page.locator('#projects').selectOption(id);
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await expect(page.locator('#review-recovery-status')).toContainText('another recognition reading');
  await expect(page.getByRole('button',{name:'Restore recovery copy',exact:true})).toBeDisabled();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('New reading draft');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  const old=JSON.parse(await readFile((await(await pending).path())!,'utf8'));expect(old.draft[0].text).toBe('Old reading correction');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete recovery copy',exact:true}).click();
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy deleted');
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Explicitly kept new reading');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const next=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  const saved=JSON.parse(await readFile((await(await next).path())!,'utf8'));expect(saved.binding).not.toBe(old.binding);expect(saved.draft[0].text).toBe('Explicitly kept new reading');
}));

test('a refused native recovery write keeps the prior copy and unfinished current corrections',async({page})=>withClip(page,async()=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Previous safe copy');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.evaluate(()=>{Object.assign(window,{recoveryPut:IDBObjectStore.prototype.put});IDBObjectStore.prototype.put=function(){throw new DOMException('Recovery quota refused','QuotaExceededError');};});
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Current unsaved correction');
  await expect(page.locator('#review-recovery-status')).toContainText('quota refused');
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Current unsaved correction');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  const safe=JSON.parse(await readFile((await(await pending).path())!,'utf8'));expect(safe.draft[0].text).toBe('Previous safe copy');
  const manual=page.waitForEvent('download');await page.getByRole('button',{name:'Download review checkpoint',exact:true}).click();
  const current=JSON.parse(await readFile((await(await manual).path())!,'utf8'));expect(current.draft[0].text).toBe('Current unsaved correction');
  await page.evaluate(()=>{IDBObjectStore.prototype.put=(window as unknown as {recoveryPut:IDBObjectStore['put']}).recoveryPut;});
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const retried=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  expect(JSON.parse(await readFile((await(await retried).path())!,'utf8')).draft[0].text).toBe('Current unsaved correction');
}));

test('explicit clip deletion removes its recovery after any pending write',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Saved recovery');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Pending correction before deletion');
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete selected clip',exact:true}).click();
  await expect(page.locator('#message')).toContainText('selected clip was deleted');
  const stored=await page.evaluate(projectId=>new Promise(resolve=>{
    const open=indexedDB.open('karaoke-review-recovery',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('copies');const get=tx.objectStore('copies').get(projectId);get.onsuccess=()=>resolve(get.result??null);tx.oncomplete=()=>db.close();};
  }),id);
  expect(stored).toBeNull();
}));

test('a delayed native recovery read cannot replace later edits even if the words return to their old value',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Saved old correction');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.reload();await page.locator('#projects').selectOption(id);await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await expect(page.getByRole('button',{name:'Restore recovery copy',exact:true})).toBeEnabled();
  const field=page.getByLabel('Reviewed lyric line 1',{exact:true});await field.fill('Current reviewed words');
  await page.evaluate(()=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open('karaoke-review-recovery',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('copies','readwrite');
      Object.assign(window,{holdRecoveryRead:true});
      const again=()=>{const get=tx.objectStore('copies').get('hold');get.onsuccess=()=>{if((window as unknown as {holdRecoveryRead:boolean}).holdRecoveryRead)again();};};
      tx.oncomplete=()=>db.close();again();resolve();
    };
  }));
  await page.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
  await field.fill('Later edit');await field.fill('Current reviewed words');
  await page.evaluate(()=>Object.assign(window,{holdRecoveryRead:false}));
  await expect(page.locator('#review-recovery-status')).toContainText('Newer review edits were kept');
  await expect(field).toHaveValue('Current reviewed words');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
  await expect(page.locator('#review-recovery-status')).toContainText('Restoration cancelled');await expect(field).toHaveValue('Current reviewed words');
}));

test('native recovery storage refusal keeps correction and portable checkpoint workflows usable',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Recovery storage denied','SecurityError');}}));
  await withClip(page,async()=>{
    await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
    await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
    await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Keep these words');
    await expect(page.locator('#review-recovery-status')).toContainText('storage denied');
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review checkpoint',exact:true}).click();
    const saved=JSON.parse(await readFile((await(await pending).path())!,'utf8'));expect(saved.draft[0].text).toBe('Keep these words');
  });
});

test('a refused preference change is visibly limited to this session',async({page})=>withClip(page,async()=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='karaoke-review-recovery-enabled')throw new DOMException('Preference denied','SecurityError');return original.call(this,key,value);};});
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await expect(page.locator('#review-recovery-preference')).toContainText('only to this session');
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Session copy');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).uncheck();
  await expect(page.locator('#review-recovery-preference')).toContainText('check the choice after reopening');
}));

test('partial application and Save keep recovery separate and cancelled deletion keeps autosaving',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Applied correction');
  await page.getByRole('button',{name:'Apply only reviewed line 1',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('Unapplied correction');
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();
  await expect(page.locator('#message')).toContainText('Lyrics and timing saved locally');
  const saved=await(await page.request.get(`/api/projects/${id}`)).json();
  expect(saved.cues[0].text).toBe('Applied correction');expect(saved.cues[2].text).not.toBe('Unapplied correction');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Delete recovery copy',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('After cancelled deletion');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).uncheck();
  await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('Session only after opt out');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  expect(JSON.parse(await readFile((await(await pending).path())!,'utf8')).draft[2].text).toBe('After cancelled deletion');
}));

test('native storage capacity refuses a new clip without eviction and permits updates at the cap',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Initial correction');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.evaluate(projectId=>new Promise<void>((resolve,reject)=>{
    const open=indexedDB.open('karaoke-review-recovery',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies'),get=store.get(projectId);
      get.onsuccess=()=>{const record=get.result;store.delete(projectId);for(let i=0;i<20;i++)store.put({...record,projectId:`held-${i}`,revision:crypto.randomUUID()});};
      tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);
    };
  }),id);
  await page.reload();await page.locator('#projects').selectOption(id);await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('New correction at capacity');
  await expect(page.locator('#review-recovery-status')).toContainText('nothing was evicted');
  const keys=await page.evaluate(()=>new Promise<IDBValidKey[]>(resolve=>{const open=indexedDB.open('karaoke-review-recovery',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('copies'),get=tx.objectStore('copies').getAllKeys();get.onsuccess=()=>resolve(get.result);tx.oncomplete=()=>db.close();};}));
  expect(keys).toHaveLength(20);expect(keys).not.toContain(id);
  await page.evaluate(()=>new Promise<void>(resolve=>{const open=indexedDB.open('karaoke-review-recovery',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('copies','readwrite');tx.objectStore('copies').delete('held-0');tx.oncomplete=()=>{db.close();resolve();};};}));
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Updated twentieth copy');await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  expect(JSON.parse(await readFile((await(await pending).path())!,'utf8')).draft[0].text).toBe('Updated twentieth copy');
}));

test('turning recovery off in one tab stops new private copies in another tab',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Copy kept after opt out');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  const other=await page.context().newPage();
  try {
    await other.goto('/');await other.locator('#projects').selectOption(id);await other.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
    other.once('dialog',dialog=>dialog.accept());await other.getByRole('button',{name:'Restore recovery copy',exact:true}).click();
    await other.evaluate(()=>new Promise<void>(resolve=>{
      const open=indexedDB.open('karaoke-review-recovery',1);open.onsuccess=()=>{
        const db=open.result,tx=db.transaction('copies','readwrite');Object.assign(window,{holdRecoveryWrite:true,recoveryWriteQueued:false});
        const again=()=>{const get=tx.objectStore('copies').get('hold');get.onsuccess=()=>{if((window as unknown as {holdRecoveryWrite:boolean}).holdRecoveryWrite)again();};};
        tx.oncomplete=()=>db.close();again();
        const original=IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction=function(...args:Parameters<IDBDatabase['transaction']>){const result=original.apply(this,args);if(args[1]==='readwrite')Object.assign(window,{recoveryWriteQueued:true});return result;};resolve();
      };
    }));
    await other.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Queued words before opt out');
    await expect.poll(()=>other.evaluate(()=>(window as unknown as {recoveryWriteQueued:boolean}).recoveryWriteQueued)).toBe(true);
    await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).uncheck();
    await expect(other.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true})).not.toBeChecked();
    await other.evaluate(()=>Object.assign(window,{holdRecoveryWrite:false}));
    await other.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Private words after opt out');
    const pending=other.waitForEvent('download');await other.getByRole('button',{name:'Download recovery copy',exact:true}).click();
    expect(JSON.parse(await readFile((await(await pending).path())!,'utf8')).draft[0].text).toBe('Copy kept after opt out');
  } finally {await other.close();}
}));

test('a stale tab cannot create its first recovery after another tab deleted the clip',async({page})=>withClip(page,async id=>{
  const other=await page.context().newPage();
  try {
    await other.goto('/');await other.locator('#projects').selectOption(id);await other.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
    await expect(other.locator('#review-recovery-status')).toContainText('Recovery is off');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Delete selected clip',exact:true}).click();
    await expect(page.locator('#message')).toContainText('selected clip was deleted');
    await other.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
    await other.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Stale private correction');
    await expect(other.locator('#review-recovery-status')).toContainText('clip was deleted');
    const stored=await other.evaluate(projectId=>new Promise(resolve=>{const open=indexedDB.open('karaoke-review-recovery',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('copies'),get=tx.objectStore('copies').get(projectId);get.onsuccess=()=>resolve(get.result??null);tx.oncomplete=()=>db.close();};}),id);
    expect(stored).toBeNull();await expect(other.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Stale private correction');
  } finally {await other.close();}
}));

test('a corrected oversized draft retries recovery and still refuses a competing revision',async({page})=>withClip(page,async id=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByRole('checkbox',{name:'Keep a recovery copy in this browser',exact:true}).check();
  const field=page.getByLabel('Reviewed lyric line 1',{exact:true});await field.fill('x'.repeat(2049));
  await expect(page.locator('#review-recovery-status')).toContainText('valid review checkpoint');
  await field.fill('Corrected within the bound');
  await expect(page.locator('#review-recovery-status')).toContainText('Recovery copy saved');
  await field.fill('x'.repeat(2049));await expect(page.locator('#review-recovery-status')).toContainText('valid review checkpoint');
  await page.evaluate(projectId=>new Promise<void>(resolve=>{const open=indexedDB.open('karaoke-review-recovery',1);open.onsuccess=()=>{const db=open.result,tx=db.transaction('copies','readwrite'),store=tx.objectStore('copies'),get=store.get(projectId);get.onsuccess=()=>store.put({...get.result,revision:crypto.randomUUID()});tx.oncomplete=()=>{db.close();resolve();};};}),id);
  await field.fill('New current draft after another tab changed the copy');
  await expect(page.locator('#review-recovery-status')).toContainText('changed in another tab');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download recovery copy',exact:true}).click();
  expect(JSON.parse(await readFile((await(await pending).path())!,'utf8')).draft[0].text).toBe('Corrected within the bound');
}));
