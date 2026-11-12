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

for(const width of [1280,390])test(`automatic audition previews staged words and handles paused edits at ${width}px`,async({page})=>withClip(page,async id=>{
  await page.setViewportSize({width,height:900});const saved=await(await page.request.get(`/api/projects/${id}`)).json();
  await page.getByLabel('Lyric line 2',{exact:true}).fill('Applied old words');await page.getByLabel('Start line 1',{exact:true}).fill('');
  const before=await page.locator('#cue-list input,#cue-list textarea').evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value));
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('');
  const text=page.getByLabel('Reviewed lyric line 2',{exact:true});await text.fill('Corrected staged words');
  await page.getByRole('button',{name:'Repeat automatic line 2',exact:true}).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-preview-source','automatic-review');await expect(page.locator('#current-line')).toHaveText('Corrected staged words');
  await expect(page.locator('#review-preview-status')).toContainText('not applied or saved');await expect(page.locator('#stage')).toHaveAttribute('data-word-timing','none');
  await expect(page.locator('#srt-review-list li').nth(1)).toHaveClass(/review-active/);
  await page.getByRole('button',{name:'Pause reviewed passage',exact:true}).click();await text.fill('Edited while paused');await expect(text).toBeFocused();await expect(page.locator('#current-line')).toHaveText('Edited while paused');
  await text.fill('');await expect(page.locator('#current-line')).toContainText('Review preview paused');await expect(page.locator('#stage')).toHaveAttribute('data-active-cue','-1');
  await text.fill('Ready to compare');await expect(page.locator('#current-line')).toHaveText('Ready to compare');
  await page.getByRole('button',{name:'Stop reviewed passage',exact:true}).click();await expect(page.locator('#stage')).toHaveAttribute('data-preview-source','current');await expect(page.locator('#review-preview-status')).toBeHidden();
  await expect(page.locator('#current-line')).toHaveText('Preview paused — correct the title or lyric draft to resume.');await expect(page.locator('#srt-review-list li.review-active')).toHaveCount(0);
  expect(await page.locator('#cue-list input,#cue-list textarea').evaluateAll(nodes=>nodes.map(n=>(n as HTMLInputElement).value))).toEqual(before);
  expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));
test('imported passage preview shows its words and gaps, then returns to applied lyrics',async({page})=>withClip(page,async id=>{
  const before=await(await page.request.get(`/api/projects/${id}`)).json();
  await page.locator('#srt-file').setInputFiles({name:'review.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,500 --> 00:00:01,200\nImported first words\n\n2\n00:00:02,200 --> 00:00:03,200\nImported next words\n')});
  await expect(page.locator('#srt-review')).toBeVisible();await page.getByText('Apply a reviewed passage',{exact:true}).click();
  await page.getByRole('combobox',{name:'Last imported line in passage',exact:true}).selectOption('1');await page.getByRole('button',{name:'Repeat reviewed passage',exact:true}).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-preview-source','imported-review');await expect(page.locator('#current-line')).toHaveText('Imported first words');
  await expect(page.locator('#current-line')).toHaveText('Instrumental break');await expect(page.locator('#srt-review-list li.review-active')).toHaveCount(0);
  await expect(page.locator('#current-line')).toHaveText('Imported next words');await expect(page.locator('#srt-review-list li').nth(1)).toHaveClass(/review-active/);
  await page.getByRole('button',{name:'Stop reviewed audio',exact:true}).click();await expect(page.locator('#stage')).toHaveAttribute('data-preview-source','current');
  expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(before);
}));
test('published review preview follows proposed timings without applying catalogue lyrics',async({page})=>withClip(page,async id=>{
  const before=await(await page.request.get(`/api/projects/${id}`)).json();
  await page.route('https://lrclib.net/api/get?**',route=>route.fulfill({json:{id:42,trackName:'Test song',artistName:'Example singer',albumName:'Demo',duration:16,instrumental:false,plainLyrics:'Published proposed words',syncedLyrics:'[00:03.00]Published proposed words\n[00:06.00]'},headers:{'access-control-allow-origin':'*'}}));
  await page.locator('#lyrics-lookup').evaluate(n=>(n as HTMLDetailsElement).open=true);await page.getByLabel('Song title for lookup',{exact:true}).fill('Test song');await page.getByLabel('Artist for lookup',{exact:true}).fill('Example singer');
  await page.getByRole('button',{name:'Look up lyrics',exact:true}).click();await page.getByRole('button',{name:'Review published timings',exact:true}).click();
  await page.getByRole('button',{name:'Listen to published line 1',exact:true}).click();await expect(page.locator('#stage')).toHaveAttribute('data-preview-source','published-review');
  await expect(page.locator('#current-line')).toHaveText('Published proposed words');await expect(page.locator('#srt-review-list li').nth(0)).toHaveClass(/review-active/);
  await page.getByRole('button',{name:'Cancel published timing review',exact:true}).click();await expect(page.locator('#stage')).toHaveAttribute('data-preview-source','current');await expect(page.locator('#review-preview-status')).toBeHidden();
  expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(before);
}));
