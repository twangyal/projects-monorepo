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
const lines = (page: Page) => page.locator('#cue-list textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLTextAreaElement).value));

test('a new song arrives with automatically timed lyrics that preview, align pasted lyrics and stay correctable', async ({ page }) => {
  await importClip(page, 16);
  await expect(page.locator('#message')).toContainText('Your stems and 3 automatically timed lyric lines are ready');
  expect(await lines(page)).toEqual(['Hello little world', 'This is our chorus', 'Sing it back to me']);
  await expect(page.locator('#auto-status')).toContainText('12 words were recognized from the separated vocals and grouped into 3 lines');
  await expect(page.locator('#auto-status')).toContainText('it was least sure about automatic line 3, so listen to those first');
  await expect(page.locator('#save-state')).toHaveText('Saved in your local studio.');
  await expect(page.getByRole('button', { name: 'Export karaoke MP4', exact: true })).toBeEnabled();
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = 4.5; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '1');

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

test('a clip without recognized lyrics explains itself and keeps even draft spacing', async ({ page }) => {
  await importClip(page, 3);
  await expect(page.locator('#message')).toContainText('No lyrics were recognized automatically');
  await expect(page.locator('#auto-status')).toContainText('This clip has no recognized lyrics yet');
  await expect(page.getByRole('button', { name: 'Review automatic lyrics' })).toBeHidden();
  await page.getByLabel('Paste lyrics, one line per cue').fill('One\nTwo');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#message')).toContainText('evenly spaced because this clip has no recognized lyrics');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
