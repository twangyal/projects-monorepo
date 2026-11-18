import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function glbNodes(page: Page) {
  const bytes = await download(page, 'Export 3D model (GLB) ↓'), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');
const field = (page: Page, label: string) => editor(page).getByLabel(label, { exact: true });
// The share of a PNG's pixels that are the test artwork's blue, and their mean x as a share of its width.
async function blue(page: Page, png: Buffer) {
  return page.evaluate(async data => {
    const image = await createImageBitmap(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0, sum = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! < 70 && pixels[i + 1]! < 70 && pixels[i + 2]! > 150) { count++; sum += (i / 4) % canvas.width; }
    return { count, x: count ? sum / count / canvas.width : 0 };
  }, png.toString('base64'));
}

test('shorts take a print on the thigh, placed below the waist, picked on a leg in 3D and moved up when the legs are shortened', async ({ page }) => {
  test.setTimeout(150000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Pull-on shorts template/ }).click();
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 80;
    const context = canvas.getContext('2d')!; context.fillStyle = '#1010ed'; context.fillRect(0, 0, 160, 80); return canvas.toDataURL('image/png').split(',')[1]!;
  }), 'base64');
  await editor(page).locator('#artwork-file').setInputFiles({ name: 'club.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#message')).toContainText('Artwork placed on the front');
  // New artwork goes on the wearer's left hip, 12 cm below the waist seam, and the tech pack says so.
  await expect(field(page, 'From centre (cm)')).toHaveValue('9');
  await expect(field(page, 'Below waist (cm)')).toHaveValue('12');
  await expect(editor(page).locator('#techpack-preview')).toContainText('Front: 12.0 cm below the waist seam, 9.0 cm right of centre when viewed from outside, on the wearer’s left leg');
  // It is printed there in 3D, right of centre in the front view and all of it in view.
  const shown = await blue(page, await download(page, 'Export front render PNG ↓'));
  expect(shown.count).toBeGreaterThan(300);
  expect(shown.x).toBeGreaterThan(0.51);
  expect(await glbNodes(page)).toContain('Front artwork');

  // Picked on the other leg in 3D (the garment stands in the middle of the view), it moves to the wearer's right leg.
  let picked = false;
  for (const y of [0.55, 0.5, 0.6, 0.45, 0.65]) {
    await editor(page).getByRole('button', { name: 'Pick artwork centre in 3D', exact: true }).click();
    const canvas = page.locator('#product-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.46, box.y + box.height * y);
    if ((await page.locator('#artwork-placement-status').textContent())?.includes('Apply placement')) { picked = true; break; }
    await page.keyboard.press('Escape');
  }
  expect(picked).toBe(true);
  expect(Number(await field(page, 'From centre (cm)').inputValue())).toBeLessThan(-3);
  await editor(page).getByRole('button', { name: 'Apply placement', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Artwork placement applied');
  await expect(editor(page).locator('#techpack-preview')).toContainText('on the wearer’s right leg');

  // Placed low and then shortened, the legs carry it up rather than refusing the change.
  await field(page, 'From centre (cm)').fill('13');
  await field(page, 'Below waist (cm)').fill('40');
  await editor(page).getByRole('button', { name: 'Apply placement', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Artwork placement applied');
  await field(page, 'Inseam (cm)').fill('10');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  // The legs now end 38 cm below the waist seam, and the 5 cm tall print ends above the hem.
  await expect(field(page, 'Below waist (cm)')).toHaveValue('33');
  expect((await backup(page)).product.artwork[0]).toMatchObject({ part: 'front', xCm: 13, yCm: 33, widthCm: 10 });
});

test('a skirt takes printed text centred below its waist, and a description prints quoted words on shorts', async ({ page }) => {
  test.setTimeout(90000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Flared skirt template/ }).click();
  await editor(page).locator('#artwork-side').selectOption('back');
  await field(page, 'Text to print').fill('Team 7');
  await editor(page).getByRole('button', { name: 'Print this text', exact: true }).click();
  await expect(page.locator('#message')).toContainText('“Team 7” printed on the back.');
  await expect(field(page, 'From centre (cm)')).toHaveValue('0');
  await expect(field(page, 'Below waist (cm)')).toHaveValue('12');
  await expect(editor(page).locator('#techpack-preview')).toContainText('Back: 12.0 cm below the waist seam, centred');
  expect(await glbNodes(page)).toContain('Back artwork');

  await editor(page).getByRole('button', { name: /^Use the Pull-on shorts template/ }).click();
  await page.getByLabel('Describe a style', { exact: false }).first().fill('"Run Club" on the back');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(page.locator('#describe-result')).toContainText('Artwork: text “Run Club” on the back');
  const saved = (await backup(page)).product;
  expect(saved.artwork).toEqual([expect.objectContaining({ part: 'back', name: 'Text: Run Club', xCm: 8, yCm: 8 })]);
});
