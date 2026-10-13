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

async function seek(page: Page, time: number) {
  await page.locator('audio').evaluate((audio, at) => { (audio as HTMLAudioElement).currentTime = at; audio.dispatchEvent(new Event('timeupdate')); }, time);
}
test('transcribing refreshes cached estimated word timing without changing lyric cues', async ({ page }) => {
  let timingRequests = 0;
  await page.route('**/word-timings', async route => {
    timingRequests++;
    if (timingRequests > 1) { await route.continue(); return; }
    // Represent the timing cached before recognition became available. Later requests use
    // the real fixture transcript, so this verifies refresh rather than merely changing a label.
    const { cues } = route.request().postDataJSON() as { cues: { start: number; end: number; text: string }[] };
    await route.fulfill({ json: {
      recognized: false,
      lines: cues.map(cue => {
        const words = cue.text.split(/\s+/).filter(Boolean);
        return words.map((text, index) => ({ text, start: cue.start + (cue.end - cue.start) * index / words.length, heard: false }));
      }),
    } });
  });
  await importClip(page, 16);
  await expect(page.locator('#auto-status')).toContainText('12 words were recognized');
  const before = await lines(page);
  await seek(page, 4.5);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'estimated');
  expect(timingRequests).toBe(1);

  await page.getByRole('button', { name: 'Transcribe again', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Lyrics recognized', { timeout: 15000 });
  expect(await lines(page)).toEqual(before);
  await seek(page, 4.5);
  await expect.poll(() => timingRequests).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'recognized');
  // The real transcript starts “This” at 4.0 s and “is” at 4.4 s.
  await expect(page.locator('#stage')).toHaveAttribute('data-sung', '6');
});
