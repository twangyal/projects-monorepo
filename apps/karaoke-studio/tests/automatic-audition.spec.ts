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


test('saving applied reviewed words and times persists them without rewriting recognition', async ({ page }) => withClip(page, async id => {
  const transcript = await (await page.request.get(`/api/projects/${id}/transcript`)).json();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const line = page.getByLabel('Reviewed lyric line 3', { exact: true });
  await expect(line).toBeVisible();
  await line.fill('The words I actually sang');
  await page.getByLabel('Reviewed start line 3 (seconds)', { exact: true }).fill('12.125');
  await page.getByLabel('Reviewed end line 3 (seconds)', { exact: true }).fill('13.875');
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('Lyrics and timing saved locally.');
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(saved.cues[2]).toEqual({ start: 12.125, end: 13.875, text: 'The words I actually sang' });
  expect(await (await page.request.get(`/api/projects/${id}/transcript`)).json()).toEqual(transcript);
  await page.reload();
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toHaveValue('The words I actually sang');
  await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('12.125');
  await expect(page.getByLabel('End line 3', { exact: true })).toHaveValue('13.875');
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.getByLabel('Reviewed lyric line 3', { exact: true })).toHaveValue('Sing it back to me');
}));

test('reviewed timing auditions the staged interval and applies words and times in one recoverable edit', async ({ page }) => withClip(page, async id => {
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByLabel('Start line 2', { exact: true }).fill('');
  await page.getByLabel('Clip title', { exact: true }).fill('My title');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Keep this paste');
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const start = page.getByLabel('Reviewed start line 3 (seconds)', { exact: true });
  await expect(start).toBeVisible();
  await start.fill('12.125');
  await page.getByLabel('Reviewed end line 3 (seconds)', { exact: true }).fill('13.875');
  await page.getByLabel('Reviewed lyric line 3', { exact: true }).fill('Corrected final words');
  await page.getByRole('button', { name: 'Listen to automatic line 3', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  expect(await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeGreaterThanOrEqual(12.125);
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused), { timeout: 5000 }).toBe(true);
  expect(await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeCloseTo(13.875, 1);
  expect(await editor(page)).toEqual(before);
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('12.125');
  await expect(page.getByLabel('End line 3', { exact: true })).toHaveValue('13.875');
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toHaveValue('Corrected final words');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await editor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Start line 3', { exact: true })).toHaveValue('12.125');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
}));

test('invalid hidden reviewed timing blocks complete apply without blocking another line audition', async ({ page }) => withClip(page, async () => {
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const start = page.getByLabel('Reviewed start line 1 (seconds)', { exact: true });
  await start.fill('');
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await expect(start).toBeHidden();
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeDisabled();
  await expect(page.locator('#automatic-review-error')).toContainText('Line 1');
  await page.getByRole('button', { name: 'Listen to automatic line 3', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).uncheck();
  await expect(start).toHaveValue('');
  await start.fill('0.85000');
  const end = page.getByLabel('Reviewed end line 1 (seconds)', { exact: true });
  await end.fill('4.01'); // Next recognized line starts at 3.85.
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeDisabled();
  await expect(page.locator('#automatic-review-error')).toContainText('Line 2');
  await end.fill('2.75');
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(start).toHaveValue('0.85000');
  expect(await editor(page)).toEqual(before);
}));

test('keyboard playhead marks stage exact boundaries on phone and cancel restores recognition', async ({ page }) => withClip(page, async id => {
  await page.setViewportSize({ width: 390, height: 844 });
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  for (const [boundary, at] of [['start', 12.125], ['end', 13.875]] as const) {
    await page.locator('audio').evaluate((a, at) => { const audio = a as HTMLAudioElement; audio.pause(); audio.currentTime = at; }, at);
    await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).seeking)).toBe(false);
    const actual = await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime);
    expect(actual).toBeCloseTo(at, 5);
    const button = page.getByRole('button', { name: `Mark reviewed ${boundary} line 3 at playhead`, exact: true });
    await button.focus(); await button.press('Enter');
    await expect(page.getByLabel(`Reviewed ${boundary} line 3 (seconds)`, { exact: true })).toHaveValue(String(actual));
  }
  await expect(page.locator('#srt-review-list li').nth(2).locator('strong')).toContainText('00:00:08,850 --> 00:00:11,750');
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.getByLabel('Reviewed start line 3 (seconds)', { exact: true })).toHaveValue('12.125');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/karaoke271-review-phone.png', fullPage: true });
  await page.getByRole('button', { name: 'Cancel lyric import', exact: true }).click();
  expect(await editor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.getByLabel('Reviewed start line 3 (seconds)', { exact: true })).toHaveValue('8.85');
  await expect(page.getByLabel('Reviewed end line 3 (seconds)', { exact: true })).toHaveValue('11.75');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(saved);
}));

test('timing edits retire held native audition and a late play result cannot restart it', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.locator('audio').evaluate(audio => {
    const element = audio as HTMLAudioElement, native = element.play.bind(element);
    element.play = () => new Promise<void>((resolve, reject) => {
      native().then(() => { (window as Window & { releaseTimingPlay?: () => void }).releaseTimingPlay = resolve; }, reject);
    });
  });
  await page.getByRole('button', { name: 'Repeat automatic line 3', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as Window & { releaseTimingPlay?: () => void }).releaseTimingPlay)).toBe('function');
  await page.getByLabel('Reviewed start line 3 (seconds)', { exact: true }).fill('9.125');
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await page.evaluate(() => (window as Window & { releaseTimingPlay?: () => void }).releaseTimingPlay!());
  await expect(page.getByRole('button', { name: 'Pause reviewed passage', exact: true })).toBeDisabled();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.getByLabel('Reviewed start line 3 (seconds)', { exact: true })).toHaveValue('9.125');
  await expect(page.locator('#srt-review')).toBeVisible();
}));

test('repeat wraps actual native playback to the staged start instead of recognized timing', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByLabel('Reviewed start line 3 (seconds)', { exact: true }).fill('12.125');
  await page.getByLabel('Reviewed end line 3 (seconds)', { exact: true }).fill('13.875');
  await page.locator('audio').evaluate(a => {
    const audio = a as HTMLAudioElement;
    const state: { seeks: number[] } = { seeks: [] };
    (window as Window & { stagedRepeat?: typeof state }).stagedRepeat = state;
    audio.addEventListener('seeking', () => state.seeks.push(audio.currentTime));
  });
  await page.getByRole('button', { name: 'Repeat automatic line 3', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { stagedRepeat?: { seeks: number[] } }).stagedRepeat!.seeks.length), { timeout: 7000 }).toBeGreaterThanOrEqual(2);
  const seeks = await page.evaluate(() => (window as Window & { stagedRepeat?: { seeks: number[] } }).stagedRepeat!.seeks);
  expect(seeks[0]).toBeCloseTo(12.125, 5); expect(seeks[1]).toBeCloseTo(12.125, 5);
  await page.getByRole('button', { name: 'Stop reviewed passage', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
}));

test('exclude false automatic lines before one exact saved review edit', async ({ page }) => withClip(page, async id => {
  const source = await (await page.request.get(`/api/projects/${id}/transcript`)).json();
  await page.getByLabel('End line 1', { exact: true }).fill('2.7500');
  await page.getByLabel('Clip title', { exact: true }).fill('Reviewed clip');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Unapplied paste 🎵'); const before = await editor(page);
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByLabel('Reviewed lyric line 1', { exact: true }).fill('Kept café 🎵');
  await page.getByLabel('Reviewed lyric line 2', { exact: true }).fill('');
  await page.getByLabel('Reviewed start line 2 (seconds)', { exact: true }).fill('');
  await page.getByLabel('Exclude automatic line 2', { exact: true }).check();
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await expect(page.locator('#automatic-review-count')).toContainText('2 included lines; 1 excluded');
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  expect(await page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(n => (n as HTMLTextAreaElement).value))).toEqual(['Kept café 🎵', 'Sing it back to me']);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); expect(await editor(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard pasted draft', exact: true }).click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click(); await expect(page.locator('#message')).toContainText('saved locally');
  expect(await (await page.request.get(`/api/projects/${id}/transcript`)).json()).toEqual(source);
  await page.reload(); await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Kept café 🎵');
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('Sing it back to me');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click()]);
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await download.path())!, 'utf8')).toBe('1\n00:00:00,850 --> 00:00:02,750\nKept café 🎵\n\n2\n00:00:08,850 --> 00:00:11,750\nSing it back to me\n');
}));

test('excluded review lines restore raw errors and hidden included lines still validate', async ({ page }) => withClip(page, async id => {
  const source = await (await page.request.get(`/api/projects/${id}/transcript`)).json();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByLabel('Reviewed lyric line 3', { exact: true }).fill('');
  await page.getByLabel('Exclude automatic line 3', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeEnabled();
  await page.getByLabel('Exclude automatic line 3', { exact: true }).uncheck();
  await expect(page.locator('#automatic-review-error')).toContainText('Line 3');
  await expect(page.getByLabel('Reviewed lyric line 3', { exact: true })).toHaveValue('');
  await page.getByLabel('Exclude automatic line 3', { exact: true }).check();
  await page.getByLabel('Reviewed start line 2 (seconds)', { exact: true }).fill('');
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await expect(page.getByLabel('Reviewed start line 2 (seconds)', { exact: true })).toBeHidden();
  await expect(page.locator('#automatic-review-error')).toContainText('Line 2');
  await expect(page.getByRole('button', { name: 'Replace lyric cues', exact: true })).toBeDisabled();
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).uncheck();
  await page.getByLabel('Exclude automatic line 2', { exact: true }).check();
  await page.getByLabel('Exclude automatic line 1', { exact: true }).check();
  await expect(page.locator('#automatic-review-count')).toContainText('0 included lines; 3 excluded');
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.locator('#cue-list textarea')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.locator('#cue-list textarea')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo lyric edit', exact: true }).click();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload(); await expect(page.locator('#cue-list textarea')).toHaveCount(0);
  expect(await (await page.request.get(`/api/projects/${id}/transcript`)).json()).toEqual(source);
}));

test('phone keyboard exclusion keeps drafts and retired checkbox cannot change a fresh review', async ({ page }) => withClip(page, async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByLabel('Reviewed end line 2 (seconds)', { exact: true }).fill('7.5000');
  const exclude = page.getByLabel('Exclude automatic line 2', { exact: true });
  const retired = await exclude.elementHandle();
  await exclude.focus(); await page.keyboard.press('Space'); await expect(exclude).toBeChecked();
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check();
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).uncheck();
  await expect(page.getByLabel('Reviewed end line 2 (seconds)', { exact: true })).toHaveValue('7.5000');
  await expect(exclude).toBeChecked();
  await page.getByRole('button', { name: 'Cancel lyric import', exact: true }).click();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.getByLabel('Exclude automatic line 2', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Reviewed end line 2 (seconds)', { exact: true })).not.toHaveValue('7.5000');
  await retired!.evaluate(node => { (node as HTMLInputElement).checked = true; node.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('#automatic-review-count')).toHaveText('Showing 3 of 3 automatic lines. Applying replaces all 3 lines.');
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.locator('#cue-list textarea')).toHaveCount(3);
}));

test('changing automatic line exclusion retires playback and excluded audio remains inspectable', async ({ page }) => withClip(page, async () => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat automatic line 1', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByLabel('Exclude automatic line 1', { exact: true }).check();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await page.getByRole('button', { name: 'Repeat automatic line 1', exact: true }).click();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.getByLabel('Exclude automatic line 1', { exact: true }).uncheck();
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await expect(page.locator('#cue-list textarea')).toHaveCount(3);
}));
