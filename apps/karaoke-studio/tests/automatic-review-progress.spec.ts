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



for (const width of [1280, 390]) test(`checked automatic lines form a reversible review queue at ${width}px`, async ({ page }) => withClip(page, async id => {
  await page.setViewportSize({ width, height: 900 });
  const before = await (await page.request.get(`/api/projects/${id}`)).json();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  const rows = page.locator('#srt-review-list li'), hide = page.getByLabel('Hide checked automatic lines', { exact: true });
  const checked = (n: number) => page.getByLabel(`Checked automatic line ${n}`, { exact: true });
  await expect(hide).toBeVisible(); await hide.check(); await checked(1).check();
  await expect(rows.nth(0)).toBeHidden(); await expect(page.getByLabel('Reviewed lyric line 2', { exact: true })).toBeFocused();
  await expect(page.locator('#automatic-review-count')).toContainText('1 of 3 checked');
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(before);
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeDisabled();
  await hide.uncheck(); await checked(1).uncheck(); await expect(checked(1)).not.toBeChecked();
  await checked(1).check(); await page.getByLabel('Reviewed lyric line 1', { exact: true }).fill('A correction to review again'); await expect(checked(1)).not.toBeChecked();
  await checked(1).check(); await page.getByLabel('Reviewed start line 1 (seconds)', { exact: true }).fill(''); await expect(checked(1)).not.toBeChecked(); await expect(checked(1)).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Exclude automatic line 1', exact: true }).check(); await expect(checked(1)).toBeEnabled(); await checked(1).check();
  await page.getByRole('checkbox', { name: 'Exclude automatic line 1', exact: true }).uncheck(); await expect(checked(1)).not.toBeChecked(); await expect(checked(1)).toBeDisabled();
  await page.getByLabel('Reviewed start line 1 (seconds)', { exact: true }).fill('1');
  await checked(1).check(); await checked(2).check(); await checked(3).check();
  await hide.check(); await expect(rows.filter({ visible: true })).toHaveCount(0);
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).check(); await expect(rows.filter({ visible: true })).toHaveCount(0);
  await hide.uncheck(); const uncertain = await rows.filter({ visible: true }).count(); expect(uncertain).toBeGreaterThan(0); expect(uncertain).toBeLessThan(3);
  await page.getByLabel('Show only uncertain automatic lines', { exact: true }).uncheck();
  await hide.check(); await hide.uncheck(); await checked(1).uncheck(); await hide.check(); await checked(1).check();
  await expect(hide).toBeFocused(); await expect(page.locator('#automatic-review-count')).toContainText('3 of 3 checked');
  await page.getByRole('button', { name: 'Cancel lyric import', exact: true }).click();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click(); await expect(checked(1)).not.toBeChecked(); await expect(hide).not.toBeChecked();
  await expect(page.locator('#automatic-review-count')).toContainText('0 of 3 checked');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}));

test('checked progress is locked during Save and remains with the live review afterwards', async ({ page }) => withClip(page, async id => {
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByLabel('Reviewed lyric line 1', { exact: true }).fill('Applied correction');
  await page.getByRole('button', { name: 'Apply only reviewed line 1', exact: true }).click();
  const checked = page.getByLabel('Checked automatic line 2', { exact: true }); await checked.check();
  let release!: () => void, arrive!: () => void;
  const pending = new Promise<void>(r => { release = r; }), arrived = new Promise<void>(r => { arrive = r; });
  await page.route(`**/api/projects/${id}`, async route => { if (route.request().method() !== 'PUT') return route.continue(); arrive(); await pending; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Save lyrics', exact: true }).click(); await arrived;
    await expect(checked).toBeDisabled(); await expect(page.getByLabel('Hide checked automatic lines', { exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.locator('#message')).toContainText('saved locally'); await expect(checked).toBeEnabled(); await expect(checked).toBeChecked();
  await page.getByLabel('Reviewed lyric line 3', { exact: true }).fill('Next correction'); await page.getByRole('button', { name: 'Apply only reviewed line 3', exact: true }).click();
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click(); await expect(page.locator('#srt-review')).toBeHidden();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click(); await expect(checked).not.toBeChecked();
}));
