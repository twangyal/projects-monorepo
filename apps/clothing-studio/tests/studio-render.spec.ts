import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import { template } from '../src/product.ts';

async function backup(page: Page) {
  const waiting = page.waitForEvent('download'); await page.locator('#backup').click();
  return JSON.parse((await readFile((await (await waiting).path())!)).toString());
}
async function studio(page: Page, view: string, backdrop: string) {
  await page.getByLabel('Studio view').selectOption(view);
  await page.getByLabel('Backdrop').selectOption(backdrop);
  const waiting = page.waitForEvent('download', { timeout: 120000 });
  await page.getByRole('button', { name: 'Export studio render (PNG) ↓', exact: true }).click();
  const file = await waiting;
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}
/** A PNG's size, top-left pixel, share of opaque pixels, and its red pixels with their spread of brightness. */
async function pixels(page: Page, bytes: Buffer) {
  return page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data, levels: number[] = [];
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 250) opaque++;
      if (data[i + 3]! > 250 && data[i]! > data[i + 1]! * 1.6 && data[i]! > data[i + 2]! * 1.6) levels.push(data[i]!);
    }
    levels.sort((a, b) => a - b);
    const at = (share: number) => levels[Math.floor((levels.length - 1) * share)] ?? 0;
    return { width: canvas.width, height: canvas.height, corner: Array.from(data.slice(0, 4)), opaque: opaque / (data.length / 4), red: levels.length, spread: at(0.95) - at(0.05) };
  }, bytes.toString('base64'));
}

test('a studio render photographs the garment from the chosen view on the chosen backdrop', async ({ page }) => {
  test.setTimeout(300000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // A red tee, so its pixels can be told from the backdrop.
  const design = await backup(page), tee = template('blank');
  for (const style of Object.values(tee.parts)) style.color = '#c81e1e';
  design.product = tee;
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'red.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) });
  await expect(page.getByLabel('Studio view')).toHaveValue('front');
  await expect(page.getByLabel('Backdrop')).toHaveValue('studio');
  await expect(page.getByRole('group', { name: 'Studio render' })).toContainText('1600 × 2000 px');

  const front = await studio(page, 'front', 'studio');
  expect(front.name).toMatch(/-studio-front\.png$/);
  const shot = await pixels(page, front.bytes);
  expect([shot.width, shot.height]).toEqual([1600, 2000]);
  expect(shot.opaque).toBe(1);
  // The warm paper backdrop, darker in the corners than behind the garment.
  const [r, g, b] = shot.corner;
  expect(r! > g! && g! > b! && b! > 180 && r! < 240).toBe(true);
  expect(shot.red).toBeGreaterThan(200000);
  // Lit and shaded, not one flat red.
  expect(shot.spread).toBeGreaterThan(40);
  await expect(page.locator('#message')).toHaveText('Studio render downloaded: front view on a warm studio backdrop.');

  const turned = await studio(page, 'three-quarter', 'transparent');
  expect(turned.name).toMatch(/-studio-three-quarter\.png$/);
  const clear = await pixels(page, turned.bytes);
  expect([clear.width, clear.height]).toEqual([1600, 2000]);
  expect(clear.corner[3]).toBe(0);
  expect(clear.opaque).toBeLessThan(0.6);
  expect(clear.red).toBeGreaterThan(150000);
  await expect(page.locator('#message')).toHaveText('Studio render downloaded: three-quarter view on a transparent backdrop.');

  const white = await pixels(page, (await studio(page, 'back', 'white')).bytes);
  expect(white.corner).toEqual([255, 255, 255, 255]);
  expect(white.red).toBeGreaterThan(200000);
  expect(errors).toEqual([]);
});
