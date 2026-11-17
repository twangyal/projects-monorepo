import { test, expect, type Page } from '@playwright/test';

// The browser fixture server recognizes words only in 16-second clips (tests/browser_server.py).
function tone(duration: number): Buffer {
  const frames = Math.floor(duration * 44100), wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
async function importClip(page: Page, duration: number) {
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'sing-along.wav', mimeType: 'audio/wav', buffer: tone(duration) });
  await expect(page.locator('#message')).toContainText('Your stems', { timeout: 15000 });
}
async function isolatedClip(page: Page, work: () => Promise<void>) {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((p: {id:string}) => p.id));
  try { await work(); } finally {
    const session = await (await page.request.get('/api/session')).json();
    for (const p of (await (await page.request.get('/api/projects')).json()).projects) if (!before.has(p.id)) {
      expect((await page.request.delete(`/api/projects/${p.id}`, {headers: {'X-Karaoke-Token': session.token}, data: {}})).ok()).toBe(true);
    }
    expect((await (await page.request.get('/api/projects')).json()).projects.map((p: {id:string}) => p.id).sort()).toEqual([...before].sort());
  }
}

async function seek(page: Page, time: number) {
  await page.locator('audio').evaluate((audio, at) => { (audio as HTMLAudioElement).currentTime = at; audio.dispatchEvent(new Event('timeupdate')); }, time);
}
test('a line in another script shows how it is said under it, lit with its words, and can be hidden', async ({ page }) => {
  await isolatedClip(page, async () => {
    await importClip(page, 16);
    // The second automatic line, corrected to Korean: unsaved corrections are timed (and read) straight away.
    await page.getByLabel('Lyric line 2', { exact: true }).fill('사랑해 너를');
    await seek(page, 4.5);
    await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '1');
    await expect(page.locator('#stage')).toHaveAttribute('data-said', 'saranghae neoreul');
    // The pronunciation is drawn in its own band under the line.
    const band = () => page.locator('#stage').evaluate(node => {
      const data = (node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 410, 1280, 40).data, corner = [data[0], data[1], data[2]];
      let drawn = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - corner[0]) + Math.abs(data[i + 1] - corner[1]) + Math.abs(data[i + 2] - corner[2]) > 60) drawn++;
      return drawn;
    });
    expect(await band()).toBeGreaterThan(100);
    // An English line needs none, and the setting hides it.
    await seek(page, 1.5);
    await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '0');
    await expect(page.locator('#stage')).toHaveAttribute('data-said', '');
    await seek(page, 4.5);
    await expect(page.locator('#stage')).toHaveAttribute('data-said', 'saranghae neoreul');
    await page.locator('#lyric-pronunciation').selectOption('hide');
    await expect(page.locator('#stage')).toHaveAttribute('data-said', '');
    expect(await band()).toBeLessThan(20);
  });
});
