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
async function retryPassage(page: Page) {
  await page.getByText('Retry a passage', { exact: true }).click();
  await page.getByLabel('Passage retry start (seconds)', { exact: true }).fill('3');
  await page.getByLabel('Passage retry end (seconds)', { exact: true }).fill('8');
  await page.getByLabel('Recognition for this retry', { exact: true }).selectOption('multilingual');
  await page.getByRole('button', { name: 'Recognize this passage', exact: true }).click();
  await expect(page.locator('#recognition-passage-preview')).toBeVisible({ timeout: 15000 });
}
for (const width of [1280, 390]) test(`passage retry auditions in song time and applies one correction at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await withClip(page, async id => {
    const base = `/api/projects/${id}`, reference = await (await page.request.get(base + '/transcript')).json();
    await page.getByLabel('Lyric line 1', { exact: true }).fill('My corrected opening');
    await page.getByLabel('Paste lyrics, one line per cue', { exact: true }).fill('Unapplied paste');
    await retryPassage(page);
    expect(await readLines(page)).toEqual(['My corrected opening', 'This is our chorus', 'Sing it back to me']);
    expect(await (await page.request.get(base + '/transcript')).json()).toEqual(reference);
    await expect(page.locator('#recognition-passage-status')).toContainText('3–8 s');
    await page.getByRole('button', { name: 'Review passage retry', exact: true }).click();
    await expect(page.locator('#srt-summary')).toContainText('Passage retry');
    await expect(page.locator('#srt-apply')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Recognize this passage', exact: true })).toBeDisabled();
    await page.getByLabel('Reviewed lyric line 1', { exact: true }).fill('Our corrected chorus');
    await page.getByRole('button', { name: 'Listen to automatic line 1', exact: true }).click();
    await expect(page.locator('#current-line')).toHaveText('Our corrected chorus');
    expect(await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeGreaterThan(3);
    await page.locator('#automatic-listen-stop').click();
    if (width === 390) {
      await page.getByText('Apply a reviewed passage', { exact: true }).click();
      await page.locator('#automatic-passage-apply').click();
    } else await page.getByRole('button', { name: 'Apply only reviewed line 1', exact: true }).click();
    expect(await readLines(page)).toEqual(['My corrected opening', 'Our corrected chorus', 'Sing it back to me']);
    await expect(page.getByRole('button', { name: 'Discard passage retry', exact: true })).toBeDisabled();
    await page.locator('#srt-cancel').click();
    await expect(page.getByLabel('Paste lyrics, one line per cue', { exact: true })).toHaveValue('Unapplied paste');
    await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
    expect(await readLines(page)).toEqual(['My corrected opening', 'This is our chorus', 'Sing it back to me']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});
test('passage preview survives reopening, stays separate from the full retry and discards explicitly', async ({ page }) => {
  await withClip(page, async id => {
    const base = `/api/projects/${id}`, reference = await (await page.request.get(base + '/transcript')).json();
    await page.getByRole('button', { name: 'Transcribe again', exact: true }).click();
    await expect(page.locator('#recognition-preview')).toBeVisible();
    const full = await (await page.request.get(base + '/recognition-preview')).json();
    await retryPassage(page);
    await page.reload(); await page.locator('#projects').selectOption(id);
    await expect(page.locator('#recognition-passage-preview')).toBeVisible();
    await expect(page.locator('#recognition-passage-preview')).toContainText('excluded from saved-clip backups');
    expect(await (await page.request.get(base + '/recognition-preview')).json()).toEqual(full);
    await page.getByRole('button', { name: 'Discard passage retry', exact: true }).click();
    await expect(page.locator('#recognition-passage-preview')).toBeHidden();
    expect(await (await page.request.get(base + '/transcript')).json()).toEqual(reference);
  });
});
