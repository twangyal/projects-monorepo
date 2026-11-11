import { test, expect, type Page } from '@playwright/test';

function tone(): Buffer {
  const frames = 17 * 44100, wav = Buffer.alloc(44 + frames * 4);
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
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'repeated-chorus.wav', mimeType: 'audio/wav', buffer: tone() });
    const response = await accepted;
    expect(response.status()).toBe(202);
    ownedId = (await response.json()).job.projectId;
    expect(typeof ownedId).toBe('string');
    await expect(page.locator('#message')).toContainText('4 automatically timed lyric lines', { timeout: 15000 });
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

test('a corrected chorus line offers its wording to the repeats heard like it, with undo', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const line = (n: number) => page.getByLabel(`Reviewed lyric line ${n}`, { exact: true });
  await expect(line(1)).toHaveValue('This is our horus');
  const offer = page.getByRole('group', { name: 'Repeats of line 1' });
  await expect(offer).toBeHidden();
  await line(1).fill('This is our chorus');
  await line(1).press('Tab');
  await expect(offer).toContainText('Heard similarly in lines 3 and 4.');
  await offer.getByRole('button', { name: 'Use this wording in lines 3 and 4' }).click();
  await expect(line(3)).toHaveValue('This is our chorus');
  await expect(line(4)).toHaveValue('This is our chorus');
  await expect(line(2)).toHaveValue('Sing it back to me');
  await expect(offer.getByRole('status')).toHaveText('Lines 3 and 4 now read “This is our chorus”.');
  // Undo puts back what was heard, except where the person has typed since.
  await line(4).fill('This is our chorus tonight');
  await offer.getByRole('button', { name: 'Undo wording in lines 3 and 4' }).click();
  await expect(line(3)).toHaveValue('This is a chorus');
  await expect(line(4)).toHaveValue('This is our chorus tonight');
  // Applying the reviewed lines keeps the corrected wording.
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('This is our chorus');
  await expect(page.getByLabel('Lyric line 4', { exact: true })).toHaveValue('This is our chorus tonight');
}));

test('a line typed over after the offer keeps its own words', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const line = (n: number) => page.getByLabel(`Reviewed lyric line ${n}`, { exact: true });
  await line(3).fill('This is our chorus');
  await line(3).press('Tab');
  const offer = page.getByRole('group', { name: 'Repeats of line 3' });
  await expect(offer).toContainText('Heard similarly in lines 1 and 4.');
  await line(1).fill('This is my own line');
  await offer.getByRole('button', { name: 'Use this wording in lines 1 and 4' }).click();
  await expect(line(1)).toHaveValue('This is my own line');
  await expect(line(4)).toHaveValue('This is our chorus');
  await expect(offer.getByRole('status')).toHaveText('Line 4 now reads “This is our chorus”.');
}));


for (const width of [1280,390]) test(`main-editor chorus wording is one undoable saved correction at ${width}px`, async ({page}) => withClip(page, async id => {
  await page.setViewportSize({width,height:900});
  const line=(n:number)=>page.getByLabel(`Lyric line ${n}`,{exact:true});
  const before=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  await page.getByLabel('End line 4',{exact:true}).fill(Number(before[3].end).toFixed(3));
  await page.getByLabel('Paste lyrics, one line per cue',{exact:true}).fill('Unapplied private draft');
  await line(1).fill('This is our chorus'); await line(1).press('Tab');
  const offer=page.getByRole('group',{name:'Current repeats of line 1',exact:true});
  await expect(offer).toContainText('Heard similarly in lines 3 and 4');
  await offer.getByRole('button',{name:'Use corrected wording in lines 3 and 4',exact:true}).click();
  await expect(line(3)).toHaveValue('This is our chorus'); await expect(line(4)).toHaveValue('This is our chorus');
  await expect(line(2)).toHaveValue('Sing it back to me');
  await expect(page.getByLabel('End line 4',{exact:true})).toHaveValue(Number(before[3].end).toFixed(3));
  await expect(page.getByLabel('Paste lyrics, one line per cue',{exact:true})).toHaveValue('Unapplied private draft');
  await page.locator('#undo-lyrics').click();
  await expect(line(1)).toHaveValue('This is our chorus'); await expect(line(3)).toHaveValue(before[2].text); await expect(line(4)).toHaveValue(before[3].text);
  await page.locator('#redo-lyrics').click(); await expect(line(3)).toHaveValue('This is our chorus'); await expect(line(4)).toHaveValue('This is our chorus');
  expect((await (await page.request.get(`/api/projects/${id}`)).json()).cues).toEqual(before);
  await page.getByRole('button',{name:'Discard pasted draft',exact:true}).click();
  await page.getByRole('button',{name:'Save lyrics',exact:true}).click(); await expect(page.locator('#message')).toContainText('saved locally');
  const saved=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  expect(saved.map((c:{start:number,end:number})=>[c.start,c.end])).toEqual(before.map((c:{start:number,end:number})=>[c.start,c.end]));
  await page.reload(); await expect(line(3)).toHaveValue('This is our chorus'); await expect(line(4)).toHaveValue('This is our chorus');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}));

test('main-editor repeat offers recheck changed target words and timings before applying', async ({page}) => withClip(page, async id => {
  const line=(n:number)=>page.getByLabel(`Lyric line ${n}`,{exact:true});
  const before=(await (await page.request.get(`/api/projects/${id}`)).json()).cues;
  await line(1).fill('This is our chorus'); await line(1).press('Tab');
  const offer=page.getByRole('group',{name:'Current repeats of line 1',exact:true});
  await expect(offer).toContainText('lines 3 and 4');
  await line(3).fill('My own corrected chorus');
  await page.getByLabel('Start line 4',{exact:true}).fill(String(before[3].start+.25));
  await offer.getByRole('button',{name:'Use corrected wording in lines 3 and 4',exact:true}).click();
  await expect(offer.getByRole('status')).toContainText('Those lines changed since');
  await expect(line(3)).toHaveValue('My own corrected chorus'); await expect(line(4)).toHaveValue(before[3].text);
  await expect(page.getByLabel('Start line 4',{exact:true})).toHaveValue(String(before[3].start+.25));
  // A fresh offer can still correct the remaining untouched repeat without overwriting line 3.
  await page.getByLabel('Start line 4',{exact:true}).fill(String(before[3].start));
  await line(1).fill('This is our chorus tonight'); await line(1).press('Tab');
  await offer.getByRole('button',{name:'Use corrected wording in line 4',exact:true}).click();
  await expect(line(3)).toHaveValue('My own corrected chorus'); await expect(line(4)).toHaveValue('This is our chorus tonight');
}));
