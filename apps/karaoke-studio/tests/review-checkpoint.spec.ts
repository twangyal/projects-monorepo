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



for (const width of [1280,390]) test(`review checkpoint resumes raw corrections after reload without applying lyrics at ${width}px`, async ({page}) => withClip(page,async id => {
  await page.setViewportSize({width,height:900});
  const before=await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  const download=page.getByRole('button',{name:'Download review checkpoint',exact:true});
  await expect(download).toBeVisible({timeout:1500});
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Checkpoint correction');
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('1.250');
  await page.getByLabel('Checked automatic line 1',{exact:true}).check();
  await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('');
  await page.getByLabel('Exclude automatic line 2',{exact:true}).check();
  await page.getByLabel('Checked automatic line 2',{exact:true}).check();
  const pending=page.waitForEvent('download');await download.click();const raw=await readFile((await(await pending).path())!,'utf8');
  await page.reload();await page.locator('#projects').selectOption(id);await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Unfinished replacement');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByLabel('Restore review checkpoint',{exact:true}).setInputFiles({name:'saved.review.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Checkpoint correction');
  await expect(page.getByLabel('Reviewed start line 1 (seconds)',{exact:true})).toHaveValue('1.250');
  await expect(page.getByLabel('Reviewed start line 2 (seconds)',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Exclude automatic line 2',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Checked automatic line 1',{exact:true})).toBeChecked();await expect(page.getByLabel('Checked automatic line 2',{exact:true})).toBeChecked();
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(before);await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
  const mismatched=JSON.parse(raw);mismatched.binding='0'.repeat(64);
  await page.getByLabel('Restore review checkpoint',{exact:true}).setInputFiles({name:'other.review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mismatched))});
  await expect(page.locator('#review-checkpoint-status')).toContainText('matching');await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Checkpoint correction');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));

test('a delayed checkpoint file cannot overwrite newer review corrections',async({page})=>{
  await page.addInitScript(()=>{const read=File.prototype.arrayBuffer;File.prototype.arrayBuffer=function(){const raw=read.call(this);return this.name==='late.review.json'?new Promise<ArrayBuffer>(resolve=>Object.assign(window,{releaseCheckpoint:()=>resolve(raw)})):raw;};});
  await withClip(page,async()=>{
    await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
    const button=page.getByRole('button',{name:'Download review checkpoint',exact:true});await expect(button).toBeVisible({timeout:1500});
    const pending=page.waitForEvent('download');await button.click();const raw=await readFile((await(await pending).path())!,'utf8');
    await page.getByLabel('Restore review checkpoint',{exact:true}).setInputFiles({name:'late.review.json',mimeType:'application/json',buffer:Buffer.from(raw)});
    await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Newer correction wins');
    await page.evaluate(()=>(window as unknown as {releaseCheckpoint:()=>Promise<void>}).releaseCheckpoint());
    await expect(page.locator('#review-checkpoint-status')).toContainText('Newer');await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Newer correction wins');
  });
});

for(const change of ['words return to their old value','checked marker toggled twice','applied line'])test(`a delayed checkpoint retires after ${change}`,async({page})=>{
  await page.addInitScript(()=>{const read=File.prototype.arrayBuffer,text=File.prototype.text;const held=<T>(value:Promise<T>)=>new Promise<T>(resolve=>Object.assign(window,{releaseCheckpoint:()=>resolve(value)}));File.prototype.arrayBuffer=function(){const value=read.call(this);return this.name==='late.review.json'?held(value):value;};File.prototype.text=function(){const value=text.call(this);return this.name==='late.review.json'?held(value):value;};});
  await withClip(page,async()=>{
    await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();const field=page.getByLabel('Reviewed lyric line 1',{exact:true});
    await field.fill('OLD checkpoint');const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review checkpoint',exact:true}).click();const raw=await readFile((await(await pending).path())!,'utf8');
    await field.fill('Keep');await page.getByLabel('Restore review checkpoint',{exact:true}).setInputFiles({name:'late.review.json',mimeType:'application/json',buffer:Buffer.from(raw)});
    if(change==='words return to their old value'){await field.fill('Try');await field.fill('Keep');}
    if(change==='checked marker toggled twice'){const checked=page.getByLabel('Checked automatic line 1',{exact:true});await checked.check();await checked.uncheck();}
    if(change==='applied line')await page.getByRole('button',{name:'Apply only reviewed line 1',exact:true}).click();
    page.on('dialog',dialog=>dialog.accept());await page.evaluate(()=>(window as unknown as{releaseCheckpoint:()=>void}).releaseCheckpoint());
    await expect(page.locator('#review-checkpoint-status')).toContainText('Newer');await expect(field).toHaveValue('Keep');
  });
});

test('malformed UTF-8 refuses before replacing checked review words',async({page})=>withClip(page,async()=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();const field=page.getByLabel('Reviewed lyric line 1',{exact:true});await field.fill('TESTZ');await page.getByLabel('Checked automatic line 1',{exact:true}).check();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review checkpoint',exact:true}).click();const raw=Buffer.from(await readFile((await(await pending).path())!));raw[raw.indexOf('TESTZ')+4]=255;
  await field.fill('Keep my correction');page.on('dialog',dialog=>dialog.accept());await page.getByLabel('Restore review checkpoint',{exact:true}).setInputFiles({name:'broken.review.json',mimeType:'application/json',buffer:raw});
  await expect(page.locator('#review-checkpoint-status')).toContainText('UTF-8');await expect(field).toHaveValue('Keep my correction');await expect(page.getByLabel('Checked automatic line 1',{exact:true})).not.toBeChecked();
}));

test('a different passage identity with identical displayed words refuses the old checkpoint',async({page})=>withClip(page,async id=>{
  await page.getByText('Retry a passage',{exact:true}).click();await page.getByLabel('Passage retry start (seconds)',{exact:true}).fill('3');await page.getByLabel('Passage retry end (seconds)',{exact:true}).fill('8');await page.getByRole('button',{name:'Recognize this passage',exact:true}).click();await expect(page.locator('#recognition-passage-preview')).toBeVisible({timeout:15000});
  const projected=await(await page.request.get(`/api/projects/${id}/recognition-passage`)).json();await page.getByRole('button',{name:'Review passage retry',exact:true}).click();await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('OLD passage');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download review checkpoint',exact:true}).click();const raw=await readFile((await(await pending).path())!,'utf8');
  await page.route(`**/api/projects/${id}/recognition-passage`,route=>route.fulfill({json:{...projected,candidateId:'b'.repeat(64),start:2,end:9}}));
  await page.reload();await page.locator('#projects').selectOption(id);await page.getByRole('button',{name:'Review passage retry',exact:true}).click();await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('New passage draft');
  page.on('dialog',dialog=>dialog.accept());await page.getByLabel('Restore review checkpoint',{exact:true}).setInputFiles({name:'old-passage.review.json',mimeType:'application/json',buffer:Buffer.from(raw)});
  await expect(page.locator('#review-checkpoint-status')).toContainText('matching');await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('New passage draft');
}));
