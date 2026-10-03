import { test, expect, type Page } from '@playwright/test';

interface RestoreWindow extends Window {
  __releaseRestore: () => void;
  __restoreWaiting: boolean;
  __restoreDecoded: boolean;
}

async function portrait(page: Page, width = 600, height = 1200) {
  const image = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!; context.fillStyle = '#c9bbad'; context.fillRect(0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { width, height });
  await page.getByLabel('Upload body photo').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('#photo-name')).toHaveText('portrait.png');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
}

async function delayRestore(page: Page) {
  await page.addInitScript(() => {
    const observed = window as unknown as RestoreWindow;
    const original = createImageBitmap.bind(window) as (image: ImageBitmapSource) => Promise<ImageBitmap>;
    let first = true;
    window.createImageBitmap = (async (image: ImageBitmapSource) => {
      if (!first) return original(image);
      first = false; observed.__restoreWaiting = true;
      await new Promise<void>(resolve => { observed.__releaseRestore = resolve; });
      const bitmap = await original(image); observed.__restoreDecoded = true; return bitmap;
    }) as typeof createImageBitmap;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as unknown as RestoreWindow).__restoreWaiting)).toBe(true);
}

async function finishRestore(page: Page) {
  await page.evaluate(() => (window as unknown as RestoreWindow).__releaseRestore());
  await expect.poll(() => page.evaluate(() => (window as unknown as RestoreWindow).__restoreDecoded)).toBe(true);
}

test('a slow startup restore cannot overwrite text typed before blur', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Concept name').fill('Previously saved');
  await page.getByLabel('Concept name').press('Tab');
  await portrait(page);
  await delayRestore(page);
  await page.getByLabel('Concept name').fill('My typing in progress');
  await finishRestore(page);
  await expect(page.getByLabel('Concept name')).toHaveValue('My typing in progress');
  await page.getByLabel('Concept name').press('Tab');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
});

test('a slow startup restore cannot replace an active sketch gesture', async ({ page }) => {
  await page.goto('/'); await portrait(page); await delayRestore(page);
  const bounds = (await page.locator('#sketch-surface').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .45, bounds.y + bounds.height * .5);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .5, { steps: 5 });
  await finishRestore(page);
  await page.mouse.up();
  await expect(page.locator('#stroke-count')).toHaveText('1 stroke');
  await expect(page.locator('#photo-name')).toHaveText('Sample silhouette');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
});

test('tall portrait previews remain entirely visible at large desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/'); await portrait(page);
  const bounds = await page.locator('#preview-surface').evaluate(node => {
    const surface = node.getBoundingClientRect(), frame = node.parentElement!.getBoundingClientRect();
    return { surfaceHeight: surface.height, frameHeight: frame.height, bottom: surface.bottom, frameBottom: frame.bottom, ratio: surface.width / surface.height };
  });
  expect(bounds.surfaceHeight).toBeLessThanOrEqual(630);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.frameBottom);
  expect(bounds.ratio).toBeCloseTo(.5, 2);
});
