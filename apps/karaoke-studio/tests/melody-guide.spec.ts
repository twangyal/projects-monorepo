import { test, expect, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';

// Sixteen seconds of four sung notes (A3, C4, E4 and G4, with harmonics), with gaps between them.
const NOTES: [number, number, number][] = [[0.5, 3.5, 57], [4, 7, 60], [7.5, 10.5, 64], [11, 15, 67]];
function melodyTone(): Buffer {
  const frames = 16 * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const t = i / 44100, note = NOTES.find(([start, end]) => t >= start && t < end);
    let value = 0;
    if (note) {
      phase += 2 * Math.PI * 440 * 2 ** ((note[2] - 69) / 12) / 44100;
      value = [1, 2, 3, 4].reduce((sum, k) => sum + Math.sin(k * phase) / k, 0) * 4000;
    }
    for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(value), 44 + i * 4 + channel * 2);
  }
  return wav;
}
async function withClip(page: Page, run: (id: string) => Promise<void>) {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((p: { id: string }) => p.id));
  let ownedId: string | null = null;
  try {
    await page.goto('/');
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'melody-guide.wav', mimeType: 'audio/wav', buffer: melodyTone() });
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


test('the melody guide shows the sung notes as pitch bars in the preview and the exported video', async ({ page }, info) => withClip(page, async () => {
  test.setTimeout(120000);
  const melody = page.locator('#melody-guide'), stage = page.locator('#stage');
  await expect(melody).toHaveValue('hide');
  await expect(stage).not.toHaveAttribute('data-melody', /./);
  await melody.selectOption('show');
  await expect(stage).toHaveAttribute('data-melody', '4');
  await expect(page.locator('#melody-guide-status')).toHaveText('4 notes found.');
  // At five seconds the C is at the playhead.
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = 5; });
  await expect(stage).toHaveAttribute('data-melody-now', '60');
  const exported = page.waitForRequest(request => request.url().endsWith('/export') && request.method() === 'POST');
  const download = page.waitForEvent('download', { timeout: 90000 });
  await page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click();
  expect(JSON.parse((await exported).postData()!)).toEqual({ melody: true });
  const path = info.outputPath('melody.mp4');
  await (await download).saveAs(path);
  // In the video at five seconds, the C's bar just left of the playhead is in the sung colour and just right of it in
  // the colour still to be sung (the lane is 1000 px wide from x = 140, the playhead a fifth of the way along).
  const pixel = (x: number) => [...spawnSync('ffmpeg', ['-v', 'error', '-ss', '5', '-i', path, '-frames:v', '1', '-vf', `crop=1:1:${x}:196`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']).stdout];
  const near = (colour: number[], hex: string) => colour.every((value, i) => Math.abs(value - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) < 50);
  expect(near(pixel(328), '#e4b77d'), String(pixel(328))).toBe(true);
  expect(near(pixel(352), '#f7f5ed'), String(pixel(352))).toBe(true);
  await melody.selectOption('hide');
  await expect(stage).not.toHaveAttribute('data-melody', /./);
}));
