import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A 16-second MP3 whose tags carry a cover picture, red on the left and blue on the right. */
function taggedSong(): Buffer {
  const folder = mkdtempSync(join(tmpdir(), 'karaoke-cover-'));
  try {
    const picture = join(folder, 'cover.png'), song = join(folder, 'song.mp3');
    const run = (args: string[]) => { const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args]); if (result.status !== 0) throw new Error(result.stderr.toString()); };
    run(['-f', 'lavfi', '-i', 'color=c=0xc81e1e:s=200x400,format=rgb24', '-f', 'lavfi', '-i', 'color=c=0x1e1ec8:s=200x400,format=rgb24', '-filter_complex', 'hstack', '-frames:v', '1', picture]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=16', '-i', picture, '-map', '0', '-map', '1', '-ac', '2', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-disposition:v', 'attached_pic', song]);
    return readFileSync(song);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
async function withClip(page: Page, song: Buffer, run: (id: string) => Promise<void>) {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id));
  let ownedId: string | null = null;
  try {
    await page.goto('/');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'cover-art.mp3', mimeType: 'audio/mpeg', buffer: song });
    const response = await accepted;
    expect(response.status()).toBe(202);
    ownedId = (await response.json()).job.projectId;
    expect(typeof ownedId).toBe('string');
    await expect(page.locator('#projects')).toHaveValue(ownedId!, { timeout: 30000 });
    await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
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


test('a song file\'s cover art lies behind the lyrics in the preview, and a plain background can be chosen', async ({ page }) => withClip(page, taggedSong(), async id => {
  // The clip keeps the picture, also through saving lyrics; the list of clips leaves it out.
  const session = await (await page.request.get('/api/session')).json();
  const before = await (await page.request.get(`/api/projects/${id}`)).json();
  expect((await page.request.put(`/api/projects/${id}`, { headers: { 'X-Karaoke-Token': session.token },
    data: { title: before.title, revision: before.revision, cues: [{ start: 1, end: 3, text: 'Under the cover' }] } })).ok()).toBe(true);
  const project = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(project.cover).toMatch(/^data:image\/jpeg;base64,/);
  expect(project.cover).toBe(before.cover);
  await page.reload();
  await expect(page.locator('#projects')).toHaveValue(id, { timeout: 15000 });
  const listed = (await (await page.request.get('/api/projects')).json()).projects.find((item: { id: string }) => item.id === id);
  expect(listed).not.toHaveProperty('cover');
  const background = page.locator('#video-background'), stage = page.locator('#stage');
  await expect(background).toBeEnabled(); await expect(background).toHaveValue('cover');
  await expect(stage).toHaveAttribute('data-background', 'cover');
  const pixel = (x: number) => stage.evaluate((canvas, at) => Array.from((canvas as HTMLCanvasElement).getContext('2d')!.getImageData(at, 360, 1, 1).data.slice(0, 3)), x);
  const [left, right] = [await pixel(20), await pixel(1260)];
  expect(left[0] - right[0]).toBeGreaterThan(25); expect(right[2] - left[2]).toBeGreaterThan(25);
  await background.selectOption('plain');
  await expect(stage).toHaveAttribute('data-background', 'plain');
  expect(await pixel(20)).toEqual(await pixel(1260));
  const exported = page.waitForRequest(request => request.url().endsWith('/export') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click();
  expect(JSON.parse((await exported).postData()!)).toEqual({ background: 'plain' });
}));
