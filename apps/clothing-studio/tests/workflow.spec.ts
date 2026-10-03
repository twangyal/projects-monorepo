import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Export project backup' }).click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

async function photoBytes(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 400;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#aacbd0'; context.fillRect(0, 0, 300, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(encoded, 'base64');
}

test('creates a distinct concept, sketches, places it, restores locally and round-trips a backup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Clothing Studio' })).toBeVisible();
  await page.getByLabel('Concept name').fill('Weekend sketch');
  await page.getByLabel('Concept note').fill('A relaxed blue tee with a hand-drawn detail.');
  await page.getByRole('button', { name: 'Ink blue' }).click();
  await page.getByLabel('Fabric appearance').selectOption('stripe');
  const sketch = page.getByRole('img', { name: 'Garment sketch canvas', exact: true });
  const box = (await sketch.boundingBox())!;
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .58, box.y + box.height * .56, { steps: 10 });
  await page.mouse.up();
  await page.getByLabel('Upload body photo').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: await photoBytes(page) });
  await expect(page.locator('#photo-name')).toHaveText('sample.png');
  await page.getByLabel('Rotation').fill('12');
  await page.getByLabel('Rotation').press('Tab');
  await page.getByRole('group', { name: 'Photo overlay placement', exact: true }).press('ArrowRight');
  await expect(page.getByText('Locally saved', { exact: true })).toBeVisible();
  const saved = await backup(page);
  expect(saved.title).toBe('Weekend sketch');
  expect(saved.strokes).toHaveLength(1);
  expect(saved.garment.pattern).toBe('stripe');
  expect(saved.placement.rotation).toBe(12);
  expect(saved.placement.x).toBeGreaterThan(.5);
  expect(saved.photo.width).toBe(300);
  await page.reload();
  await expect(page.getByLabel('Concept name')).toHaveValue('Weekend sketch');
  expect(await backup(page)).toEqual(saved);
  await page.getByRole('button', { name: 'New concept', exact: true }).click();
  await expect(page.getByLabel('Concept name')).not.toHaveValue('Weekend sketch');
  await page.getByLabel('Import project backup').setInputFiles({ name: 'concept.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.getByLabel('Concept name')).toHaveValue('Weekend sketch');
  expect(await backup(page)).toEqual(saved);
});

test('invalid files preserve current work and undo/redo restores geometry edits', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Concept name').fill('Keep this concept');
  await page.getByLabel('Concept name').press('Tab');
  const original = await backup(page);
  await page.getByLabel('Body width').focus();
  await page.getByLabel('Body width').press('End');
  const changed = await backup(page);
  expect(changed.garment.bodyWidth).not.toBe(original.garment.bodyWidth);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).garment.bodyWidth).toBe(original.garment.bodyWidth);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect((await backup(page)).garment.bodyWidth).toBe(changed.garment.bodyWidth);
  await page.getByLabel('Import project backup').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99}') });
  await expect(page.getByRole('status').filter({ hasText: /could not|invalid|unsupported|schema/i })).toBeVisible();
  await page.getByLabel('Upload body photo').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') });
  await expect(page.getByRole('status').filter({ hasText: /could not|invalid|unsupported|image/i })).toBeVisible();
  expect(await backup(page)).toEqual(changed);
});

test('exports transparent garment and opaque preview PNGs', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ink blue' }).click();
  await page.getByLabel('Upload body photo').setInputFiles({ name: 'export-photo.png', mimeType: 'image/png', buffer: await photoBytes(page) });
  await expect(page.locator('#photo-name')).toHaveText('export-photo.png');
  for (const [name, transparent] of [['Export garment PNG', true], ['Export preview PNG', false]] as const) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
    const bytes = await readFile((await download.path())!);
    const result = await page.evaluate(async (base64) => {
      const blob = new Blob([Uint8Array.from(atob(base64), character => character.charCodeAt(0))], { type: 'image/png' });
      const image = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      const corner = [...context.getImageData(0, 0, 1, 1).data];
      const center = [...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data];
      image.close(); return { corner, center, width: canvas.width, height: canvas.height };
    }, bytes.toString('base64'));
    expect(result.width).toBeGreaterThan(100);
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
    expect(result.corner[3]).toBe(transparent ? 0 : 255);
    if (transparent) expect(result.center).toEqual([63, 84, 104, 255]);
    else {
      expect([result.width, result.height]).toEqual([300, 400]);
      for (const [channel, expected] of [170, 203, 208].entries()) expect(Math.abs(result.corner[channel] - expected)).toBeLessThanOrEqual(3);
    }
  }
});

test('works on a narrow screen without external requests or page errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4186/')) external.push(request.url()); });
  await page.goto('/');
  await expect(page.getByText('Approximate photo overlay', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ink blue' }).click();
  await expect(page.getByRole('button', { name: 'Export preview PNG' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
