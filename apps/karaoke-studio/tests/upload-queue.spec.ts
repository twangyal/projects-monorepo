import { test, expect } from '@playwright/test';

function tone(seconds = 4): Buffer {
  const frames = seconds * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < 2; c++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * i / 44100) * 3000), 44 + i * 4 + c * 2);
  return wav;
}
const before = new Set<string>();
test.beforeEach(async ({ request }) => { for (const p of (await (await request.get('/api/projects')).json()).projects) before.add(p.id); });
test.afterEach(async ({ request }) => {
  const s = await (await request.get('/api/session')).json();
  for (const p of (await (await request.get('/api/projects')).json()).projects) if (!before.has(p.id)) await request.delete(`/api/projects/${p.id}`, { headers: { 'X-Karaoke-Token': s.token }, data: {} });
});

const ready = (name: string, more = '') => new RegExp(`“${name}” (is ready in Saved clips|is in Saved clips, but its automatic lyrics failed[^.]*)\\.${more}`);
const songs = (...names: string[]) => names.map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: tone() }));

test('several songs chosen together are prepared one after another without replacing the open clip', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles(songs('first-song', 'second-song', 'third-song'));
  await expect(page.locator('#upload-queue')).toContainText('2 songs are waiting: second-song.wav, third-song.wav.');
  // The first song opens as usual; the others follow by themselves into Saved clips.
  await expect(page.getByLabel('Clip title')).toHaveValue('first-song', { timeout: 15000 });
  await expect(page.locator('#message')).toHaveText(ready('second-song', ' 1 more waiting'), { timeout: 20000 });
  await expect(page.locator('#message')).toHaveText(ready('third-song'), { timeout: 20000 });
  await expect(page.locator('#upload-queue')).toBeHidden();
  await expect(page.getByLabel('Clip title')).toHaveValue('first-song');
  for (const name of ['first-song', 'second-song', 'third-song']) await expect(page.locator('#projects option', { hasText: name })).toHaveCount(1);
});

test('waiting songs can be cleared before they start', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles(songs('kept-song', 'dropped-one', 'dropped-two'));
  await page.getByRole('button', { name: 'Clear waiting songs' }).click();
  await expect(page.locator('#message')).toContainText('2 waiting songs were removed.');
  await expect(page.getByLabel('Clip title')).toHaveValue('kept-song', { timeout: 15000 });
  await page.waitForTimeout(4500);
  await expect(page.locator('#projects option', { hasText: 'dropped' })).toHaveCount(0);
});

test('a song chosen while another is being prepared waits its turn instead of being dropped', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles(songs('busy-first'));
  await expect(page.locator('#cancel-job')).toBeVisible();
  // Choosing stays available while the studio works, and the new song joins the waiting list.
  await expect(page.getByLabel('Upload song clip')).toBeEnabled();
  await page.getByLabel('Upload song clip').setInputFiles(songs('busy-later'));
  await expect(page.locator('#message')).toHaveText('“busy-later.wav” is waiting until the studio is free. It lands in Saved clips.');
  await expect(page.locator('#upload-queue')).toContainText('1 song is waiting: busy-later.wav.');
  await expect(page.getByLabel('Clip title')).toHaveValue('busy-first', { timeout: 15000 });
  await expect(page.locator('#message')).toHaveText(ready('busy-later'), { timeout: 20000 });
  await expect(page.getByLabel('Clip title')).toHaveValue('busy-first');
});
