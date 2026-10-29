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

async function editor(page: Page) {
  return page.locator('body').evaluate(() => ({
    title: (document.querySelector('#title') as HTMLInputElement).value,
    paste: (document.querySelector('#lyric-draft') as HTMLTextAreaElement).value,
    fields: [...document.querySelectorAll('#cue-list input,#cue-list textarea')].map(n => (n as HTMLInputElement).value),
    first: (document.querySelector('#practice-first') as HTMLSelectElement).value,
    last: (document.querySelector('#practice-last') as HTMLSelectElement).value,
  }));
}

for(const width of [1280,390])test(`one reviewed line keeps other corrections and review drafts through history and save at ${width}px`,async({page},info)=>withClip(page,async id=>{
 await page.setViewportSize({width,height:900});
 await page.getByLabel('Clip title',{exact:true}).fill('My song 🎵');
 await page.getByLabel('Lyric line 2',{exact:true}).fill('My corrected chorus');await page.getByLabel('Start line 2',{exact:true}).fill('4.0000');
 await page.getByLabel('Paste lyrics, one line per cue').fill('Keep my unapplied words');
 const before=await editor(page),saved=await(await page.request.get(`/api/projects/${id}`)).json();
 await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
 await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('');
 await page.getByLabel('Reviewed lyric line 2',{exact:true}).fill('Staged better chorus');
 await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('A better last line');
 await page.getByLabel('Reviewed start line 3 (seconds)',{exact:true}).fill('8.75');await page.getByLabel('Reviewed end line 3 (seconds)',{exact:true}).fill('11.95');
 const only=page.getByRole('button',{name:'Apply only reviewed line 3',exact:true});await expect(only).toBeEnabled();
 await only.click();
 await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A better last line');await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('My corrected chorus');await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('4.0000');
 await expect(page.getByLabel('Reviewed start line 1 (seconds)',{exact:true})).toHaveValue('');await expect(page.getByLabel('Reviewed lyric line 2',{exact:true})).toHaveValue('Staged better chorus');
 await expect(only).toBeDisabled();
 if(width===390)await page.locator('#srt-review-list li').nth(2).screenshot({path:'/tmp/karaoke-single-line/phone-review.png'});
 // The preserved review owner remains live for another explicitly chosen application.
 await page.getByRole('button',{name:'Apply only reviewed line 2',exact:true}).click();await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Staged better chorus');
 expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.locator('#srt-review')).toBeHidden();await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('My corrected chorus');await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A better last line');
 await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await editor(page)).toEqual(before);
 await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A better last line');await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('My corrected chorus');
 await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
 await page.reload();await page.locator('#projects').selectOption(id);await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A better last line');await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('My corrected chorus');
 await page.screenshot({path:info.outputPath(`single-line-${width}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));
test('one-line application inserts in gaps, refuses multiple overlaps and invalid current timings, and stale buttons cannot edit',async({page})=>withClip(page,async()=>{
 await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
 const apply=page.getByRole('button',{name:'Apply only reviewed line 2',exact:true});
 await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('2');await page.getByLabel('Reviewed end line 2 (seconds)',{exact:true}).fill('5');
 await expect(apply).toBeDisabled();await expect(page.locator('#automatic-apply-status-1')).toContainText('more than one current line');
 await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('6.25');await page.getByLabel('Reviewed end line 2 (seconds)',{exact:true}).fill('7.25');await page.getByLabel('Reviewed lyric line 2',{exact:true}).fill('Missed line');
 await expect(page.locator('#automatic-apply-status-1')).toContainText('Add as current line 3');await apply.click();await expect(page.locator('#cue-list textarea')).toHaveCount(4);await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('Missed line');
 const stale=await apply.elementHandle();await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();await expect(page.locator('#cue-list textarea')).toHaveCount(3);const before=await editor(page);await stale!.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(await editor(page)).toEqual(before);
 await page.getByLabel('Start line 1',{exact:true}).fill('');await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('New text');
 await expect(page.getByRole('button',{name:'Apply only reviewed line 3',exact:true})).toBeDisabled();await expect(page.locator('#automatic-apply-status-2')).toContainText('Check current lyrics');await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('');
}));
