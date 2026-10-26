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
const lines = (page: Page) => page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value));

async function seek(page: Page, time: number) {
  await page.locator('audio').evaluate((audio, at) => { (audio as HTMLAudioElement).currentTime = at; audio.dispatchEvent(new Event('timeupdate')); }, time);
}
/** Pixels in the active-line band close to the highlight colour and to the unsung text colour. */
const lineColours = (page: Page) => page.locator('#stage').evaluate(node => {
  const data = (node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 280, 1280, 80).data;
  let sung = 0, unsung = 0, sungRight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const near = (r: number, g: number, b: number) => Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 30;
    if (near(0xe4, 0xb7, 0x7d)) { sung++; if ((i / 4) % 1280 > 640) sungRight++; }
    if (near(0xf7, 0xf5, 0xed)) unsung++;
  }
  return { sung, unsung, sungRight };
});

test('a new song arrives with automatically timed lyrics that preview word by word, align pasted lyrics and stay correctable', async ({ page }) => {
  await importClip(page, 16);
  await expect(page.locator('#message')).toContainText('Your stems and 3 automatically timed lyric lines are ready');
  expect(await lines(page)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  await expect(page.locator('#auto-status')).toContainText('12 words were recognized from the separated vocals by the English recognition model and grouped into 3 lines');
  await expect(page.locator('#auto-status')).toContainText('it was least sure about automatic line 3, so listen to those first');
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  await expect(page.getByRole('button', { name: 'Export karaoke MP4', exact: true })).toBeEnabled();
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = 4.5; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '1');
  // Words light up as they are sung. "This is our chorus": This 4.0 s, is 4.4 s, our 4.8 s, chorus 5.2 s.
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '6');
  let colours = await lineColours(page);
  expect(colours.sung).toBeGreaterThan(100); expect(colours.unsung).toBeGreaterThan(100);
  expect(colours.sungRight).toBe(0);
  await seek(page, 5.3);
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '15');
  colours = await lineColours(page);
  expect(colours.unsung).toBeLessThan(20);

  // Known lyrics are synchronized to the recognized words; an unheard line is called out.
  await page.getByLabel('Paste lyrics, one line per cue').fill('Hello, little world!\nThis is our chorus\nA line nobody sang\nSing it back to me');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Aligned 4 lines to the sung vocals. Check line 3');
  expect(await lines(page)).toEqual(['Hello, little world!', 'This is our chorus', 'A line nobody sang', 'Sing it back to me']);
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.85');
  await expect(page.getByLabel('Start line 4', { exact: true })).toHaveValue('8.85');
  const third = Number(await page.getByLabel('Start line 3', { exact: true }).inputValue());
  expect(third).toBeGreaterThan(5.6); expect(third).toBeLessThan(8.85);
  await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');

  // Undo returns to the automatic lines; review can re-apply them as one edit.
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  expect(await lines(page)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  await page.getByRole('button', { name: 'Discard pasted draft', exact: true }).click();
  await page.getByLabel('Lyric line 2', { exact: true }).fill('This is my chorus');
  // An unsaved correction is timed straight away: "my" was never heard, so it falls between "is" and "chorus".
  await seek(page, 5.0);
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '8');
  await seek(page, 4.5);
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '6');
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await expect(page.locator('#srt-review-list li')).toHaveCount(3);
  await expect(page.locator('#srt-summary')).toContainText('3 automatically recognized lines');
  await expect(page.locator('#srt-review-list li[data-unsure]')).toHaveCount(1);
  await expect(page.locator('#srt-review-list li').nth(2)).toContainText('recognition unsure — listen');
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Automatic lyrics applied as one edit');
  expect(await lines(page)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  // Re-applying the recognized lines returns exactly to the saved lyrics, so nothing is left unsaved.
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');

  // Transcribing again refreshes recognition without touching saved lyrics.
  await page.getByRole('button', { name: 'Transcribe again', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Lyrics recognized', { timeout: 15000 });
  expect(await lines(page)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
});

test('a clip without recognized lyrics explains itself, keeps even draft spacing and estimates word highlighting', async ({ page }) => {
  await importClip(page, 3);
  await expect(page.locator('#message')).toContainText('No lyrics were recognized automatically');
  await expect(page.locator('#auto-status')).toContainText('This clip has no recognized lyrics yet');
  await expect(page.getByRole('button', { name: 'Review automatic lyrics' })).toBeHidden();
  await page.getByLabel('Paste lyrics, one line per cue').fill('One two three\nFour');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#message')).toContainText('evenly spaced because this clip has no recognized lyrics');
  // Without recognized words a line's words are spread over it; it starts when its singing starts.
  const start = Number(await page.getByLabel('Start line 1', { exact: true }).inputValue()), end = Number(await page.getByLabel('End line 1', { exact: true }).inputValue());
  await seek(page, start + 0.01);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'estimated');
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '3');
  await seek(page, end - 0.01);
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '11');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});


test('retry choice refreshes recognition while corrections survive until deliberate review', async ({ page }) => {
  const before = new Set<string>((await (await page.request.get('/api/projects')).json()).projects.map((project: { id: string }) => project.id));
  try {
  await importClip(page, 16);
  const choice = page.getByLabel('Recognition for this retry', { exact: true });
  await expect(choice).toHaveValue('auto');
  await page.getByLabel('Lyric line 2', { exact: true }).fill('My corrected chorus');
  await choice.selectOption('multilingual');
  const requested = page.waitForRequest(request => request.url().endsWith('/transcribe') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Transcribe again', exact: true }).click();
  expect((await requested).postDataJSON()).toEqual({ modelChoice: 'multilingual' });
  await expect(choice).toBeDisabled();
  await expect(page.locator('#message')).toContainText('Lyrics recognized', { timeout: 15000 });
  await expect(page.locator('#auto-status')).toContainText('multilingual recognition model');
  expect(await lines(page)).toEqual(['Hello little world', 'My corrected chorus', 'Sing it back to me']);
  await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');
  await page.getByRole('button', { name: 'Review automatic lyrics', exact: true }).click();
  await page.getByRole('button', { name: 'Replace lyric cues', exact: true }).click();
  expect(await lines(page)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  expect(await lines(page)).toEqual(['Hello little world', 'My corrected chorus', 'Sing it back to me']);
  // Opening a different clip resets this per-retry choice; no model choice is persisted in a project.
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'next.wav', mimeType: 'audio/wav', buffer: tone(16) });
  await expect(page.locator('#message')).toContainText('Your stems', { timeout: 15000 });
  await expect(choice).toHaveValue('auto');
  } finally {
    // This test owns its two uploads. Keep the shared fixture library's real quota unchanged.
    const session = await (await page.request.get('/api/session')).json();
    const projects = (await (await page.request.get('/api/projects')).json()).projects;
    for (const project of projects) if (!before.has(project.id)) {
      const response = await page.request.delete(`/api/projects/${project.id}`, { headers: { 'X-Karaoke-Token': session.token }, data: {} });
      expect(response.ok()).toBe(true);
    }
    expect((await (await page.request.get('/api/projects')).json()).projects.map((project: { id: string }) => project.id).sort()).toEqual([...before].sort());
  }
});

test('preview explains failed word timing, retries an edited draft and ignores a stale failure', async ({ page }) => {
  await isolatedClip(page, async () => {
  await importClip(page, 16);
  await seek(page, 1.6);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  await page.route('**/word-timings', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'These lyrics differ too much from recognition to align safely.' }) }));
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Hello little earth');
  await expect(page.locator('#word-timing-status')).toContainText('differ too much');
  await expect(page.locator('#word-timing-status')).toContainText('whole lines');
  expect((await lines(page))[0]).toBe('Hello little earth');
  await expect(page.locator('#save-state')).toContainText('Unsaved lyric edits');
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'none');
  await page.unroute('**/word-timings');
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Hello little world');
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  await expect(page.locator('#word-timing-status')).toBeHidden();

  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let captured!: () => void;
  const requested = new Promise<void>(resolve => { captured = resolve; });
  await page.route('**/word-timings', async route => {
    if (route.request().postDataJSON().cues[0].text !== 'Old failure') return route.continue();
    captured(); await held;
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Stale timing failure' }) });
  });
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Old failure'); await requested;
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Current words');
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  const oldResponse = page.waitForResponse(response => response.url().endsWith('/word-timings') && response.status() === 400);
  release(); await oldResponse;
  await expect(page.locator('#word-timing-status')).toBeHidden();
  expect((await lines(page))[0]).toBe('Current words');
  });
});

test('a late word-timing failure cannot describe a newer invalid lyric draft', async ({ page }) => {
  await isolatedClip(page, async () => {
  await importClip(page, 16); await seek(page, 1.6);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  let release!: () => void, captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { captured = resolve; });
  await page.route('**/word-timings', async route => {
    captured(); await held;
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Old timing failure' }) });
  });
  await page.getByLabel('Lyric line 1', { exact: true }).fill('Old request'); await requested;
  await page.getByLabel('Lyric line 1', { exact: true }).fill('');
  await expect(page.locator('#cue-validation')).not.toBeEmpty();
  const response = page.waitForResponse(r => r.url().endsWith('/word-timings') && r.status() === 400);
  release(); await response;
  await expect(page.locator('#word-timing-status')).toBeHidden();
  expect((await lines(page))[0]).toBe('');
  });
});
