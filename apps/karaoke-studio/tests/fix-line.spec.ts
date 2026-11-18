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
    await page.getByLabel('Upload song clip').setInputFiles({ name: 'words.wav', mimeType: 'audio/wav', buffer: tone() });
    const response = await accepted;
    expect(response.status()).toBe(202);
    ownedId = (await response.json()).job.projectId;
    await expect(page.locator('#message')).toContainText('3 automatically timed lyric lines', { timeout: 15000 });
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
  }
}
type Line = { start: number; end: number; text: string };
const seek = (page: Page, time: number) => page.locator('audio').evaluate((a, t) => { (a as HTMLAudioElement).currentTime = t; }, time);
const selected = (page: Page, line: number) => page.getByLabel(`Lyric line ${line}`, { exact: true })
  .evaluate(t => { const area = t as HTMLTextAreaElement; return [area.value.slice(area.selectionStart, area.selectionEnd), area.selectionStart, area.value.length] as const; });
/** Click the preview at a point given in its own pixels. */
async function clickStage(page: Page, x: number, y: number) {
  const stage = page.locator('#stage'), box = (await stage.boundingBox())!;
  const [width, height] = await stage.evaluate(c => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height]);
  await page.mouse.click(box.x + x * box.width / width!, box.y + y * box.height / height!);
}

test('Fix this line pauses on the line being sung with its word selected; typing replaces it and Enter plays on from just before the line', async ({ page }) => withClip(page, async id => {
  const cues = (await (await page.request.get(`/api/projects/${id}`)).json()).cues as Line[];
  expect(cues.map(cue => cue.text)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  const fix = page.getByRole('button', { name: 'Fix this line', exact: true }), status = page.locator('#fix-line-status');
  await expect(status).toContainText('Hear a wrong word?');
  // Paused in "world" (sung from 2.0 s): that word is selected in line 1, in the Lyrics tool.
  await seek(page, 2.1);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  await fix.click();
  const line1 = page.getByLabel('Lyric line 1', { exact: true });
  await expect(line1).toBeFocused();
  expect(await selected(page, 1)).toEqual(['world', 13, 18]);
  await expect(status).toContainText('Paused on line 1, with “world” selected');
  await page.keyboard.type('word');
  await expect(line1).toHaveValue('Hello little word');
  // Enter adds no line break: it plays on from a second before the line, with the button ready for the next fix.
  await page.locator('audio').evaluate(a => { (window as unknown as { seekedTo: number | null }).seekedTo = null; a.addEventListener('seeking', () => { (window as unknown as { seekedTo: number }).seekedTo = (a as HTMLAudioElement).currentTime; }, { once: true }); });
  await page.keyboard.press('Enter');
  await expect(line1).toHaveValue('Hello little word');
  await expect(fix).toBeFocused();
  await expect.poll(() => page.evaluate(() => (window as unknown as { seekedTo: number | null }).seekedTo)).toBeCloseTo(Math.max(0, cues[0]!.start - 1), 3);
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await expect(status).toContainText('Playing on from just before line 1.');
  // The correction is one unsaved edit: the preview shows it, and Undo puts back what was heard.
  await page.locator('audio').evaluate(a => (a as HTMLAudioElement).pause());
  await expect(page.locator('#save-state')).toHaveText('Unsaved lyric edits — save before exporting.');
  await seek(page, 2.1);
  await expect(page.locator('#current-line')).toHaveText('Hello little word');
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('Hello little world');

  // During playback, the press means the word heard a moment before it (once the restored words are timed again).
  await seek(page, 9.6);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  await page.locator('audio').evaluate(a => (a as HTMLAudioElement).play());
  await expect.poll(() => page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime)).toBeGreaterThan(9.7);
  await fix.click();
  await expect(page.getByLabel('Lyric line 3', { exact: true })).toBeFocused();
  expect(await page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  const pressed = await page.locator('audio').evaluate(a => (a as HTMLAudioElement).currentTime);
  const starts: [string, number][] = [['Sing', 9.0], ['it', 9.5], ['back', 10.0], ['to', 10.5], ['me', 11.0]];
  const meant = starts.filter(([, start]) => start <= Math.max(9.0, pressed - 0.4)).at(-1)![0];
  expect((await selected(page, 3))[0]).toBe(meant);
  // Esc stays paused, back on the button.
  await page.keyboard.press('Escape');
  await expect(fix).toBeFocused();
  await expect(status).toContainText('Still paused on line 3.');
  expect(await page.locator('audio').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
}));

test('a click on a word in the preview opens that word, and a click on the next line opens it; Shift+Enter keeps a line break', async ({ page }) => withClip(page, async () => {
  // Paused in line 2 with "our" being sung: clicking "This" selects it.
  await seek(page, 4.9);
  await expect(page.locator('#stage')).toHaveAttribute('data-fix-words', /^This@\d+,\d+ is@\d+,\d+ our@\d+,\d+ chorus@\d+,\d+$/);
  const places = Object.fromEntries((await page.locator('#stage').getAttribute('data-fix-words'))!.split(' ').map(place => {
    const [word, at] = place.split('@'); return [word, at!.split(',').map(Number)];
  }));
  await clickStage(page, places.This[0], places.This[1]);
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toBeFocused();
  expect(await selected(page, 2)).toEqual(['This', 0, 18]);
  await expect(page.locator('#fix-line-status')).toContainText('Paused on line 2, with “This” selected');
  await clickStage(page, places.chorus[0], places.chorus[1]);
  expect((await selected(page, 2))[0]).toBe('chorus');
  // Between lines the next one is shown below: clicking it opens that line with the caret at its end.
  await seek(page, 3.0);
  await expect(page.locator('#stage')).toHaveAttribute('data-fix-next', /^\d+,\d+$/);
  const [top, bottom] = (await page.locator('#stage').getAttribute('data-fix-next'))!.split(',').map(Number);
  await clickStage(page, 640, (top! + bottom!) / 2);
  const line2 = page.getByLabel('Lyric line 2', { exact: true });
  await expect(line2).toBeFocused();
  expect(await selected(page, 2)).toEqual(['', 18, 18]);
  await expect(page.locator('#fix-line-status')).toContainText('Paused on line 2. Type the fix');
  // Shift+Enter starts a new line inside the lyric line, as everywhere else; Enter then plays on.
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('yeah');
  await expect(line2).toHaveValue('This is our chorus\nyeah');
  await page.keyboard.press('Enter');
  await expect(line2).toHaveValue('This is our chorus\nyeah');
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  await page.locator('audio').evaluate(a => (a as HTMLAudioElement).pause());
}));

test('Fix this line waits while a lyric review is open, so its drafts are not closed by typing', async ({ page }) => withClip(page, async () => {
  const fix = page.getByRole('button', { name: 'Fix this line', exact: true });
  await expect(fix).toBeEnabled();
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.locator('#srt-review-list li')).toHaveCount(3);
  await expect(fix).toBeDisabled();
  await expect(page.locator('#fix-line-status')).toContainText('Finish or cancel the open lyric review');
  // A click on the preview explains the same and changes nothing.
  await seek(page, 2.1);
  await clickStage(page, 640, 360);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).not.toBeFocused();
  await page.locator('#srt-cancel').click();
  await expect(fix).toBeEnabled();
  await expect(page.locator('#fix-line-status')).toContainText('Hear a wrong word?');
}));
