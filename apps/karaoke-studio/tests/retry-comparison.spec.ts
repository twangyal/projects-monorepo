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


const readLines = (page: Page) => page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value));
async function candidate(page: Page, id: string, regroup = false) {
  await page.route(`**/api/projects/${id}/recognition-preview`, async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch(), value = await response.json();
    if (value.available) {
      const recognized = (start: number, end: number, text: string, confidence = .9) => ({ start, end, text, confidence, words: [{start,end,text,confidence}] });
      const [first, second, third] = value.current.cues;
      value.current.cues.push(recognized(13,14,'Reference only <img src=x onerror=alert(1)>'));
      value.candidate.cues = regroup
        ? [recognized(first.start,(first.start+first.end)/2,'Hello'),recognized((first.start+first.end)/2,first.end,'little world'),second,recognized(7,8,'Added phrase')]
        : [recognized(first.start,first.end,'hello little WORLD!'),recognized(second.start,second.end,'Different chorus',.4),recognized(third.start+.2,third.end,'Sing it back to me')];
      value.candidate.words = value.candidate.cues.length;
    }
    await route.fulfill({ response, json: value });
  });
  await page.getByLabel('Recognition for this retry', { exact: true }).selectOption('multilingual');
  await page.getByRole('button', { name: 'Transcribe again', exact: true }).click();
  await expect(page.locator('#recognition-preview')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Review retry candidate', exact: true }).click();
}
for (const width of [1280,390]) test(`retry differences preserve hidden drafts and selected edits at ${width}px`, async ({page}) => withClip(page, async id => {
  await page.setViewportSize({width,height:900});
  const base = `/api/projects/${id}`, before = await (await page.request.get(base + '/transcript')).json();
  await page.getByLabel('Lyric line 1', {exact:true}).fill('Outside correction');
  await page.getByLabel('Paste lyrics, one line per cue', {exact:true}).fill('Pasted draft stays');
  await candidate(page,id);
  const rows = page.locator('#srt-review-list > li'), differences = page.getByLabel('Show only original retry differences', {exact:true});
  await expect(page.locator('#automatic-retry-summary')).toContainText('2 of 3 retry lines');
  await expect(page.locator('#automatic-retry-summary')).toContainText('1 reference intervals');
  await expect(rows.nth(0).getByLabel('Reference comparison for retry line 1')).toContainText('Same normalized wording; same timing');
  await expect(rows.nth(1).getByLabel('Reference comparison for retry line 2')).toContainText('This is our chorus');
  await expect(rows.nth(2)).toContainText('timing differs');
  await page.getByText('Reference intervals without retry overlap', {exact:true}).click();
  await expect(page.locator('#automatic-retry-missing-list')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#automatic-retry-missing-list img')).toHaveCount(0);
  await page.getByLabel('Reviewed lyric line 1', {exact:true}).fill('Hidden review draft');
  await differences.check(); await expect(rows.nth(0)).toBeHidden(); await expect(rows.nth(1)).toBeVisible();
  await page.getByLabel('Show only uncertain automatic lines', {exact:true}).check(); await expect(rows.nth(2)).toBeHidden();
  await page.getByLabel('Checked automatic line 2', {exact:true}).check(); await page.getByLabel('Hide checked automatic lines', {exact:true}).check();
  await expect(page.locator('#automatic-review-count')).toContainText('Showing 0 of 3');
  await expect(page.locator('#srt-apply')).toBeEnabled();
  await page.getByLabel('Hide checked automatic lines', {exact:true}).uncheck();
  await page.getByLabel('Reviewed lyric line 2', {exact:true}).fill('Reviewed retry correction');
  await page.getByRole('button', {name:'Listen to automatic line 2',exact:true}).click();
  await expect(page.locator('#current-line')).toHaveText('Reviewed retry correction');
  await differences.uncheck(); await expect(page.locator('#automatic-listen-status')).toContainText('Choose Listen');
  await page.getByRole('button', {name:'Apply only reviewed line 2',exact:true}).click();
  expect(await readLines(page)).toEqual(['Outside correction','Reviewed retry correction','Sing it back to me']);
  await page.getByLabel('Show only uncertain automatic lines', {exact:true}).uncheck();
  await expect(page.getByLabel('Reviewed lyric line 1', {exact:true})).toHaveValue('Hidden review draft');
  await expect(page.getByLabel('Paste lyrics, one line per cue', {exact:true})).toHaveValue('Pasted draft stays');
  expect(await (await page.request.get(base + '/transcript')).json()).toEqual(before);
  await expect(page.getByRole('button', {name:'Keep retry as automatic reference',exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#srt-cancel').click(); await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();
  expect(await readLines(page)).toEqual(['Outside correction','This is our chorus','Sing it back to me']);
}));
test('Apply all still includes original identical lines hidden by the differences filter', async ({page}) => withClip(page, async id => {
  await candidate(page,id);
  await page.getByLabel('Reviewed lyric line 1',{exact:true}).fill('Hidden correction to include');
  await page.getByLabel('Show only original retry differences',{exact:true}).check();
  await expect(page.getByLabel('Reviewed lyric line 1',{exact:true})).toBeHidden();
  await page.locator('#srt-apply').click();
  expect(await readLines(page)).toEqual(['Hidden correction to include','Different chorus','Sing it back to me']);
  await page.getByRole('button',{name:'Undo lyric edit',exact:true}).click();
  expect(await readLines(page)).toEqual(['Hello little world','This is our chorus','Sing it back to me']);
  await page.getByRole('button',{name:'Review automatic lyrics',exact:true}).click();
  await expect(page.locator('#automatic-retry-comparison')).toBeHidden();
}));
test('regrouped and nonoverlapping retry lines stay visible without claiming word alignment', async ({page}) => withClip(page, async id => {
  await candidate(page,id,true);
  const rows = page.locator('#srt-review-list > li');
  await expect(rows.nth(0)).toContainText('Line grouping differs'); await expect(rows.nth(1)).toContainText('Line grouping differs');
  await expect(rows.nth(3)).toContainText('No reference interval overlaps');
  await page.getByLabel('Show only original retry differences',{exact:true}).check();
  await expect(rows.nth(0)).toBeVisible(); await expect(rows.nth(1)).toBeVisible(); await expect(rows.nth(2)).toBeHidden(); await expect(rows.nth(3)).toBeVisible();
  await page.getByText('Reference intervals without retry overlap',{exact:true}).click();
  await expect(page.locator('#automatic-retry-missing-list')).toContainText('Sing it back to me');
}));
for (const width of [1280,390]) test(`reference wording can be copied and undone without applying or overwriting later edits at ${width}px`, async ({page}) => withClip(page, async id => {
  await page.setViewportSize({width,height:900}); await candidate(page,id);
  const before = await readLines(page), words = page.getByLabel('Reviewed lyric line 2',{exact:true});
  const start = await page.getByLabel('Reviewed start line 2 (seconds)',{exact:true}).inputValue();
  await words.fill('My existing review draft');
  await expect(page.getByRole('button',{name:'Use reference wording in reviewed line 2',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use reference wording in reviewed line 2',exact:true}).click();
  await expect(words).toHaveValue('This is our chorus');
  expect(await readLines(page)).toEqual(before);
  await expect(page.getByLabel('Reviewed start line 2 (seconds)',{exact:true})).toHaveValue(start);
  await page.getByRole('button',{name:'Undo reference wording in line 2',exact:true}).focus();
  await page.getByRole('button',{name:'Undo reference wording in line 2',exact:true}).press('Enter');
  await expect(page.getByRole('button',{name:'Use reference wording in reviewed line 2',exact:true})).toBeFocused();
  await expect(words).toHaveValue('My existing review draft');
  await expect(page.getByRole('button',{name:'Use reference wording in reviewed line 2',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Use reference wording in reviewed line 2',exact:true}).click();
  await words.fill('Later manual correction');
  await page.getByRole('button',{name:'Undo reference wording in line 2',exact:true}).click();
  await expect(words).toHaveValue('Later manual correction');
  await expect(page.locator('#message')).toContainText('kept');
  await page.getByRole('button',{name:'Apply only reviewed line 2',exact:true}).click();
  expect(await readLines(page)).toEqual(['Hello little world','Later manual correction','Sing it back to me']);
}));
