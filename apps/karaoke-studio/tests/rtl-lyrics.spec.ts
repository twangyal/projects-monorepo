import { test, expect } from '@playwright/test';

function silence(seconds: number): Buffer {
  const frames = seconds * 44100, wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  return wav;
}

test('RTL and mixed lyrics stay shaped through seeks, explain whole-line mode, and return to LTR word timing', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'rtl.wav', mimeType: 'audio/wav', buffer: silence(12) });
  await expect(page.locator('#message')).toContainText('Your stems', { timeout: 15000 });
  const phrases = ['مرحبا بالعالم', 'שלום עולם 123', 'Sing مرحبا 123 now!', Array(20).fill('مرحبا').join(' '), 'LEFT RIGHT'];
  await page.getByLabel('Paste lyrics, one line per cue').fill(phrases.join('\n'));
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#stage')).toHaveAttribute('data-word-timing', 'estimated');
  for (const [index, text] of phrases.entries()) {
    const start = Number(await page.getByLabel(`Start line ${index + 1}`, { exact: true }).inputValue());
    const end = Number(await page.getByLabel(`End line ${index + 1}`, { exact: true }).inputValue());
    for (const fraction of [0.1, 0.8]) {
      await page.locator('audio').evaluate((node, time) => { (node as HTMLAudioElement).currentTime = time; node.dispatchEvent(new Event('timeupdate')); }, start + fraction * (end - start));
      await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', String(index));
      if (index === phrases.length - 1) continue;
      // Independent Canvas shaping oracle: no split prefix or reversed word list.
      const difference = await page.locator('#stage').evaluate((node, { text, direction }) => {
        const expected = document.createElement('canvas'); expected.width = 1280; expected.height = 720;
        const context = expected.getContext('2d')!;
        context.fillStyle = '#14232f'; context.fillRect(0, 0, 1280, 720);
        context.font = '44px KaraokeSans'; context.textAlign = 'center'; context.textBaseline = 'middle';
        context.direction = direction as CanvasDirection; context.fillStyle = '#e4b77d';
        const rows = text === Array(20).fill('مرحبا').join(' ')
          ? [Array(8).fill('مرحبا').join(' '), Array(8).fill('مرحبا').join(' '), Array(4).fill('مرحبا').join(' ')] : [text];
        rows.forEach((row, index) => context.fillText(row, 640, 320 + (index - (rows.length - 1) / 2) * 55));
        const actual = (node as HTMLCanvasElement).getContext('2d')!.getImageData(100, 220, 1080, 210).data;
        const reference = context.getImageData(100, 220, 1080, 210).data;
        let max = 0, masks = 0;
        for (let k = 0; k < actual.length; k += 4) {
          const delta = Math.abs(actual[k] - reference[k]) + Math.abs(actual[k+1] - reference[k+1]) + Math.abs(actual[k+2] - reference[k+2]);
          max = Math.max(max, delta);
          if ((actual[k] > 100) !== (reference[k] > 100)) masks++;
        }
        return { max, masks };
      }, { text, direction: index === 2 ? 'ltr' : 'rtl' });
      // GPU/CPU canvas antialiasing differs by at most two levels per channel.
      expect(difference.max, JSON.stringify({ text, fraction })).toBeLessThanOrEqual(6);
      expect(difference.masks, JSON.stringify({ text, fraction })).toBe(0);
      await expect(page.locator('#bidi-status')).toContainText('whole-line highlighting');
    }
  }
  // Existing LTR partial highlighting still has both sung and unsung pixels.
  const leftStart = Number(await page.getByLabel('Start line 5', { exact: true }).inputValue());
  await page.locator('audio').evaluate((node, time) => { (node as HTMLAudioElement).currentTime = time; node.dispatchEvent(new Event('timeupdate')); }, leftStart + 0.1);
  const colours = await page.locator('#stage').evaluate(node => {
    const pixels = (node as HTMLCanvasElement).getContext('2d')!.getImageData(100, 220, 1080, 210).data;
    let accent = 0, main = 0;
    for (let k = 0; k < pixels.length; k += 4) {
      if (pixels[k] === 228 && pixels[k + 1] === 183 && pixels[k + 2] === 125) accent++;
      if (pixels[k] === 247 && pixels[k + 1] === 245 && pixels[k + 2] === 237) main++;
    }
    return { accent, main };
  });
  expect(colours.accent).toBeGreaterThan(100); expect(colours.main).toBeGreaterThan(100);
  await page.getByLabel('Paste lyrics, one line per cue').fill('LEFT RIGHT');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#bidi-status')).toBeHidden();
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
});
