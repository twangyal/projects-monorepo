import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createProject, serializeProject, MAX_PROJECT_BYTES } from '../src/model.ts';
import { pngUrl } from './helpers/raster.ts';
import { template } from '../src/product.ts';

const copyName = 'Replace 3D product with this concept tee';
async function backup(page: Page) {
  const opened = await page.getByRole('dialog', { name: 'Concept sketch', exact: true }).isVisible();
  if (opened) await page.keyboard.press('Escape');
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  const value = JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
  if (opened) await openConcept(page);
  return value;
}
async function openConcept(page: Page) {
  await page.getByRole('button', { name: 'Concept sketch', exact: true }).click();
  return page.getByRole('dialog', { name: 'Concept sketch', exact: true });
}
async function draw(page: Page, selector: string, x1: number, y1: number, x2: number, y2: number) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1); await page.mouse.down();
  await page.mouse.move(box.x + box.width * x2, box.y + box.height * y2, { steps: 5 }); await page.mouse.up();
}
for (const width of [1280, 390]) test(`concept tee enters product styling with transparent body artwork and complete Undo at ${width}px`, async ({ page }) => {
  test.setTimeout(90000); await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  const dialog = await openConcept(page);
  await dialog.getByLabel('Concept name', { exact: true }).fill('River tee');
  await dialog.getByLabel('Custom garment color', { exact: true }).fill('#123456');
  await dialog.locator('#neckline').selectOption('v');
  await dialog.locator('#pattern').selectOption('stripe');
  await dialog.locator('#pen-color').fill('#ff0000');
  await draw(page, '#sketch-surface', .45, .45, .55, .55);
  await dialog.getByLabel('Product chest from concept (cm)', { exact: true }).fill('104');
  await expect(dialog.locator('#concept-product-summary')).toContainText('65.3 cm');
  const before = await backup(page);
  await dialog.getByRole('button', { name: copyName, exact: true }).click();
  await expect(dialog.locator('#message')).toContainText('Copied concept tee');
  const after = await backup(page);
  expect(after.product.name).toBe('River tee'); expect(after.product.neckline).toBe('v');
  expect(after.product.measurements).toEqual({ chest: 104, length: 65.3, sleeve: 14.5 });
  expect(after.product.parts.front.color).toBe('#123456'); expect(after.product.parts.front.print.motif).toBe('stripe');
  expect(after.strokes).toEqual(before.strokes); expect(after.garment).toEqual(before.garment); expect(after.placement).toEqual(before.placement);
  expect(after.product.artwork).toHaveLength(1);
  const bitmap = await page.evaluate(async (art) => {
    const image = new Image(); await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Unreadable copied artwork')); image.src = art.dataUrl; }); const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let red = 0, transparent = 0, other = 0;
    for (let i = 0; i < data.length; i += 4) { if (!data[i + 3]) transparent++; else if (data[i] > 200 && data[i + 1] < 40 && data[i + 2] < 40) red++; else other++; }
    return { red, transparent, other };
  }, after.product.artwork[0]);
  expect(bitmap.red).toBeGreaterThan(50); expect(bitmap.transparent).toBeGreaterThan(1000); expect(bitmap.other).toBe(0);
  await dialog.getByRole('button', { name: 'Back to garment', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); expect(await backup(page)).toEqual(after);
  await expect(page.locator('#save-state')).toContainText('Locally saved'); await page.reload(); expect(await backup(page)).toEqual(after);
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  const pending = page.waitForEvent('download'); await page.locator('#pattern-svg').click(); const svg = await readFile((await (await pending).path())!, 'utf8');
  expect(svg).toContain('River tee'); expect(svg).toContain('data-piece="front"');
  await page.getByRole('button', { name: 'Back to garment', exact: true }).click(); await page.getByRole('button', { name: 'Exports', exact: true }).click();
  const model = page.waitForEvent('download'); await page.locator('#product-glb').click(); expect((await readFile((await (await model).path())!)).subarray(0, 4).toString()).toBe('glTF');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('blank/invalid chest and pending product or raw source drafts preserve all work', async ({ page }) => {
  await page.goto('/'); let dialog = await openConcept(page); const before = await backup(page);
  await dialog.getByLabel('Product chest from concept (cm)', { exact: true }).fill('');
  await dialog.getByRole('button', { name: copyName, exact: true }).click(); await expect(dialog.locator('#message')).toContainText('chest'); expect(await backup(page)).toEqual(before);
  await dialog.getByLabel('Product chest from concept (cm)', { exact: true }).fill('104');
  await dialog.locator('#position-x').fill(''); await dialog.getByRole('button', { name: copyName, exact: true }).click();
  await expect(dialog.locator('#position-x')).toHaveValue(''); await expect(dialog.locator('#message')).toContainText('raw concept fields'); expect(await backup(page)).toEqual(before);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await page.getByLabel('Body length (cm)', { exact: true }).fill(''); dialog = await openConcept(page);
  await dialog.getByRole('button', { name: copyName, exact: true }).click(); await expect(dialog.locator('#message')).toContainText('pending product edits');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await expect(page.getByLabel('Body length (cm)', { exact: true })).toHaveValue(''); expect(await backup(page)).toEqual(before);
});

test('sleeve-only marks and an explicit artwork opt-out stay in the source without a copied graphic', async ({ page }) => {
  await page.goto('/'); const dialog = await openConcept(page);
  await draw(page, '#sketch-surface', .85, .30, .86, .31);
  const sleeve = await backup(page); expect(sleeve.strokes.length).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: copyName, exact: true }).click();
  await expect(dialog.locator('#message')).toContainText('No body artwork copied');
  let copied = await backup(page); expect(copied.product.artwork).toEqual([]); expect(copied.strokes).toEqual(sleeve.strokes);
  await draw(page, '#sketch-surface', .45, .45, .55, .55);
  await dialog.getByLabel('Use body sketch marks as front artwork', { exact: true }).uncheck();
  const source = await backup(page); await dialog.getByRole('button', { name: copyName, exact: true }).click();
  copied = await backup(page); expect(copied.product.artwork).toEqual([]); expect(copied.strokes).toEqual(source.strokes);
});
test('replacement names incompatible outfit removal and preserves source and body when accepted or undone', async ({ page }) => {
  await page.goto('/');
  const source = { ...createProject(), title: 'Outfit concept', product: template('hoodie'), wornWith: template('blank'), wornAlso: template('trousers'), topBody: { chest: 92, waist: 76, hip: 98, chestDepth: null } };
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'outfit.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(page.locator('#message')).toContainText('Project backup restored');
  const before = await backup(page), dialog = await openConcept(page); let question = '';
  page.once('dialog', async prompt => { question = prompt.message(); await prompt.dismiss(); });
  await dialog.getByRole('button', { name: copyName, exact: true }).click();
  expect(question).toContain('Blank tee'); expect(question).not.toContain('Straight trousers'); expect(await backup(page)).toEqual(before);
  page.once('dialog', async prompt => { await prompt.accept(); }); await dialog.getByRole('button', { name: copyName, exact: true }).click();
  const after = await backup(page); expect(after.product.base).toBe('tee'); expect(after.wornWith).toEqual(before.wornAlso); expect(after.wornAlso).toBeUndefined();
  expect(after.topBody).toEqual(before.topBody); expect(after.garment).toEqual(before.garment); expect(after.photo).toEqual(before.photo);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Undo', exact: true }).click(); expect(await backup(page)).toEqual(before);
});

test('copy refuses artwork that would exceed portable project size and preserves the saved source', async ({ page }) => {
  test.setTimeout(90000); await page.goto('/');
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1200;
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(1200, 1200); let seed = 431;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + channel] = seed >>> 24; }
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return { dataUrl: canvas.toDataURL('image/jpeg', .97), width: 1200, height: 1200, name: 'texture.jpg' };
  });
  const source = { ...createProject(), product: template('blank'), wornWith: template('hoodie'), photo,
    strokes: Array.from({ length: 100 }, (_, s) => ({ id: `mark-${s}`, color: '#123456', width: 2,
      points: Array.from({ length: 120 }, (_, p) => ({ x: .3 + p / 400, y: .3 + s / 400 })) })) };
  const small = pngUrl(2, 2);
  source.wornWith.artwork = (['front', 'back'] as const).map(part => ({ part, dataUrl: small, width: 2, height: 2, name: part, xCm: 0, yCm: 0, widthCm: 10 }));
  const extraPerImage = Math.floor((MAX_PROJECT_BYTES - 1000 - Buffer.byteLength(serializeProject(source))) / 8) * 4;
  const padded = pngUrl(2, 2, small.length - 'data:image/png;base64,'.length + extraPerImage);
  for (const art of source.wornWith.artwork) art.dataUrl = padded;
  expect(Buffer.byteLength(serializeProject(source))).toBeLessThan(MAX_PROJECT_BYTES);
  expect(MAX_PROJECT_BYTES - Buffer.byteLength(serializeProject(source))).toBeLessThan(1010);
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(source)) });
  await expect(page.locator('#message')).toContainText('Project backup restored');
  await expect(page.locator('#save-state')).toContainText('Locally saved');
  const before = await backup(page), dialog = await openConcept(page);
  await dialog.getByRole('button', { name: copyName, exact: true }).click();
  await expect(dialog.locator('#message')).toContainText('6 MiB size limit');
  expect(await backup(page)).toEqual(before); await page.reload(); expect(await backup(page)).toEqual(before);
});
