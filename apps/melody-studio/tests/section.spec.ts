import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installAudioProbe, audioProbe, controlProbe } from './browser/continuation-fixtures.ts';

test('section WAV is an exact crop of the ordinary rendered mix at fractional tempo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  page.on('dialog', dialog => dialog.accept());
  const project = { version: 1, title: 'Limiter boundary', tempo: 137, tracks: Array.from({length: 8}, (_, i) => ({id: `track-${i}`, name: `Part ${i}`, instrument: 'sine', volume: 1, muted: false, notes: [{id: `note-${i}`, pitch: 69, start: i === 0 ? 0 : 6, duration: i === 0 ? 4 : 1, velocity: 1}]})) };
  // Seven loud overlapping parts outside the crop trigger full-song limiting.
  // The sustained first part crosses the crop start and must not be retriggered.
  await page.getByLabel('Open project file').setInputFiles({name: 'limiter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project))});
  await expect(page.locator('#notice')).toContainText('Project opened');
  const downloadBytes = async (name: string) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await pending;
    return { bytes: await readFile((await download.path())!), name: download.suggestedFilename() };
  };
  const full = await downloadBytes('Export WAV');
  await page.getByLabel('Section start beat').fill('2.25');
  await page.getByLabel('Section end beat (exclusive)').fill('5.5');
  const section = await downloadBytes('Export section WAV');
  const first = Math.round(1.25 * 60 / 137 * 22050), last = Math.round(4.5 * 60 / 137 * 22050);
  expect(section.name).toMatch(/-section\.wav$/);
  expect(section.bytes.readUInt32LE(24)).toBe(22050);
  expect(section.bytes.readUInt32LE(40)).toBe((last - first) * 2);
  expect(section.bytes.subarray(44)).toEqual(full.bytes.subarray(44 + first * 2, 44 + last * 2));
  let cropPeak = 0;
  for (let i = 44; i < section.bytes.length; i += 2) cropPeak = Math.max(cropPeak, Math.abs(section.bytes.readInt16LE(i)));
  expect(cropPeak).toBeGreaterThan(4000);
  expect(cropPeak).toBeLessThan(5000); // Whole-song 0.95 limiter scales the quieter solo section.
  await expect(page.getByLabel('Tempo (BPM)')).toHaveValue('137');
});

test('native loop repeats past the section duration and changing bounds stops it', async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioContext.prototype.createBufferSource;
    const records: { loop: boolean; frames: number; stopped: boolean }[] = [];
    Object.assign(window, { sectionSources: records });
    AudioContext.prototype.createBufferSource = function () {
      const node = original.call(this), start = node.start.bind(node), stop = node.stop.bind(node);
      node.start = (...args: Parameters<typeof node.start>) => { records.push({ loop: node.loop, frames: node.buffer?.length ?? 0, stopped: false }); start(...args); };
      node.stop = (...args: Parameters<typeof node.stop>) => { records.at(-1)!.stopped = true; stop(...args); };
      return node;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.getByLabel('Section start beat').fill('2');
  await page.getByLabel('Section end beat (exclusive)').fill('2.25');
  await page.getByRole('button', { name: 'Loop section', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Looping section');
  await page.waitForTimeout(700); // Longer than several 0.139-second loops.
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { sectionSources: unknown[] }).sectionSources)).toEqual([{ loop: true, frames: Math.round(1.25 * 60 / 108 * 22050) - Math.round(60 / 108 * 22050), stopped: false }]);
  await page.getByLabel('Section end beat (exclusive)').fill('3');
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Loop section', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { sectionSources: {stopped:boolean}[] }).sectionSources[0].stopped)).toBe(true);
  await page.getByRole('button', { name: 'Play section', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Playing section');
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeDisabled({ timeout: 5000 });
  await page.getByRole('button', { name: 'Play composition' }).click();
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop playback' }).click();
});

test('invalid bounds survive redraw, do not alter project, and remain session-only', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  const downloadProject = async () => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save project file' }).click();
    return await readFile((await (await pending).path())!);
  };
  const before = await downloadProject();
  await page.getByLabel('Section start beat').fill('bad range');
  await page.getByLabel('Section end beat (exclusive)').fill('');
  await page.getByRole('button', { name: 'Play section', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Enter both section beat bounds');
  await page.getByRole('button', { name: 'Export section WAV' }).click();
  await expect(page.getByLabel('Section start beat')).toHaveValue('bad range');
  expect(await downloadProject()).toEqual(before);
  await expect(page.getByLabel('Section start beat')).toHaveValue('bad range');
  await page.reload();
  await expect(page.getByLabel('Section start beat')).toHaveValue('1');
  await expect(page.getByLabel('Section end beat (exclusive)')).toHaveValue('5');
});

test('changing bounds retires a pending native resume and late completion cannot start audio', async ({ page }) => {
  await page.addInitScript(() => {
    const resume = AudioContext.prototype.resume;
    let release: (() => void) | undefined;
    let starts = 0;
    Object.assign(window, { sectionResume: { release: () => release?.(), starts: () => starts } });
    AudioContext.prototype.resume = function () {
      return new Promise<void>(resolve => { release = () => { void resume.call(this).then(resolve); }; });
    };
    const original = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const node = original.call(this), start = node.start.bind(node);
      node.start = (...args: Parameters<typeof node.start>) => { starts++; start(...args); };
      return node;
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  await page.getByRole('button', { name: 'Loop section', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('Rendering');
  await page.getByLabel('Section start beat').fill('2');
  await expect(page.getByRole('button', { name: 'Play section', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { sectionResume: {release():void} }).sectionResume.release());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { sectionResume: {starts():number} }).sectionResume.starts())).toBe(0);
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeDisabled();
  await expect(page.getByLabel('Section start beat')).toHaveValue('2');
});

test('Stop retires a held section worker reply without cancelling fresh playback', async ({ page }) => {
  await installAudioProbe(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Load example' }).click();
  await controlProbe(page, 'holdReplies');
  await page.getByRole('button', { name: 'Loop section', exact: true }).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(1);
  await page.getByRole('button', { name: 'Stop playback' }).click();
  await page.getByRole('button', { name: 'Play composition' }).click();
  await expect.poll(async () => (await audioProbe(page)).pendingReplies).toBe(2);
  await controlProbe(page, 'releaseNext');
  expect((await audioProbe(page)).starts).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Stop playback' })).toBeEnabled();
  await controlProbe(page, 'releaseNext');
  await expect.poll(async () => (await audioProbe(page)).starts.length).toBe(1);
  await expect(page.locator('#notice')).toContainText('Playing your composition');
  await page.getByRole('button', { name: 'Stop playback' }).click();
});
