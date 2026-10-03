import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { Project } from '../src/model.ts';

interface MediaTestWindow extends Window {
  __photoReads: Map<string, () => void>;
  __photoDecodeCompleted: string[];
  __photoDecodeCount: number;
}

async function backup(page: Page): Promise<Project> {
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Export project backup', exact: true }).click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8')) as Project;
}

async function photoBytes(page: Page, width = 240, height = 320): Promise<Buffer> {
  const base64 = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b4a0d0'; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height });
  return Buffer.from(base64, 'base64');
}

async function observePhotoDecoding(page: Page, delayReads = false): Promise<void> {
  await page.addInitScript(({ delayReads }) => {
    const observed = window as unknown as MediaTestWindow;
    observed.__photoReads = new Map();
    observed.__photoDecodeCompleted = [];
    observed.__photoDecodeCount = 0;
    const originalRead = File.prototype.arrayBuffer;
    if (delayReads) {
      File.prototype.arrayBuffer = function(this: File) {
        if (!this.name.startsWith('slow-')) return originalRead.call(this);
        return new Promise<ArrayBuffer>((resolve, reject) => {
          observed.__photoReads.set(this.name, () => {
            observed.__photoReads.delete(this.name);
            void originalRead.call(this).then(resolve, reject);
          });
        });
      };
    }
    const originalDecode = window.createImageBitmap.bind(window) as (source: ImageBitmapSource, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
    window.createImageBitmap = (async (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
      observed.__photoDecodeCount += 1;
      const bitmap = await originalDecode(source, options);
      if (source instanceof File) observed.__photoDecodeCompleted.push(source.name);
      return bitmap;
    }) as typeof window.createImageBitmap;
  }, { delayReads });
}

async function awaitDelayedRead(page: Page, name: string): Promise<void> {
  await expect.poll(() => page.evaluate(name => {
    return (window as unknown as MediaTestWindow).__photoReads.has(name);
  }, name)).toBe(true);
}

async function releaseDelayedRead(page: Page, name: string): Promise<void> {
  await page.evaluate(name => {
    const release = (window as unknown as MediaTestWindow).__photoReads.get(name);
    if (!release) throw new Error('No delayed photo read exists.');
    release();
  }, name);
  await expect.poll(() => page.evaluate(name => {
    return (window as unknown as MediaTestWindow).__photoDecodeCompleted.includes(name);
  }, name)).toBe(true);
}

test('oversized PNG dimensions are rejected before decoding and preserve the current concept', async ({ page }) => {
  await observePhotoDecoding(page);
  await page.goto('/');
  await page.getByLabel('Concept name', { exact: true }).fill('Keep my original');
  await page.getByLabel('Concept name', { exact: true }).press('Tab');
  const prior = await backup(page);
  const bytes = Buffer.alloc(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12);
  bytes.writeUInt32BE(8001, 16); bytes.writeUInt32BE(1, 20);
  bytes.set([8, 6, 0, 0, 0], 24); bytes.write('IEND', 37);
  await page.getByLabel('Upload body photo', { exact: true }).setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: bytes });
  await expect(page.locator('#message')).toContainText('8000');
  expect(await page.evaluate(() => (window as unknown as MediaTestWindow).__photoDecodeCount)).toBe(0);
  expect(await backup(page)).toEqual(prior);
});

test('a backup with conflicting encoded JPEG dimensions cannot replace the current project', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Upload body photo', { exact: true }).setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: await photoBytes(page) });
  await expect(page.locator('#photo-name')).toHaveText('original.png');
  await page.getByLabel('Concept name', { exact: true }).fill('Keep the real photo');
  await page.getByLabel('Concept name', { exact: true }).press('Tab');
  const prior = await backup(page);
  const invalid = structuredClone(prior);
  invalid.title = 'Incorrect backup';
  invalid.photo!.width += 1;
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'mismatched.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#message')).toContainText(/dimensions.*metadata/i);
  await expect(page.getByLabel('Concept name', { exact: true })).toHaveValue('Keep the real photo');
  expect(await backup(page)).toEqual(prior);
});

test('cancelling a delayed photo import prevents its eventual decode from replacing current work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await observePhotoDecoding(page, true);
  await page.goto('/');
  await page.getByLabel('Concept name', { exact: true }).fill('Keep this while importing');
  await page.getByLabel('Concept name', { exact: true }).press('Tab');
  const prior = await backup(page);
  await page.getByLabel('Upload body photo', { exact: true }).setInputFiles({ name: 'slow-cancelled.png', mimeType: 'image/png', buffer: await photoBytes(page) });
  await awaitDelayedRead(page, 'slow-cancelled.png');
  await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Import cancelled');
  await releaseDelayedRead(page, 'slow-cancelled.png');
  await expect(page.locator('#load-state')).toBeHidden();
  await expect(page.locator('#photo-name')).toHaveText('Sample silhouette');
  await expect(page.locator('#message')).toContainText('Import cancelled');
  expect(await backup(page)).toEqual(prior);
  expect(errors).toEqual([]);
});

test('a newer photo selection wins when an earlier import resolves later', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await observePhotoDecoding(page, true);
  await page.goto('/');
  await page.getByLabel('Upload body photo', { exact: true }).setInputFiles({ name: 'slow-first.png', mimeType: 'image/png', buffer: await photoBytes(page, 200, 300) });
  await awaitDelayedRead(page, 'slow-first.png');
  await page.getByLabel('Upload body photo', { exact: true }).setInputFiles({ name: 'newer.png', mimeType: 'image/png', buffer: await photoBytes(page, 360, 180) });
  await expect(page.locator('#photo-name')).toHaveText('newer.png');
  const newer = await backup(page);
  await releaseDelayedRead(page, 'slow-first.png');
  await expect(page.locator('#photo-name')).toHaveText('newer.png');
  await expect(page.locator('#load-state')).toBeHidden();
  expect(await backup(page)).toEqual(newer);
  expect(newer.photo?.width).toBe(360);
  expect(newer.photo?.height).toBe(180);
  expect(errors).toEqual([]);
});

test('unavailable IndexedDB reports unsaved edits while project backup remains usable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(page.locator('#save-state')).toHaveText('Local restore unavailable');
  await page.getByLabel('Concept name', { exact: true }).fill('Safe despite blocked storage');
  await page.getByLabel('Concept name', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Ink blue', exact: true }).click();
  await expect(page.locator('#save-state')).toHaveText('Not saved locally');
  await expect(page.locator('#message')).toContainText('Your active concept is intact');
  await expect(page.getByLabel('Concept name', { exact: true })).toHaveValue('Safe despite blocked storage');
  const saved = await backup(page);
  expect(saved.title).toBe('Safe despite blocked storage');
  expect(saved.garment.color).toBe('#3f5468');
  expect(errors).toEqual([]);
});
