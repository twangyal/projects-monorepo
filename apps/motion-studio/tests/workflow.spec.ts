import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { parseGIF, decompressFrames } from 'gifuct-js';

async function blank(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Motion Studio', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.locator('#project-title')).toHaveValue('Untitled motion');
  await expect(page.locator('#stage')).toHaveAttribute('aria-disabled', 'false');
}
async function scrub(page: Page, frame: number) {
  await page.locator('#frame').evaluate((input, value) => { (input as HTMLInputElement).value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, frame);
  await expect(page.locator('#stage')).toHaveAttribute('data-frame', String(frame));
}
async function stroke(page: Page) {
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.move(box.x + box.width * .25, box.y + box.height * .45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .55, { steps: 12 });
  await page.mouse.up();
}
async function backup(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#backup').click()]);
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

test('draw, pose, undo, preview, persist and download a real animated GIF, PNG and editable project', async ({ page }) => {
  await blank(page);
  await page.locator('#duration').selectOption('12');
  await page.locator('#project-title').fill('Little moving line');
  await stroke(page);
  const first = await page.locator('#stage').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await scrub(page, 11);
  await page.getByLabel('Position X', { exact: true }).fill('440');
  await page.getByLabel('Position X', { exact: true }).press('Tab');
  await expect(page.getByRole('button', { name: 'Keyframe at frame 12', exact: true })).toBeVisible();
  const last = await page.locator('#stage').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  expect(last).not.toBe(first);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Position X', { exact: true })).toHaveValue('320');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Position X', { exact: true })).toHaveValue('440');
  await scrub(page, 5);
  expect(Number(await page.getByLabel('Position X', { exact: true }).inputValue())).toBeGreaterThan(320);
  expect(Number(await page.getByLabel('Position X', { exact: true }).inputValue())).toBeLessThan(440);
  const editable = await backup(page);
  expect(editable.layers[0].cels[0].strokes).toHaveLength(1);
  expect(editable.layers[0].keys.map((key: { frame: number }) => key.frame)).toEqual([0, 11]);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser');
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Little moving line');
  expect(await backup(page)).toEqual(editable);
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save frame PNG', exact: true }).click()]);
  const pngBytes = await readFile((await png.path())!);
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');
  expect(pngBytes.readUInt32BE(16)).toBe(640); expect(pngBytes.readUInt32BE(20)).toBe(360);
  const [gif] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export animation ↓', exact: true }).click()]);
  const bytes = await readFile((await gif.path())!);
  const parsed = parseGIF(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const frames = decompressFrames(parsed, true);
  expect(frames).toHaveLength(12);
  expect(frames.reduce((total, item) => total + item.delay, 0)).toBe(1000);
  expect(frames[0].dims.width).toBe(640); expect(frames[0].dims.height).toBe(360);
  expect(Buffer.from(frames[0].patch!).equals(Buffer.from(frames[11].patch!))).toBe(false);
  await expect(page.locator('#message')).toContainText('animated GIF is ready');
});

test('invalid project and SVG imports preserve artwork, then a valid backup reopens atomically', async ({ page }) => {
  await blank(page); await stroke(page);
  await page.locator('#project-title').fill('Keep this drawing');
  const saved = await backup(page);
  await page.getByLabel('Open project file', { exact: true }).setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...saved, frameCount: 500 })) });
  await expect(page.locator('#message')).toContainText('unchanged');
  expect(await backup(page)).toEqual(saved);
  await page.getByLabel('Import artwork image', { exact: true }).setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await expect(page.locator('#message')).toContainText('unchanged');
  expect(await backup(page)).toEqual(saved);
  await page.locator('#project-title').fill('Temporary title');
  await page.getByLabel('Open project file', { exact: true }).setInputFiles({ name: 'saved.motion.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.locator('#message')).toContainText('Project opened');
  expect(await backup(page)).toEqual(saved);
});

test('pointer cancellation leaves no partial stroke and layers can be reordered and restored', async ({ page }) => {
  await blank(page);
  const box = (await page.locator('#stage').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 100, box.y + 80);
  await page.locator('#stage').dispatchEvent('pointercancel', { pointerId: 1 }); await page.mouse.up();
  expect((await backup(page)).layers[0].cels[0].strokes).toHaveLength(0);
  await page.getByRole('button', { name: '+ Drawing layer', exact: true }).click();
  await page.getByLabel('Layer name', { exact: true }).fill('Second layer');
  await page.getByRole('button', { name: 'Lower', exact: true }).click();
  expect((await backup(page)).layers[0].name).toBe('Second layer');
  await page.getByRole('button', { name: 'Delete layer', exact: true }).click();
  expect((await backup(page)).layers).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).layers).toHaveLength(2);
});

test('narrow layout supports editing without horizontal overflow, page errors or external requests', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4210/')) external.push(request.url()); });
  await blank(page); await stroke(page);
  await page.getByLabel('Position X', { exact: true }).fill('400'); await page.getByLabel('Position X', { exact: true }).press('Tab');
  await expect(page.getByLabel('Position X', { exact: true })).toHaveValue('400');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});
