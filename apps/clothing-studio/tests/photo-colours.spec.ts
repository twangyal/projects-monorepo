import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('colours picked from a photo become swatches, a colorway in one undoable step, and stay across templates', async ({ page }) => {
  test.setTimeout(60000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  // A product-shot-like picture: a sage garment with a terracotta band on an off-white background.
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 240; c.height = 240; const x = c.getContext('2d')!;
    x.fillStyle = '#f6f3ee'; x.fillRect(0, 0, 240, 240); x.fillStyle = '#7d9a6f'; x.fillRect(40, 20, 160, 200); x.fillStyle = '#c4623f'; x.fillRect(40, 180, 160, 40);
    const blob = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await editor(page).locator('#photo-colours-file').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.locator('#message')).toContainText('3 colours from the photo');
  const chips = editor(page).getByRole('group', { name: 'Colours from your photo' }).getByRole('button');
  await expect(chips).toHaveCount(3);
  const palette = (await backup(page)).product.palette as string[];
  expect(palette).toHaveLength(3);
  expect(await chips.first().getAttribute('aria-label')).toBe(`Apply photo color ${palette[0]}`);

  // One chip styles the selected part; the whole palette becomes a colorway.
  await chips.nth(2).click();
  expect((await backup(page)).product.parts.front.color).toBe(palette[2]);
  await editor(page).getByRole('button', { name: 'Use them on the garment', exact: true }).click();
  let parts = (await backup(page)).product.parts;
  expect(parts.front.color).toBe(palette[0]);
  expect(parts.cuffLeft.color).not.toBe(palette[0]);
  expect(parts.front.material).toBe('terry-300');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  parts = (await backup(page)).product.parts;
  expect(parts.front.color).toBe(palette[2]);

  // The photo colours stay for the next template, until removed.
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(chips).toHaveCount(3);
  await editor(page).getByRole('button', { name: 'Remove photo colours', exact: true }).click();
  await expect(chips).toHaveCount(0);
  await expect(editor(page).getByRole('button', { name: 'Use them on the garment', exact: true })).toBeHidden();
  expect((await backup(page)).product.palette).toBeUndefined();
});
