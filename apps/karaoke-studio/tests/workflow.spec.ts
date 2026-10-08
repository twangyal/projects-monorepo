import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);

function tone(duration = 3): Buffer {
  const frames = Math.floor(duration * 44100), wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(176400, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) for (let channel = 0; channel < 2; channel++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / 44100) * 5000), 44 + i * 4 + channel * 2);
  return wav;
}
async function importClip(page: Page, name = 'practice.wav', duration = 3) {
  await page.goto('/');
  await expect(page.locator('#model-state')).toHaveText('Local CPU model ready');
  await page.getByLabel('Upload song clip').setInputFiles({ name, mimeType: 'audio/wav', buffer: tone(duration) });
  await expect(page.locator('#message')).toContainText('Your stems are ready', { timeout: 15000 });
  await expect(page.getByLabel('Clip title')).toBeVisible();
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
}
test('complete clip-to-lyrics-to-real-MP4 workflow, persisted project and saved timing downloads', async ({ page }) => {
  await importClip(page);
  await page.getByLabel('Clip title').fill('Kitchen concert');
  await page.getByLabel('Paste lyrics, one line per cue').fill('Hello, little world\nThis is our chorus');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#message')).toContainText('evenly spaced');
  await page.getByLabel('Start line 1', { exact: true }).fill('0.25');
  await page.getByLabel('End line 1', { exact: true }).fill('1.25');
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = .5; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '0');
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = 1.35; audio.dispatchEvent(new Event('timeupdate')); });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '-1');
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload();
  await expect(page.getByLabel('Clip title')).toHaveValue('Kitchen concert');
  await expect(page.getByLabel('Start line 1', { exact: true })).toHaveValue('0.25');
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('audio').evaluate(audio => { (audio as HTMLAudioElement).currentTime = .5; });
  for (const name of ['Original', 'Vocals', 'Backing']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', new RegExp(`/audio/${name.toLowerCase()}$`));
    await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeCloseTo(.5, 2);
  }
  const [lyrics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click()]);
  expect(await readFile((await lyrics.path())!, 'utf8')).toContain('00:00:00,250 --> 00:00:01,250');
  const [video] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click()]);
  const bytes = await readFile((await video.path())!);
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(bytes.length).toBeGreaterThan(1000);
});
test('delete confirms the selected clip and frees its saved slot', async ({ page }) => {
  await importClip(page, 'delete-me.wav');
  const id = new URL(page.url()).searchParams.get('project')!;
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
  await expect(page.getByLabel('Clip title')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete selected clip', exact: true }).click();
  await expect(page.locator('#message')).toContainText('selected clip was deleted');
  await expect(page.getByLabel('Clip title')).toBeHidden();
  const response = await page.request.get(`/api/projects/${id}`);
  expect(response.status()).toBe(404);
  const remaining = await (await page.request.get('/api/projects')).json();
  expect(remaining.projects.some((project: { id: string }) => project.id === id)).toBe(false);
});
test('invalid timing and stale saves preserve editable user drafts', async ({ page }) => {
  await importClip(page, 'validation.wav');
  await page.getByLabel('Paste lyrics, one line per cue').fill('First line\nSecond line');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await page.getByLabel('End line 1', { exact: true }).fill('5');
  await expect(page.locator('#cue-validation')).toContainText('within the clip');
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeDisabled();
  await page.getByLabel('End line 1', { exact: true }).fill('1.5');
  await page.route('**/api/projects/*', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Project revision changed. Reload before saving.' }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('revision');
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue('First line');
  await expect(page.locator('#save-state')).toContainText('Unsaved');
});
test('failed audio imports keep the current completed project and allow retry', async ({ page }) => {
  await importClip(page, 'kept.wav');
  const title = await page.getByLabel('Clip title').inputValue();
  await page.getByLabel('Upload song clip').setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('invalid wave bytes') });
  await expect(page.locator('#job-panel')).toBeHidden({ timeout: 10000 });
  await expect(page.locator('#message')).toHaveClass(/error/);
  await expect(page.getByLabel('Clip title')).toHaveValue(title);
  await expect(page.getByLabel('Upload song clip')).toBeEnabled();
});
test('narrow layout is usable without external requests or page errors', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('The local browser test origin is required.');
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(`${baseURL}/`)) external.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Karaoke Studio', exact: true })).toBeVisible();
  await expect(page.getByLabel('Upload song clip')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('explicit fake-separator full-song fixture seeks late, persists boundary cues and downloads complete real media', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await importClip(page, 'original-sixty-second-fixture.wav', 60);
  await expect.poll(() => page.locator('audio').evaluate(element => (element as HTMLAudioElement).duration)).toBeCloseTo(60, 3);
  await page.getByLabel('Clip title').fill('Original sixty-second fixture');
  await page.getByLabel('Paste lyrics, one line per cue').fill('BOUNDARY chorus 🌓\nFINAL chorus 🎵');
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  for (const [label, value] of [['Start line 1', '29.75'], ['End line 1', '30.25'],
                               ['Start line 2', '58'], ['End line 2', '59.5']]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeEnabled();

  // These are native seeks through the actual range-enabled HTTP audio, without
  // fabricated timeupdate events or replacement media objects.
  for (const [seconds, cue] of [[30, '0'], [31, '-1'], [58.5, '1']] as const) {
    await page.locator('audio').evaluate((element, seconds) => { (element as HTMLAudioElement).currentTime = seconds; }, seconds);
    await expect.poll(() => page.locator('audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeCloseTo(seconds, 2);
    await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', cue);
  }
  for (const name of ['Original', 'Vocals', 'Backing']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('audio')).toHaveAttribute('src', new RegExp(`/audio/${name.toLowerCase()}$`));
    await expect.poll(() => page.locator('audio').evaluate(element => (element as HTMLAudioElement).currentTime)).toBeCloseTo(58.5, 2);
  }
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload();
  await expect(page.getByLabel('Clip title')).toHaveValue('Original sixty-second fixture');
  await expect(page.getByLabel('Start line 2', { exact: true })).toHaveValue('58');
  await expect(page.getByLabel('End line 2', { exact: true })).toHaveValue('59.5');
  await expect(page.getByLabel('Lyric line 2', { exact: true })).toHaveValue('FINAL chorus 🎵');
  await expect.poll(() => page.locator('audio').evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('audio').evaluate(element => { (element as HTMLAudioElement).currentTime = 58.5; });
  await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '1');

  const [srt] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export timed lyrics', exact: true }).click()]);
  expect(await readFile((await srt.path())!, 'utf8')).toBe(
    '1\n00:00:29,750 --> 00:00:30,250\nBOUNDARY chorus 🌓\n\n2\n00:00:58,000 --> 00:00:59,500\nFINAL chorus 🎵\n');
  const [backing] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backing WAV', exact: true }).click()]);
  // Only this explicit test fixture copies source to both stems. This byte
  // equality is a complete-duration plumbing assertion, not AI quality evidence.
  expect((await readFile((await backing.path())!)).equals(tone(60))).toBe(true);

  const [video] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }),
    page.getByRole('button', { name: 'Export karaoke MP4', exact: true }).click()]);
  const videoPath = (await video.path())!;
  const probe = await runFile('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', videoPath],
    { timeout: 30000, maxBuffer: 1024 * 1024 });
  const metadata = JSON.parse(probe.stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; nb_read_frames?: string }[];
    format: { duration: string };
  };
  const visual = metadata.streams.find(stream => stream.codec_type === 'video')!;
  expect(visual).toMatchObject({ codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '24/1', nb_read_frames: '1440' });
  expect(metadata.streams.find(stream => stream.codec_type === 'audio')!.codec_name).toBe('aac');
  expect(Math.abs(Number(metadata.format.duration) - 60)).toBeLessThanOrEqual(1 / 24);

  // Independently decode actual frames immediately before/inside/after each
  // saved half-open cue and the last frame. No production render helper supplies
  // expected cards: active lyrics have warm glyphs, instrumental gaps white.
  const frames = [713, 714, 725, 726, 1391, 1392, 1427, 1428, 1439];
  const selection = frames.map(frame => `eq(n\\,${frame})`).join('+');
  const decoded = await runFile('ffmpeg', ['-v', 'error', '-threads', '1', '-i', videoPath, '-vf', `select=${selection}`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-threads', '1', 'pipe:1'],
    { encoding: 'buffer', timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  const frameBytes = 1280 * 720 * 3;
  expect(decoded.stdout.length).toBe(frames.length * frameBytes);
  const active = [false, true, true, false, false, true, true, false, false];
  for (let index = 0; index < frames.length; index++) {
    let warm = 0, white = 0;
    for (let y = 200; y < 440; y++) for (let x = 100; x < 1180; x++) {
      const offset = index * frameBytes + (y * 1280 + x) * 3;
      const [r, g, b] = decoded.stdout.subarray(offset, offset + 3);
      if (r > 160 && g > 110 && b < 175 && r > g + 15 && g > b + 20) warm++;
      if (r > 180 && g > 180 && b > 170) white++;
    }
    if (active[index]) expect(warm, `decoded active frame ${frames[index]}`).toBeGreaterThan(100);
    else {
      expect(warm, `decoded gap frame ${frames[index]}`).toBeLessThan(20);
      expect(white).toBeGreaterThan(100);
    }
  }
  const audio = await runFile('ffmpeg', ['-v', 'error', '-threads', '1', '-i', videoPath, '-vn', '-f', 's16le', '-ac', '2', '-ar', '44100', 'pipe:1'],
    { encoding: 'buffer', timeout: 30000, maxBuffer: 12 * 1024 * 1024 });
  expect(Math.abs(audio.stdout.length / (44100 * 4) - 60)).toBeLessThan(1024 / 44100);
  let lateEnergy = 0;
  for (let offset = 58 * 44100 * 4; offset < 59 * 44100 * 4; offset += 2) lateEnergy += audio.stdout.readInt16LE(offset) ** 2;
  expect(lateEnergy / (44100 * 2)).toBeGreaterThan(1000000);
  expect(errors).toEqual([]);
});

test('Unicode code-point limits accept complete emoji lyrics and reject an oversized paste without erasing history', async ({ page }) => {
  await importClip(page, 'unicode-fixture.wav');
  const title = '🎤'.repeat(100), line = '🎵'.repeat(240);
  await page.getByLabel('Clip title').fill(title);
  await page.getByLabel('Paste lyrics, one line per cue').fill(line);
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(line);
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save lyrics', exact: true }).click();
  await expect(page.locator('#message')).toContainText('saved locally');
  await page.reload();
  await expect(page.getByLabel('Clip title')).toHaveValue(title);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(line);
  const oversized = '🎵'.repeat(20001);
  await page.getByLabel('Paste lyrics, one line per cue').fill(oversized);
  await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
  await expect(page.locator('#message')).toHaveClass(/error/);
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue(oversized);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(line);
  await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click();
  await expect(page.getByLabel('Paste lyrics, one line per cue')).toHaveValue(line);
  await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(line);
  await expect(page.locator('#save-state')).toContainText('Saved');
});

for (const field of ['title', 'cue'] as const) {
  test(`a one-MiB invalid ${field} stays editable without unbounded canvas layout and Undo restores Unicode`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const probe = { largest: 0, oversized: 0 };
      Object.defineProperty(window, 'karaokeCanvasProbe', { value: probe });
      const original = CanvasRenderingContext2D.prototype.measureText;
      CanvasRenderingContext2D.prototype.measureText = function (text: string): TextMetrics {
        probe.largest = Math.max(probe.largest, text.length);
        if (text.length > 500) {
          probe.oversized++;
          throw new Error('Test stopped unbounded invalid-draft canvas layout');
        }
        return original.call(this, text);
      };
    });
    await importClip(page, `large-${field}-fixture.wav`);
    const title = '🎤'.repeat(100), line = '🎵'.repeat(240);
    await page.getByLabel('Clip title').fill(title);
    await page.getByLabel('Paste lyrics, one line per cue').fill(line);
    await page.getByRole('button', { name: 'Create draft timings', exact: true }).click();
    await page.locator('audio').evaluate(element => { (element as HTMLAudioElement).currentTime = 0.5; });
    await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '0');
    const target = field === 'title' ? page.getByLabel('Clip title') : page.getByLabel('Lyric line 1', { exact: true });
    const oversized = 'W'.repeat(1024 * 1024);
    await target.fill(oversized);
    await expect(target).toHaveValue(oversized);
    const measurements = await page.evaluate(() => (window as unknown as {
      karaokeCanvasProbe: { largest: number; oversized: number };
    }).karaokeCanvasProbe);
    expect(measurements.oversized).toBe(0);
    expect(measurements.largest).toBeLessThanOrEqual(500);
    await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '-1');
    await expect(page.locator('#current-line')).toContainText('Preview paused');
    await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Undo lyric edit', exact: true }).click({ timeout: 5000 });
    await expect(page.getByLabel('Clip title')).toHaveValue(title);
    await expect(page.getByLabel('Lyric line 1', { exact: true })).toHaveValue(line);
    await expect(page.getByRole('button', { name: 'Save lyrics', exact: true })).toBeEnabled();
    await expect(page.locator('#stage')).toHaveAttribute('data-active-cue', '0');
    expect(errors).toEqual([]);
  });
}
