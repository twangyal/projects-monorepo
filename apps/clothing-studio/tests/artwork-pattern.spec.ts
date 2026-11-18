import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return (await readFile((await (await wait).path())!)).toString(); }
const editor = (page: Page) => page.locator('#product-editor');
const pieces = (page: Page) => page.locator('#product-pieces');
async function upload(page: Page, side: string, message: string) {
  await editor(page).locator('#artwork-side').selectOption(side);
  const image = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 160; c.height = 80; c.getContext('2d')!.fillRect(0, 0, 160, 80); return c.toDataURL('image/png').split(',')[1]!; }), 'base64');
  await page.locator('#artwork-file').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('#message')).toContainText(message);
}

test('artwork shows on the pattern pieces it is printed on, and the pattern files mark it', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(pieces(page).locator('.artwork-mark')).toHaveCount(0);
  // Laid flat on the front piece, as placed, and on the sleeve piece it wraps round.
  await upload(page, 'front', 'Artwork placed on the front.');
  const front = pieces(page).locator('[data-piece="front"] .artwork-mark');
  await expect(front).toHaveCount(1);
  await expect(front.locator('image')).toHaveCount(1);
  await expect(front.locator('title')).toHaveText(/^Front artwork \(mark\.png\), \d+(\.\d)? × \d+(\.\d)? cm$/);
  await upload(page, 'sleeveLeft', 'Artwork placed on the left sleeve.');
  await expect(pieces(page).locator('[data-piece="sleeveLeft"] .artwork-mark image')).toHaveCount(1);
  await expect(pieces(page).locator('[data-piece="sleeveRight"] .artwork-mark')).toHaveCount(0);
  // The image lies where the mark says, inside the front piece on screen.
  const [image, piece] = await Promise.all([front.locator('image').boundingBox(), pieces(page).locator('[data-piece="front"] > polygon').boundingBox()]);
  expect(image!.x).toBeGreaterThan(piece!.x); expect(image!.x + image!.width).toBeLessThan(piece!.x + piece!.width);
  expect(image!.y).toBeGreaterThan(piece!.y);
  const svg = await download(page, 'Download printable pattern (SVG, 1:1) ↓');
  expect(svg).toContain('<g data-artwork="front">');
  expect(svg).toContain('<g data-artwork="sleeveLeft">');
  expect(svg).toContain('Purple dotted: where artwork is printed');
  const dxf = await download(page, 'Download pattern (DXF) ↓');
  expect(dxf.match(/\n0\nPOLYLINE\n8\nARTWORK\n/g)).toHaveLength(2);
});

test('a print on the wearer’s left of a buttoned front is marked for the pattern turned over, and one on trousers is traced on the legs', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  await upload(page, 'front', 'Artwork placed on the front.');
  // A chest print on the wearer's left, clear of the centre front.
  await page.locator('#artwork-width').fill('8');
  await page.locator('#artwork-x').fill('9');
  await page.locator('#apply-artwork').click();
  await expect(page.locator('#message')).toContainText('Artwork placement applied.');
  const mark = pieces(page).locator('[data-piece="front"] .artwork-mark');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveAttribute('data-turned', '');
  await expect(mark.locator('image')).toHaveCount(0);
  await expect(mark.locator('title')).toHaveText(/, wearer’s left front, pattern turned over$/);
  await editor(page).getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await upload(page, 'front', 'Artwork placed on the front.');
  const leg = pieces(page).locator('[data-piece="front"] .artwork-mark');
  await expect(leg).toHaveCount(1);
  await expect(leg.locator('polyline')).not.toHaveCount(0);
  await expect(leg.locator('image')).toHaveCount(0);
  await expect(leg.locator('title')).toHaveText(/, wearer’s (left|right) leg/);
});
