import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';

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
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'lyric-style.wav', mimeType: 'audio/wav', buffer: tone() });
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

test('the lyric style shows in the preview and the exported video', async ({ page }, info) => withClip(page, async () => {
  const style = page.locator('#lyric-style'), stage = page.locator('#stage');
  await expect(style).toHaveValue('classic');
  await style.selectOption('contrast');
  await expect(stage).toHaveAttribute('data-lyric-style', 'contrast');
  expect(await stage.evaluate(canvas => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(4, 4, 1, 1).data.slice(0, 3)))).toEqual([0, 0, 0]);
  const exported = page.waitForRequest(request => request.url().endsWith('/export') && request.method() === 'POST');
  const download = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click();
  expect(JSON.parse((await exported).postData()!)).toEqual({ style: 'contrast' });
  const path = info.outputPath('contrast.mp4');
  await (await download).saveAs(path);
  // A pixel in the corner of the first frame is black, not the classic navy.
  const pixel = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-frames:v', '1', '-vf', 'crop=1:1:8:8', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']).stdout;
  expect(Math.max(...pixel)).toBeLessThan(12);
}));
