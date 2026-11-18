import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'duet.wav', mimeType: 'audio/wav', buffer: tone() });
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

test('lines can be marked for singer 1, singer 2 or both: the preview colours them and says whose is next, and they are saved and exported', async ({ page }) => withClip(page, async id => {
  test.setTimeout(120000);
  const stage = page.locator('#stage');
  const seek = (time: number) => page.locator('audio').evaluate((node, at) => { (node as HTMLAudioElement).currentTime = at; node.dispatchEvent(new Event('timeupdate')); }, time);
  const cues = async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues as { start: number; end: number; text: string; singer?: 1 | 2 | 'both' }[];
  const lines = await cues();
  // The choice sits under the line's times, wide enough to read.
  const first = page.getByRole('combobox', { name: 'Singer line 1', exact: true });
  const [choice, end] = [await first.boundingBox(), await page.getByLabel('End line 1', { exact: true }).boundingBox()];
  expect(choice!.width).toBeGreaterThan(100);
  expect(choice!.y).toBeGreaterThan(end!.y + end!.height - 1);
  await first.selectOption('1');
  await page.getByRole('combobox', { name: 'Singer line 2', exact: true }).selectOption('2');
  await page.getByRole('combobox', { name: 'Singer line 3', exact: true }).selectOption('both');
  // In the preview each line takes its singer's colours, unlike a line for anyone.
  // The colours on the canvas, as "r,g,b".
  const colours = () => stage.evaluate(canvas => { const data = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, (canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height).data, seen = new Set<string>(); for (let i = 0; i < data.length; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`); return [...seen]; });
  // Singer 2's words still to be sung lean toward singer 2's blue (classic style: #d8e7f2, see part-colours.json).
  const singer2 = '216,231,242', anyone = '247,245,237';
  await seek(lines[1]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', '2');
  expect(await colours()).toContain(singer2);
  await seek(lines[2]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', 'both');
  await seek(lines[0]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', '1');
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect.poll(async () => (await cues()).map(cue => cue.singer ?? null)).toEqual([1, 2, 'both']);
  // Karaoke subtitles give each part its own style, named in each line.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export karaoke subtitles (ASS)', exact: true }).click();
  const ass = await readFile((await (await download).path())!, 'utf8');
  for (const part of ['Singer 1', 'Singer 2', 'Both']) expect(ass).toContain(`Style: ${part},`);
  expect(ass.split('\n').filter(line => line.startsWith('Dialogue:')).map(line => line.split(',')[4])).toEqual(['Singer 1', 'Singer 2', 'Both']);
  // Lines from a subtitle file that replace the duet's keep its parts.
  const stamp = (seconds: number) => { const ms = Math.round(seconds * 1000); return `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  const srt = lines.map((line, index) => `${index + 1}\n${stamp(line.start)} --> ${stamp(line.end)}\nImported line ${index + 1}\n`).join('\n');
  await page.locator('#srt-file').setInputFiles({ name: 'duet.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.locator('#srt-review')).toBeVisible();
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Imported line 1');
  for (const [line, singer] of [[1, '1'], [2, '2'], [3, 'both']] as const) await expect(page.getByRole('combobox', { name: `Singer line ${line}`, exact: true })).toHaveValue(singer);
  // Back to anyone: the part goes.
  await page.getByRole('combobox', { name: 'Singer line 2', exact: true }).selectOption('');
  await seek(lines[1]!.start + 0.01);
  await expect(stage).toHaveAttribute('data-singer', '');
  await expect.poll(async () => (await colours()).includes(singer2)).toBe(false);
  expect(await colours()).toContain(anyone);
}));
