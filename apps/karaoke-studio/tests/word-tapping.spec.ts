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
type Line = { start: number; end: number; text: string; wordStarts?: number[] };

test('a line’s words are timed by tapping while it plays: saved, lit at those times in the exports, and cleared with Undo to come back', async ({ page }) => withClip(page, async id => {
  test.setTimeout(120000);
  const lines = async () => (await (await page.request.get(`/api/projects/${id}`)).json()).cues as Line[];
  const [line] = await lines();
  const words = line!.text.split(/\s+/);
  expect(words.length).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Time words line 1', exact: true }).click();
  // The line plays from a moment before it, with a button for the next word that has the focus.
  const group = page.getByRole('group', { name: 'Time the words of line 1', exact: true });
  const tap = group.getByRole('button', { name: `Word 1: ${words[0]}`, exact: true });
  await expect(tap).toBeFocused();
  await expect.poll(() => page.locator('audio').evaluate(a => !(a as HTMLAudioElement).paused)).toBe(true);
  // Taps are read from the player: hold it still and move it to each word's moment.
  await page.locator('audio').evaluate(a => (a as HTMLAudioElement).pause());
  // Whole hundredths, as word-timed LRC writes them.
  const at = words.map((_, index) => Math.round((line!.start + (index + 0.5) * (line!.end - line!.start) / words.length) * 100) / 100);
  for (const [index, word] of words.entries()) {
    await expect(group.getByRole('status')).toHaveText(`Press this button, or Space, as each word starts: ${index} of ${words.length} timed.`);
    await expect(group.getByRole('button', { name: `Word ${index + 1}: ${word}`, exact: true })).toBeFocused();
    await page.locator('audio').evaluate((a, time) => { (a as HTMLAudioElement).currentTime = time; }, at[index]!);
    await page.keyboard.press('Space');
  }
  await expect(page.locator('#message')).toContainText('Word times set by hand for line 1 as one unsaved edit');
  await expect(group).toBeHidden();
  await expect(page.locator('[data-cue="0"] .cue-words')).toContainText(`Word times set by hand: ${words[0]} ${at[0]!.toFixed(2)} s`);
  // Saved with the line, and the word-timed LRC lights each word at its tapped time.
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect.poll(async () => (await lines())[0]!.wordStarts).toEqual(at);
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export word-timed LRC', exact: true }).click();
  const lrc = (await readFile((await (await wait).path())!)).toString();
  const stamp = (time: number) => `<${String(Math.floor(time / 60)).padStart(2, '0')}:${(time % 60).toFixed(2).padStart(5, '0')}>`;
  expect(lrc).toContain(words.map((word, index) => `${stamp(at[index]!)}${word}`).join(' '));
  // Back to the studio's own word times, and Undo brings the hand-set ones back.
  await page.getByRole('button', { name: 'Use automatic word times line 1', exact: true }).click();
  await expect(page.locator('[data-cue="0"] .cue-words')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.locator('[data-cue="0"] .cue-words')).toContainText('Word times set by hand');
  // Another change to the line keeps them and saves; a word added drops them.
  await page.getByRole('combobox', { name: 'Singer line 1', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('Lyrics and timing saved locally.');
  expect(await lines()).toMatchObject([{ singer: 2, wordStarts: at }, {}, {}]);
  await page.getByLabel('Lyric line 1', { exact: true }).fill(`${line!.text} again`);
  await page.getByLabel('Lyric line 1', { exact: true }).blur();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toHaveText('Lyrics and timing saved locally.');
  expect((await lines())[0]).not.toHaveProperty('wordStarts');
  await expect(page.locator('[data-cue="0"] .cue-words')).toHaveCount(0);
  // A session left untapped as the line passes changes nothing.
  await page.getByRole('button', { name: 'Time words line 2', exact: true }).click();
  const second = page.getByRole('group', { name: 'Time the words of line 2', exact: true });
  await expect(second.getByRole('status')).toContainText('0 of');
  const [, next] = await lines();
  await page.locator('audio').evaluate((a, time) => { (a as HTMLAudioElement).currentTime = time; void (a as HTMLAudioElement).play(); }, next!.end + 1.6);
  await expect(page.locator('#message')).toContainText('Line 2 ended with');
  await expect(second).toBeHidden();
  await expect(page.locator('[data-cue="1"] .cue-words')).toHaveCount(0);
}));
