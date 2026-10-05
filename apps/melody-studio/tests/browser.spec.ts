import { test, expect } from '@playwright/test';

test('compose, edit, layer, play, persist and export', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Melody Studio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load example' }).click();
  await expect(page.getByLabel('Project title')).toHaveValue('First light');
  await expect(page.getByRole('button', { name: 'Select track: Melody' })).toBeVisible();
  await page.getByLabel('Tempo (BPM)').fill('110');
  await page.getByLabel('Tempo (BPM)').press('Tab');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Pitch (MIDI)').fill('67');
  await page.getByRole('button', { name: 'Apply note' }).click();
  await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue('67');
  await page.getByRole('button', { name: 'Add track', exact: true }).click();
  await page.getByLabel('Track name').fill('Bass idea');
  await page.getByLabel('Track name').press('Tab');
  await page.getByLabel('Instrument').selectOption('triangle');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByRole('button', { name: 'Play composition' }).click();
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop playback' }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save project file' }).click();
  const file = await jsonDownload;
  expect(file.suggestedFilename()).toMatch(/\.melody\.json$/);
  const path = await file.path();
  await page.reload();
  await expect(page.getByLabel('Tempo (BPM)')).toHaveValue('110');
  await expect(page.getByRole('button', { name: 'Select track: Bass idea' })).toBeVisible();
  for (const [name, extension] of [['Export MIDI', '.mid'], ['Export WAV', '.wav']]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    expect((await download).suggestedFilename()).toContain(extension);
  }
  page.on('dialog', dialog => dialog.accept());
  await page.getByLabel('Open project file').setInputFiles(path!);
  await expect(page.locator('#notice')).toContainText('Project opened');
  expect(errors).toEqual([]);
});

test('local demo audio is transcribed and invalid imports preserve the project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try demo melody' }).click();
  await expect(page.locator('#notice')).toContainText('Detected', { timeout: 20000 });
  await expect(page.locator('.note-event')).not.toHaveCount(0);
  await page.getByLabel('Project title').fill('Keep my song');
  await page.getByLabel('Project title').press('Tab');
  await page.getByLabel('Open project file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.locator('#notice')).toContainText('Could not open');
  await expect(page.getByLabel('Project title')).toHaveValue('Keep my song');
  await page.reload();
  await expect(page.getByLabel('Project title')).toHaveValue('Keep my song');
});

test('recording permission failures recover and unavailable storage is visible', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) });
    Object.defineProperty(window, 'localStorage', { get: () => { throw new Error('Disabled'); } });
    Object.defineProperty(window, 'indexedDB', { get: () => { throw new Error('Disabled'); } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Record melody', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Microphone');
  await expect(page.getByRole('button', { name: 'Record melody', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('#save-status')).toContainText(/not saved/i);
});

test('mobile layout and keyboard note editing stay within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await page.getByLabel('Pitch (MIDI)').fill('60');
  await page.getByRole('button', { name: 'Apply note' }).press('Enter');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/melody-studio-mobile.png', fullPage: true });
});

test('settings retain keyboard focus and clicking after typing works on the first click', async ({ page }) => {
  await page.goto('/');
  await page.locator('#volume').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#volume')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#volume')).toHaveValue('0.7');
  await page.getByLabel('Project title').fill('An idea');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.note-event')).toHaveCount(1);
  await page.getByLabel('Tempo (BPM)').focus();
  await page.getByLabel('Tempo (BPM)').fill('105');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Play composition' })).toBeFocused();
});

test('imported audio follows the real decoder and worker path', async ({ page }) => {
  const { encodeWav } = await import('../src/wav.ts');
  const samples = Float32Array.from({ length: 22050 }, (_, i) => Math.sin(2 * Math.PI * 440 * i / 22050) * 0.3);
  await page.goto('/');
  await page.getByLabel('Import audio file').setInputFiles({ name: 'a4.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav(samples, 22050)) });
  await expect(page.locator('#notice')).toContainText('Detected');
  await expect(page.getByLabel('Pitch (MIDI)')).toHaveValue('69');
  // Detected velocity may not be a multiple of .05; a pitch-only correction must still submit.
  await page.getByLabel('Pitch (MIDI)').fill('67');
  await page.getByRole('button', { name: 'Apply note' }).click();
  await expect(page.locator('#notice')).toContainText('Note updated');
});

test('dense synthesis is cancellable without freezing the page', async ({ page }) => {
  // Hold just the render worker to verify UI cancellation independently of machine speed.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(String(url).includes('render.worker') ? URL.createObjectURL(new Blob(['self.onmessage = () => {}'], { type: 'text/javascript' })) : url, options);
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play composition' })).toBeEnabled();
  await expect(page.getByLabel('Project title')).toHaveValue('First light');
});
