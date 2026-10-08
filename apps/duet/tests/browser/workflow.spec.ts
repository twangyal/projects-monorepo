import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Generated here: original PCM tones, no downloaded or copyrighted recordings.
function wav(frequency = 440, seconds = 24) {
  const rate = 16000, samples = rate * seconds, bytes = samples * 2, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  for (let sample = 0; sample < samples; sample++) buffer.writeInt16LE(Math.round(4000 * Math.sin(2 * Math.PI * frequency * sample / rate)), 44 + sample * 2);
  return buffer;
}
async function create(page: Page, title: string) {
  await page.goto('/'); await page.locator('#host-name').fill('Alex'); await page.locator('#room-title').fill(title);
  await page.getByRole('button', { name: 'Create our room' }).click();
  await expect(page.locator('#room-heading')).toHaveText(title);
  const invite = await page.locator('#share-link').inputValue();
  await page.locator('#close-link').click(); return invite;
}
async function join(page: Page, invite: string) {
  await page.goto(invite); await expect.poll(() => new URL(page.url()).hash).toBe('');
  await page.locator('#guest-name').fill('Sam'); await page.getByRole('button', { name: 'Join the room' }).click();
  await expect(page.locator('#room-view')).toBeVisible();
}
async function upload(page: Page, title: string, buffer = wav()) {
  await expect(page.locator('#audio-file')).toBeEnabled();
  await page.locator('#audio-file').setInputFiles({ name: `${title}.wav`, mimeType: 'audio/wav', buffer });
  await page.locator('#track-artist').fill('Original test tone'); await page.locator('#upload').click();
  await expect(page.locator('#library-list h4').filter({ hasText: title })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('#upload-job')).toBeHidden();
}
function track(page: Page, title: string) { return page.locator('.track').filter({ has: page.getByRole('heading', { name: title, exact: true }) }); }
async function media(page: Page) { return page.locator('#audio').evaluate((element: HTMLAudioElement) => ({ paused: element.paused, position: element.currentTime, source: element.currentSrc })); }
async function deleteSaved(page: Page) {
  if (!page.url().startsWith('http')) return;
  await page.evaluate(async () => {
    const saved = JSON.parse(localStorage.getItem('duet-participants-v1') || '{}');
    for (const [id, item] of Object.entries(saved) as [string, { token: string }][]) await fetch(`/api/rooms/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${item.token}`, 'Content-Type': 'application/json' }, body: '{}' });
    localStorage.clear();
  });
}
test.afterEach(async ({ page }) => { await deleteSaved(page); });

test('two independent seats share real audio, ratings, a mix, playback, memories and recovery', async ({ page, browser, baseURL }) => {
  test.setTimeout(90000);
  const failures: string[] = [], external: string[] = [];
  page.on('pageerror', error => failures.push(error.message)); page.on('request', request => { if (!request.url().startsWith(baseURL!) && !request.url().startsWith('blob:')) external.push(request.url()); });
  const invite = await create(page, 'The long way home');
  const context = await browser.newContext({ baseURL }), guest = await context.newPage();
  try {
    await join(guest, invite); await expect(page.locator('#participants')).toContainText('Sam');
    await upload(page, 'Sunny side'); await upload(guest, 'Moonlit', wav(330));
    await expect(track(page, 'Moonlit')).toBeVisible();
    await track(page, 'Sunny side').getByRole('button', { name: 'Like Sunny side', exact: true }).click();
    await track(guest, 'Sunny side').getByRole('button', { name: 'Like Sunny side', exact: true }).click();
    await guest.locator('#memory-text').fill('The windows down.');
    await track(page, 'Moonlit').getByRole('button', { name: 'Pass Moonlit', exact: true }).click();
    await track(guest, 'Moonlit').getByRole('button', { name: 'Like Moonlit', exact: true }).click();
    await expect(guest.locator('#memory-text')).toHaveValue('The windows down.');
    await expect(track(page, 'Sunny side').locator('.rating-summary')).toHaveText('Alex: likes it · Sam: likes it');
    await expect(track(page, 'Moonlit').locator('.rating-summary')).toHaveText('Alex: passes · Sam: likes it');
    await page.locator('#build-mix').click();
    await expect(page.locator('#playlist .song-link')).toHaveText(['Sunny side', 'Moonlit']);
    await expect(guest.locator('#playlist .song-link')).toHaveText(['Sunny side', 'Moonlit']);
    await expect(page.getByRole('button', { name: 'Up Sunny side', exact: true })).toBeDisabled();
    await guest.locator('#enable-audio').click(); await track(page, 'Sunny side').getByRole('button', { name: 'Listen', exact: true }).click();
    await expect.poll(async () => !(await media(page)).paused && !(await media(guest)).paused).toBe(true);
    await expect.poll(async () => Math.min((await media(page)).position, (await media(guest)).position)).toBeGreaterThan(.5);
    await expect.poll(async () => Math.abs((await media(page)).position - (await media(guest)).position)).toBeLessThan(.5);
    await page.locator('#seek').evaluate((element: HTMLInputElement) => { element.value = '5'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); });
    await expect.poll(async () => (await media(guest)).position).toBeGreaterThan(4.8);
    await expect.poll(async () => Math.abs((await media(page)).position - (await media(guest)).position)).toBeLessThan(.5);
    await guest.locator('#play').click(); await expect.poll(async () => (await media(page)).paused && (await media(guest)).paused).toBe(true);
    await page.locator('#next').click(); await expect(guest.locator('#playing-title')).toHaveText('Moonlit');
    await expect.poll(async () => (await media(guest)).source === (await media(page)).source && !(await media(guest)).paused).toBe(true);
    await guest.locator('#play').click();
    await guest.locator('#memory-track').selectOption({ label: 'Sunny side' }); await guest.locator('#memory-date').fill('2026-09-20'); await guest.locator('#add-memory').click();
    await expect(page.locator('#memory-list')).toContainText('The windows down.'); await expect(guest.locator('#memory-text')).toHaveValue('');
    await page.reload(); await expect(page.locator('#room-heading')).toHaveText('The long way home');
    await expect(track(page, 'Sunny side').getByRole('button', { name: 'Like Sunny side', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#playlist .song-link')).toHaveText(['Sunny side', 'Moonlit']); await expect(page.locator('#memory-list')).toContainText('The windows down.');
    await expect(page.locator('#enable-audio')).toHaveText('Enable audio on this device'); expect((await media(page)).paused).toBe(true);
    const downloaded = page.waitForEvent('download'); await page.locator('#room-export').click(); const download = await downloaded;
    const exported = await readFile((await download.path())!, 'utf8'), notes = JSON.parse(exported);
    expect(notes.schemaVersion).toBe(2); expect(notes.savedMixes).toEqual([]); expect(notes.savedMixesRevision).toBe(0); expect(exported).toContain('The windows down.');
    const credentials = await page.evaluate(() => localStorage.getItem('duet-participants-v1')!);
    for (const item of Object.values(JSON.parse(credentials)) as { token: string }[]) expect(exported.includes(item.token)).toBe(false);
    expect(exported).not.toMatch(/token|hash|invite/i); expect(failures).toEqual([]); expect(external).toEqual([]);
    await page.screenshot({ path: '/tmp/duet-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: '/tmp/duet-mobile.png', fullPage: true });
  } finally { await context.close(); }
});

test('private access restores one seat and an invitation cannot take a third seat', async ({ page, browser, baseURL }) => {
  const invite = await create(page, 'Two seats only'), context = await browser.newContext({ baseURL }), guest = await context.newPage();
  try {
    await join(guest, invite);
    await page.locator('#access-link').click(); const recovery = await page.locator('#share-link').inputValue(); await page.locator('#close-link').click();
    const strangerContext = await browser.newContext({ baseURL }), stranger = await strangerContext.newPage();
    try {
      await stranger.goto(invite); await stranger.locator('#guest-name').fill('Third person'); await stranger.getByRole('button', { name: 'Join the room' }).click();
      await expect(stranger.locator('#notice')).toBeVisible(); await expect(stranger.locator('#room-view')).toBeHidden();
      const roomId = new URL(page.url()).searchParams.get('room');
      expect((await stranger.request.get(`/api/rooms/${roomId}`)).status()).toBe(401);
      await stranger.goto(recovery); await expect(stranger.locator('#room-view')).toBeHidden(); await stranger.locator('#restore-access').click();
      await expect(stranger.locator('#participants .host')).toContainText('YOU');
      await expect(stranger.locator('#participants .guest')).not.toContainText('YOU');
      expect((await stranger.request.put(`/api/rooms/${roomId}/playback`, { data: { trackId: null, playing: false, position: 0, revision: 0 } })).status()).toBe(401);
    } finally { await strangerContext.close(); }
  } finally { await context.close(); }
});

test('failed audio can be retried and deleting audio retains its dated memory', async ({ page }) => {
  await create(page, 'Small moments');
  await page.locator('#audio-file').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not an audio recording') }); await page.locator('#upload').click();
  await expect(page.locator('#upload-job')).toBeHidden({ timeout: 10000 }); await expect(page.locator('#notice')).toHaveClass(/error/);
  await expect(page.locator('#library-list .track')).toHaveCount(0); await upload(page, 'Kept in memory');
  await page.locator('#memory-track').selectOption({ label: 'Kept in memory' }); await page.locator('#memory-text').fill('<script>this is a literal story</script>'); await page.locator('#add-memory').click();
  await expect(page.locator('#memory-list')).toContainText('<script>this is a literal story</script>'); expect(await page.locator('#memory-list script').count()).toBe(0);
  page.once('dialog', dialog => dialog.accept()); await track(page, 'Kept in memory').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('#library-list .track')).toHaveCount(0); await expect(page.locator('#memory-list')).toContainText('Audio removed; this memory is kept.');
  await page.reload(); await expect(page.locator('#memory-list')).toContainText('Kept in memory');
});

test('reconnecting preserves an unsaved memory and leaving asks before discarding it', async ({ page }) => {
  await create(page, 'Coming back'); await upload(page, 'Stay awhile');
  await page.locator('#memory-text').fill('Still writing this moment');
  const roomId = new URL(page.url()).searchParams.get('room'), path = `**/api/rooms/${roomId}`;
  await page.route(path, route => route.request().method() === 'GET' ? route.abort('failed') : route.continue());
  await expect(page.locator('#connection')).toHaveText('Connection paused · retrying'); await expect(page.locator('#memory-text')).toHaveValue('Still writing this moment');
  await page.unroute(path); await expect(page.locator('#connection')).toHaveText('Connected to your shared room');
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#leave-room').click(); await expect(page.locator('#room-view')).toBeVisible();
  page.once('dialog', dialog => dialog.accept()); await page.locator('#leave-room').click(); await expect(page.locator('#welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Coming back', exact: true }).click(); await expect(page.locator('#memory-text')).toHaveValue('');
});
