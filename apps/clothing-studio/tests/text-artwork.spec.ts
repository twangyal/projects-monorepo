import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('quoted words in a description and typed text are printed on the garment as artwork', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByLabel('Describe a style', { exact: false }).first().fill('black tee with "Stay Wild" on the back in white letters');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(page.locator('#describe-result')).toContainText('Artwork: text “Stay Wild” on the back');
  let saved = await backup(page);
  const back = saved.product.artwork.find((art: { part: string }) => art.part === 'back');
  expect(back.name).toBe('Text: Stay Wild');
  expect(back.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(back.width).toBeGreaterThan(back.height);

  // Typed text goes on the chosen side, replacing that side's artwork; undo removes it.
  await editor(page).locator('#artwork-side').selectOption('front');
  await page.getByLabel('Text to print', { exact: true }).fill('Northwind Books and Coffee Since 1999');
  await page.getByRole('button', { name: 'Print this text', exact: true }).click();
  await expect(page.locator('#message')).toContainText('“Northwind Books and Coffee Since 1999” printed on the front.');
  saved = await backup(page);
  const front = saved.product.artwork.find((art: { part: string }) => art.part === 'front');
  expect(front.name).toBe('Text: Northwind Books and Coffee Since 1999');
  // Long text prints on two lines.
  expect(front.height).toBeGreaterThan(back.height * 1.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  saved = await backup(page);
  expect(saved.product.artwork.map((art: { name: string }) => art.name)).toEqual(['Text: Stay Wild']);
});
