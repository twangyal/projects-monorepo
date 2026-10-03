import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function tone(duration = 3): Buffer {
  const frames = Math.floor(duration * 44100), wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
async function importClip(page: Page, name = 'practice.wav') {
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({ name, mimeType: 'audio/wav', buffer: tone() });
  await expect(page.locator('#message')).toContainText('Your stems are ready', { timeout: 15000 });
  await expect(page.getByLabel('Clip title')).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
}
test('complete clip-to-lyrics-to-real-MP4 workflow, persisted project and saved timing downloads', async ({ page }) => {
  await importClip(page);
  await page.getByLabel('Clip title').fill('Kitchen concert');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Hello, little world\nThis is our chorus');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#message')).toContainText('evenly spaced');
  await page.getByLabel('Start line 1', { exact: true }).fill('0.25');
  await page.getByLabel('End line 1', { exact: true }).fill('1.25');
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = .5; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '0');
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = 1.35; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '-1');
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload();
  await expect(page.getByLabel('Clip title')).toHaveValue('Kitchen concert');
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.25');
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = .5; });
  for (const name of ['Original', 'Vocals', 'Backing']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', new RegExp(`/audio/${name.toLowerCase()}$`));
    await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeCloseTo(.5, 2);
  }
  const [lyrics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click()]);
  expect(await readFile((await lyrics.path())!, 'utf8')).toContain('00:00:00,250 --> 00:00:01,250');
  const [video] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click()]);
  const bytes = await readFile((await video.path())!);
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(bytes.length).toBeGreaterThan(1000);
});
test('delete confirms the selected clip and frees its saved slot', async ({ page }) => {
  await importClip(page, 'delete-me.wav');
  const id = new URL(page.url()).searchParams.get('project')!;
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
  await expect(page.getByLabel('Clip title')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
  await expect(page.locator('#message')).toContainText('selected clip was deleted');
  await expect(page.getByLabel('Clip title')).toBeHidden();
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(404);
  const remaining = await (await page.request.get('/api/projects')).json();
  expect(remaining.projects.some((project: { id: string }) => project.id === id)).toBe(false);
});
test('invalid timing and stale saves preserve editable user drafts', async ({ page }) => {
  await importClip(page, 'validation.wav');
  await page.getByLabel('Paste lyrics, one line per cue').fill('First line\nSecond line');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await page.getByLabel('End line 1', { exact: true }).fill('5');
  await expect(page.locator('#cue-validation')).toContainText('within the clip');
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeDisabled();
  await page.getByLabel('End line 1', { exact: true }).fill('1.5');
  await page.route('**/api/projects/*', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Project revision changed. Reload before saving.' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('revision');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First line');
  await expect(page.locator('#save-state')).toContainText('Unsaved');
});
test('failed audio imports keep the current completed project and allow retry', async ({ page }) => {
  await importClip(page, 'kept.wav');
  const title = await page.getByLabel('Clip title').inputValue();
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid wave bytes') });
  await expect(page.locator('#job-panel')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#message')).toHaveClass(/error/);
  await expect(page.getByLabel('Clip title')).toHaveValue(title);
  await expect(page.getByLabel('Upload song clip')).toBeEnabled();
});
test('narrow layout is usable without external requests or page errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4188/')) external.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Karaoke Studio', exact: true })).toBeVisible();
  await expect(page.getByLabel('Upload song clip')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
