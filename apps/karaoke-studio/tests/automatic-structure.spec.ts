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

const reviewed=(page:Page,n:number)=>page.getByLabel(`Reviewed lyric line ${n}`,{exact:true});
const lyric=(page:Page,n:number)=>page.getByLabel(`Lyric line ${n}`,{exact:true});
for (const width of [1280,390]) test(`split a reviewed line in one applied edit while keeping staged corrections at ${width}px`,async({page})=>withClip(page,async id=>{
  await page.setViewportSize({width,height:900});
  const before=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  const recognized=await (await page.request.get(`/api/projects/${id}/transcript`)).json();
  await lyric(page,1).fill('My corrected intro');await page.getByLabel('Start line 1',{exact:true}).fill('0.5000');
  await page.getByLabel('Paste lyrics, one line per cue',{exact:true}).fill('Pending pasted words');
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('');
  await reviewed(page,3).fill('Staged ending correction');await page.getByLabel('Checked automatic line 3',{exact:true}).check();
  await reviewed(page,2).fill('New chorus words');await reviewed(page,2).evaluate(box=>{(box as HTMLTextAreaElement).setSelectionRange(4,4);});
  const time=Math.round((before[1].start+before[1].end)*500)/1000;
  await page.locator('audio').evaluate((audio,time)=>{(audio as HTMLAudioElement).currentTime=time;},time);
  await page.getByRole('button',{name:'Apply split of reviewed line 2 at caret and playhead',exact:true}).click();
  await expect(page.locator('#cue-list textarea')).toHaveCount(4);await expect(lyric(page,2)).toHaveValue('New ');await expect(lyric(page,3)).toHaveValue('chorus words');
  await expect(lyric(page,1)).toHaveValue('My corrected intro');await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0.5000');
  await expect(page.locator('#srt-review')).toBeVisible();await expect(page.getByLabel('Reviewed start line 1 (seconds)',{exact:true})).toHaveValue('');
  await expect(reviewed(page,3)).toHaveValue('Staged ending correction');await expect(page.getByLabel('Checked automatic line 3',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Paste lyrics, one line per cue',{exact:true})).toHaveValue('Pending pasted words');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).cues).toEqual(before);
  expect(await (await page.request.get(`/api/projects/${id}/transcript`)).json()).toEqual(recognized);
  await page.locator('#undo-lyrics').click();await expect(page.locator('#cue-list textarea')).toHaveCount(3);await expect(lyric(page,2)).toHaveValue(before[1].text);
  await expect(page.locator('#srt-review')).toBeHidden();await page.locator('#redo-lyrics').click();await expect(lyric(page,3)).toHaveValue('chorus words');
  await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
  const saved=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  expect(saved.slice(1,3)).toEqual([{start:before[1].start,end:time,text:'New '},{start:time,end:before[1].end,text:'chorus words'}]);
  await page.reload();await expect(lyric(page,2)).toHaveValue('New ');await expect(lyric(page,3)).toHaveValue('chorus words');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));
for (const width of [1280,390]) test(`merge adjacent reviewed lines with gap and retain review through save at ${width}px`,async({page})=>withClip(page,async id=>{
  await page.setViewportSize({width,height:900});const before=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  await lyric(page,1).fill('Outside correction');await page.getByLabel('Start line 1',{exact:true}).fill('0.5000');
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('');await reviewed(page,2).fill('New chorus');await reviewed(page,3).fill('New ending');
  await page.getByLabel('Checked automatic line 3',{exact:true}).check();
  const apply=page.getByRole('button',{name:'Apply merged reviewed lines 2 and 3',exact:true});await expect(page.locator('#automatic-merge-status-1')).toContainText('including the gap');await apply.click();
  await expect(page.locator('#cue-list textarea')).toHaveCount(2);await expect(lyric(page,2)).toHaveValue('New chorus\nNew ending');await expect(lyric(page,1)).toHaveValue('Outside correction');
  await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0.5000');await expect(page.locator('#srt-review')).toBeVisible();await expect(apply).toBeDisabled();
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
  await expect(reviewed(page,3)).toHaveValue('New ending');await expect(page.getByLabel('Reviewed start line 1 (seconds)',{exact:true})).toHaveValue('');await expect(page.getByLabel('Checked automatic line 3',{exact:true})).toBeChecked();
  const saved=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;expect(saved[1]).toEqual({start:before[1].start,end:before[2].end,text:'New chorus\nNew ending'});
  await expect(page.locator('#undo-lyrics')).toBeDisabled(); // Saving starts the existing new history baseline.
  await page.reload();await expect(lyric(page,2)).toHaveValue('New chorus\nNew ending');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));
test('refused grouping keeps playback and drafts; excluded or stale actions cannot apply',async({page})=>withClip(page,async()=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  const split=page.getByRole('button',{name:'Apply split of reviewed line 2 at caret and playhead',exact:true}),merge=page.getByRole('button',{name:'Apply merged reviewed lines 2 and 3',exact:true});
  await reviewed(page,2).fill('New chorus words');await reviewed(page,2).evaluate(box=>(box as HTMLTextAreaElement).setSelectionRange(0,0));
  await page.getByRole('button',{name:'Repeat automatic line 2',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate(a=>(a as HTMLAudioElement).paused)).toBe(false);
  await split.click();await expect(page.locator('#message')).toContainText('caret');await expect.poll(()=>page.locator('audio').evaluate(a=>(a as HTMLAudioElement).paused)).toBe(false);
  await expect(page.locator('#cue-list textarea')).toHaveCount(3);
  await page.getByLabel('Exclude automatic line 3',{exact:true}).check();await expect(merge).toBeDisabled();await expect(page.locator('#automatic-merge-status-1')).toContainText('Include reviewed line 3');
  await page.getByLabel('Exclude automatic line 2',{exact:true}).check();await expect(split).toBeDisabled();
  await page.getByLabel('Exclude automatic line 2',{exact:true}).uncheck();await page.getByLabel('Exclude automatic line 3',{exact:true}).uncheck();
  const stale=await merge.elementHandle();await merge.click();await page.locator('#undo-lyrics').click();await expect(page.locator('#cue-list textarea')).toHaveCount(3);
  await stale!.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));await expect(page.locator('#cue-list textarea')).toHaveCount(3);await expect(page.locator('#srt-review')).toBeHidden();
}));
