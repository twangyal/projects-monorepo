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

test('automatic review listens to captured recognized timing while invalid raw corrections remain untouched', async ({ page }) => withClip(page, async id => {
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByLabel('Start line 3', { exact: true }).fill('');
  await page.getByLabel('Clip title', { exact: true }).fill('');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied words 🎵');
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Listen to automatic line 3', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  const at = await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime);
  expect(at).toBeGreaterThanOrEqual(8.8); expect(at).toBeLessThan(10);
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused), { timeout: 6000 }).toBe(true);
  expect(await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeCloseTo(11.75, 1);
  expect(await editor(page)).toEqual(before);
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
}));

test('uncertain filter preserves numbering and complete apply, undo and pasted corrections', async ({ page }) => withClip(page, async () => {
  await page.getByLabel('Lyric line 2', { exact: true }).fill('My own chorus');
  await page.getByLabel('Paste lyrics, one line per cue').fill('A paste kept in memory');
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.getByLabel('Show only uncertain automatic lines', { exact: true })).toBeVisible();
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await expect(page.locator('#srt-review-list li:visible')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Listen to automatic line 3', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen to automatic line 1', exact: true })).toBeHidden();
  await expect(page.locator('#automatic-review-count')).toHaveText('Showing 1 of 3 automatic lines. Applying replaces all 3 lines.');
  expect(await editor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  expect(await page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(n => (n as HTMLTextAreaElement).value))).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  expect(await editor(page)).toEqual(before);
}));

test('review repeat supports pause and stop, and cancellation or edited content retires playback', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat automatic line 1', exact: true }).click();
  await expect(page.locator('#automatic-listen-status')).toContainText('Repeating');
  await page.getByRole('button', { name: 'Pause reviewed passage', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Resume reviewed passage', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Cancel lyric import', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.locator('#srt-review')).toBeHidden();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat automatic line 1', exact: true }).click();
  await page.getByLabel('Lyric line 1', { exact: true }).fill('A new correction');
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.locator('#srt-review')).toBeHidden();
}));

test('track changes retire audition and a held native play result cannot revive a cancelled review', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat automatic line 1', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Vocals', exact: true }).click();
  await expect(page.locator('audio')).toHaveAttribute('src', /audio\/vocals$/);
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await page.locator('audio').evaluate(audio => {
    const element = audio as HTMLAudioElement, native = element.play.bind(element);
    element.play = () => {
      const result = native();
      return new Promise<void>((resolve, reject) => {
        result.then(() => { (window as Window & { releaseAutomaticPlay?: () => void }).releaseAutomaticPlay = resolve; }, reject);
      });
    };
  });
  await page.getByRole('button', { name: 'Repeat automatic line 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseAutomaticPlay?: () => void }).releaseAutomaticPlay)).toBe('function');
  await page.getByRole('button', { name: 'Cancel lyric import', exact: true }).click();
  await page.evaluate(() => (window as Window & { releaseAutomaticPlay?: () => void }).releaseAutomaticPlay!());
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.locator('#srt-review')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}));


test('recognized words can be corrected during audition, filtered and applied as one undoable edit', async ({ page }) => withClip(page, async id => {
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByLabel('Lyric line 2', { exact: true }).fill('My existing correction');
  await page.getByLabel('Start line 2', { exact: true }).fill('');
  await page.getByLabel('Clip title', { exact: true }).fill('My corrected title');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Keep my pasted draft');
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const corrected = page.getByLabel('Reviewed lyric line 3', { exact: true });
  await expect(corrected).toBeVisible();
  await page.getByRole('button', { name: 'Repeat automatic line 3', exact: true }).click();
  await corrected.fill('Sing it back 🎵\nCorrected chorus');
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await expect(corrected).toHaveValue('Sing it back 🎵\nCorrected chorus');
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(corrected).toHaveValue('Sing it back 🎵\nCorrected chorus');
  expect(await editor(page)).toEqual(before);
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toHaveValue('Sing it back 🎵\nCorrected chorus');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Hello little world');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  expect(await editor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toHaveValue('Sing it back 🎵\nCorrected chorus');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
}));

test('invalid hidden reviewed text blocks complete apply while captured audition stays available', async ({ page }) => withClip(page, async () => {
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const line = page.getByLabel('Reviewed lyric line 1', { exact: true });
  await expect(line).toBeVisible();
  await line.fill('');
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeDisabled();
  await expect(page.locator('#automatic-review-error')).toContainText('Line 1');
  await page.getByRole('button', { name: 'Listen to automatic line 3', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).uncheck();
  await line.fill('🎵'.repeat(241));
  await expect(page.locator('#automatic-review-error')).toContainText('240 characters');
  await line.fill('🎵'.repeat(240));
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeEnabled();
  await expect(page.locator('#automatic-review-error')).toHaveText('');
  expect(await editor(page)).toEqual(before);
}));

test('cancel discards only reviewed corrections and a fresh review restores recognized words', async ({ page }) => withClip(page, async id => {
  await page.setViewportSize({ width: 390, height: 740 });
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const line = page.getByLabel('Reviewed lyric line 3', { exact: true });
  await expect(line).toBeVisible();
  await line.fill('Do not apply these words');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Cancel lyric import', exact: true }).click();
  expect(await editor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(line).toHaveValue('Sing it back to me');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
}));


test('saving applied review corrections persists them without rewriting recognition', async ({ page }) => withClip(page, async id => {
  const transcript = await (await page.request.get(`/api/projects/${id}/transcript`)).json();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const line = page.getByLabel('Reviewed lyric line 3', { exact: true });
  await expect(line).toBeVisible();
  await line.fill('The words I actually sang');
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('Lyrics and timing saved locally.');
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(saved.cues[2]).toEqual({ start: 8.85, end: 11.75, text: 'The words I actually sang' });
  expect(await (await page.request.get(`/api/projects/${id}/transcript`)).json()).toEqual(transcript);
  await page.reload();
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toHaveValue('The words I actually sang');
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.getByLabel('Reviewed lyric line 3', { exact: true })).toHaveValue('Sing it back to me');
}));
