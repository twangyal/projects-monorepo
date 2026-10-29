import { test, expect, type Page } from '@playwright/test';

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


async function stage(page: Page) {
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('First corrected and applied');
  await page.getByLabel('Reviewed lyric line 2',{exact:true}).fill('Second correction still waiting');
  await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('4.1230');
  await page.getByLabel('Reviewed end line 2 (seconds)',{exact:true}).fill('5.8750');
  await page.getByLabel('Reviewed start line 3 (seconds)',{exact:true}).fill('');
  await page.getByRole('checkbox',{name:'Exclude automatic line 3',exact:true}).check();
  await page.getByRole('button',{name:'Apply only reviewed line 1',exact:true}).click();
}
async function review(page: Page) {
  return page.locator('#srt-review-list').evaluate(list=>[...list.querySelectorAll('input,textarea')].map(node=>{const n=node as HTMLInputElement;return {value:n.value,checked:n.type==='checkbox'?n.checked:null};}));
}
for(const width of [1280,390])test(`Save keeps staged automatic corrections and establishes an applied-only Undo checkpoint at ${width}px`,async({page})=>withClip(page,async id=>{
  await page.setViewportSize({width,height:900});await stage(page);const staged=await review(page);
  let release!:()=>void,arrive!:()=>void;const pending=new Promise<void>(r=>{release=r;}),arrived=new Promise<void>(r=>{arrive=r;});
  await page.route(`**/api/projects/${id}`,async route=>{if(route.request().method()!=='PUT')return route.continue();arrive();await pending;await route.continue();});
  try{
    await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await arrived;
    await expect(page.locator('#srt-review')).toBeVisible();await expect(page.getByLabel('Reviewed lyric line 2',{exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'Apply only reviewed line 2',exact:true})).toBeDisabled();expect(await review(page)).toEqual(staged);
  }finally{release();}
  await expect(page.locator('#message')).toContainText('saved locally');await expect(page.getByLabel('Reviewed lyric line 2',{exact:true})).toBeEnabled();
  expect(await review(page)).toEqual(staged);
  const saved=await(await page.request.get(`/api/projects/${id}`)).json();
  expect(saved.cues[0].text).toBe('First corrected and applied');expect(saved.cues[1].text).not.toBe('Second correction still waiting');expect(saved.cues).toHaveLength(3);
  await expect(page.getByRole('button',{name:'Undo lyric edit',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Apply only reviewed line 2',exact:true}).click();await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Second correction still waiting');
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.locator('#srt-review')).toBeHidden();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('First corrected and applied');await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue(saved.cues[1].text);
  await expect(page.getByRole('button',{name:'Save lyrics',exact:true})).toBeDisabled();
  await page.reload();await page.locator('#projects').selectOption(id);await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('First corrected and applied');await expect(page.locator('#srt-review')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));

for(const failure of ['temporary failure','unconfirmed reply'] as const)test(`${failure} keeps automatic review drafts for correction and a deliberate Save retry`,async({page})=>withClip(page,async id=>{
  await stage(page);const staged=await review(page),before=await(await page.request.get(`/api/projects/${id}`)).json();
  await page.route(`**/api/projects/${id}`,async route=>{if(route.request().method()!=='PUT')return route.continue();await route.fulfill(failure==='temporary failure'?{status:503,json:{error:'Please try saving again.'}}:{status:200,contentType:'application/json',body:'{"id":'});},{times:1});
  await page.locator('#save').click();await expect(page.locator('#message')).toContainText(failure==='temporary failure'?'Please try saving again.':'unconfirmed');
  await expect(page.locator('#srt-review')).toBeVisible();expect(await review(page)).toEqual(staged);await expect(page.getByLabel('Reviewed lyric line 2',{exact:true})).toBeEnabled();
  expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(before);
  await page.getByRole('button',{name:'Apply only reviewed line 2',exact:true}).click();
  await page.locator('#save').click();await expect(page.locator('#message')).toContainText('saved locally');
  const saved=await(await page.request.get(`/api/projects/${id}`)).json();expect(saved.cues[0].text).toBe('First corrected and applied');expect(saved.cues[1]).toEqual({start:4.123,end:5.875,text:'Second correction still waiting'});expect(saved.cues[2]).toEqual(before.cues[2]);
  await expect(page.getByLabel('Reviewed start line 3 (seconds)',{exact:true})).toHaveValue('');await expect(page.getByRole('checkbox',{name:'Exclude automatic line 3',exact:true})).toBeChecked();
}));

test('cancelling automatic review during a delayed Save is final and detached application cannot act',async({page})=>withClip(page,async id=>{
  await stage(page);const stale=await page.getByRole('button',{name:'Apply only reviewed line 2',exact:true}).elementHandle();
  let release!:()=>void,arrive!:()=>void;const pending=new Promise<void>(r=>{release=r;}),arrived=new Promise<void>(r=>{arrive=r;});
  await page.route(`**/api/projects/${id}`,async route=>{if(route.request().method()!=='PUT')return route.continue();arrive();await pending;await route.continue();});
  try{await page.locator('#save').click();await arrived;await page.locator('#srt-cancel').click();await expect(page.locator('#srt-review')).toBeHidden();}finally{release();}
  await expect(page.locator('#message')).toContainText('saved locally');await expect(page.locator('#srt-review')).toBeHidden();
  const before=await page.getByLabel('Lyric line 2',{exact:true}).inputValue();await stale!.evaluate(n=>n.dispatchEvent(new MouseEvent('click',{bubbles:true})));await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue(before);await expect(page.locator('#save')).toBeDisabled();
}));

test('ordinary SRT review still closes when current lyric edits are saved',async({page})=>withClip(page,async()=>{
  await page.getByLabel('Lyric line 1',{exact:true}).fill('Saved current line');
  await page.getByLabel('Import timed lyrics (SRT)',{exact:true}).setInputFiles({name:'replacement.srt',mimeType:'application/x-subrip',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nNot applied\n')});
  await expect(page.locator('#srt-review')).toBeVisible();await page.locator('#save').click();await expect(page.locator('#message')).toContainText('saved locally');await expect(page.locator('#srt-review')).toBeHidden();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('Saved current line');
}));
