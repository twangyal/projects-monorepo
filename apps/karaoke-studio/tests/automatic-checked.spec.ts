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


const checked = (page: Page, n: number) => page.getByLabel(`Checked automatic line ${n}`, {exact:true});
const applyChecked = (page: Page) => page.getByRole('button',{name:'Apply checked lines',exact:true});
for(const width of [1280,390]) test(`checked nonadjacent corrections preserve drafts, parts, filters and one-step history at ${width}px`,async({page})=>withClip(page,async id=>{
  await page.setViewportSize({width,height:900});
  await page.getByLabel('Lyric line 2',{exact:true}).fill('Keep my corrected middle');
  await page.getByLabel('Start line 2',{exact:true}).fill('4.0000');
  await page.getByRole('combobox',{name:'Singer line 1',exact:true}).selectOption('1');
  await page.getByRole('combobox',{name:'Singer line 3',exact:true}).selectOption('both');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Keep my pasted draft');
  const before=await editor(page), saved=await(await page.request.get(`/api/projects/${id}`)).json();
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await expect(applyChecked(page)).toBeDisabled();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('A corrected intro');
  await page.getByLabel('Reviewed lyric line 3',{exact:true}).fill('A corrected ending');
  await page.getByLabel('Reviewed end line 3 (seconds)',{exact:true}).fill('11.75');
  // Unchecked unfinished rows must not block the checked edits.
  await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('');
  await checked(page,1).check();await checked(page,3).check();
  await page.getByLabel('Hide checked automatic lines',{exact:true}).check();
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toBeHidden();
  await expect(page.locator('#automatic-checked-status')).toContainText('Checked included lines: 1, 3');
  await expect(page.locator('#automatic-checked-status')).toContainText('Replace 2 current line(s) and add 0');
  await expect(applyChecked(page)).toBeEnabled();await applyChecked(page).click();
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('A corrected intro');
  await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A corrected ending');
  await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Keep my corrected middle');
  await expect(page.getByLabel('Start line 2',{exact:true})).toHaveValue('4.0000');
  await expect(page.getByRole('combobox',{name:'Singer line 1',exact:true})).toHaveValue('1');
  await expect(page.getByRole('combobox',{name:'Singer line 3',exact:true})).toHaveValue('both');
  await expect(page.getByLabel('Reviewed start line 2 (seconds)',{exact:true})).toHaveValue('');
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue('Keep my pasted draft');
  await expect(applyChecked(page)).toBeDisabled();
  expect(await(await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
  const stale=await applyChecked(page).elementHandle();
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();expect(await editor(page)).toEqual(before);
  await expect(page.locator('#srt-review')).toBeHidden();
  await stale!.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(await editor(page)).toEqual(before);
  await page.getByRole('button',{name:'Redo lyric edit',exact:true}).click();
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('A corrected intro');await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A corrected ending');
  await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click();await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload();await page.locator('#projects').selectOption(id);
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('A corrected intro');await expect(page.getByLabel('Lyric line 3',{exact:true})).toHaveValue('A corrected ending');
  await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('Keep my corrected middle');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));
test('checked exclusions stay unapplied and editing a checked row clears its membership',async({page})=>withClip(page,async()=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Included correction');await checked(page,1).check();
  await page.getByRole('checkbox',{name:'Exclude automatic line 2',exact:true}).check();await checked(page,2).check();
  await expect(page.locator('#automatic-checked-status')).toContainText('Checked included lines: 1.');
  await applyChecked(page).click();await expect(page.getByLabel('Lyric line 2',{exact:true})).toHaveValue('This is our chorus');
  await expect(checked(page,2)).toBeChecked();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Edit again');await expect(checked(page,1)).not.toBeChecked();await expect(applyChecked(page)).toBeDisabled();
  await checked(page,1).check();await expect(applyChecked(page)).toBeEnabled();await applyChecked(page).click();
  await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('Edit again');
}));
test('two checked lines cannot replace the same current line and a refusal commits nothing',async({page})=>withClip(page,async()=>{
  const before=await editor(page);
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed start line 1 (seconds)',{exact:true}).fill('1');await page.getByLabel('Reviewed end line 1 (seconds)',{exact:true}).fill('1.5');
  await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).fill('1.5');await page.getByLabel('Reviewed end line 2 (seconds)',{exact:true}).fill('2');
  await checked(page,1).check();await checked(page,2).check();
  await expect(applyChecked(page)).toBeDisabled();await expect(page.locator('#automatic-checked-status')).toContainText('same current line 1');
  // Guarded even if an external event bypasses disabled presentation.
  await applyChecked(page).evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(await editor(page)).toEqual(before);
}));


test('a detached checked Apply from a cancelled review cannot apply a replacement review',async({page})=>withClip(page,async()=>{
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  const stale=await applyChecked(page).elementHandle();
  await page.getByRole('button',{name:'Cancel lyric import',exact:true}).click();
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Replacement review correction');await checked(page,1).check();
  await expect(applyChecked(page)).toBeEnabled();
  const before=await editor(page);
  await stale!.evaluate(node=>node.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(await editor(page)).toEqual(before);
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toHaveValue('Replacement review correction');
  await applyChecked(page).click();await expect(page.getByLabel('Lyric line 1',{exact:true})).toHaveValue('Replacement review correction');
}));
