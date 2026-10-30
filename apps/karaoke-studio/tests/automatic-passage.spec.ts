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

for (const width of [1280,390]) test(`reviewed passage keeps outside corrections with one Undo and save at ${width}px`, async ({page}) => withClip(page, async id => {
  await page.setViewportSize({width,height:900});
  await page.getByLabel('Lyric line 1',{exact:true}).fill('My corrected intro');
  await page.getByLabel('Start line 1',{exact:true}).fill('0.5000');
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('');
  await page.getByLabel('Reviewed lyric line 2',{exact:true}).fill('New chorus');
  await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('New ending');
  await page.getByLabel('Checked automatic line 3',{exact:true}).check();
  await page.getByText('Apply a reviewed passage',{exact:true}).click();
  await page.getByRole('combobox',{name:'First automatic line in passage',exact:true}).selectOption('1');
  await page.getByRole('combobox',{name:'Last automatic line in passage',exact:true}).selectOption('2');
  const apply=page.getByRole('button',{name:'Apply reviewed passage',exact:true});
  await expect(page.locator('#automatic-passage-status')).toContainText('2 current lines');
  await expect(apply).toBeEnabled(); await apply.click();
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('My corrected intro');
  await expect(page.getByLabel('Start line 1',{exact:true})).toHaveValue('0.5000');
  await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('New chorus');
  await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('New ending');
  await expect(page.getByLabel('Checked automatic line 3',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Reviewed start line 1 (seconds)',{exact:true})).toHaveValue('');
  await expect(apply).toBeDisabled();
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();
  await expect(page.locator('#srt-review')).toBeHidden();
  await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('This is our chorus');
  await expect(page.getByLabel('Lyric line 3',{exact:true})).not.toHaveValue('New ending');
  await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload(); await page.locator('#projects').selectOption(id);
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('My corrected intro');
  await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('New chorus');
  await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('New ending');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));
test('regrouped passage refuses partial boundary cuts, preserves outside current draft and stale apply cannot edit',async ({page}) => withClip(page,async()=>{
  const before=await page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value));
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByText('Apply a reviewed passage',{exact:true}).click();
  await page.getByRole('combobox',{name:'First automatic line in passage',exact:true}).selectOption('0');
  await page.getByRole('combobox',{name:'Last automatic line in passage',exact:true}).selectOption('1');
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('1.5');
  const apply=page.getByRole('button',{name:'Apply reviewed passage',exact:true});
  await expect(apply).toBeDisabled();
  await expect(page.locator('#automatic-passage-status')).toContainText('cuts through current line 1');
  expect(await page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))).toEqual(before);
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('0.5');
  await page.getByLabel('Reviewed end line 1 (seconds)',{exact:true}).fill('5.95');
  await page.getByLabel('Exclude automatic line 2',{exact:true}).check();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Regrouped whole chorus');
  await expect(apply).toBeEnabled(); await apply.click();
  await expect(page.locator('#cue-list textarea')).toHaveCount(2);
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('Regrouped whole chorus');
  const stale=await apply.elementHandle();
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();
  await stale!.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(await page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value))).toEqual(before);
  await page.getByLabel('Start line 3',{exact:true}).fill('');
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('New start');
  await expect(apply).toBeDisabled();
  await expect(page.locator('#automatic-passage-status')).toContainText('Check current lyrics');
  await expect(page.getByLabel('Start line 3',{exact:true})).toHaveValue('');
}));
