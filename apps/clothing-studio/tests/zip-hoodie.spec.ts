import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a hoodie gets a front zip, carried by the 3D model, and loses it again', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  const zip = page.getByRole('checkbox', { name: 'Front zip', exact: true });
  await expect(zip).toBeVisible(); await expect(zip).not.toBeChecked();
  await zip.check();
  await expect(page.locator('#message')).toContainText('Front zip added');
  expect((await backup(page)).product.options).toEqual({ hem: 'straight', chestPocket: false, zip: true });
  // The 3D model carries the zip, down the front and through the hem band.
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(json.nodes.filter((node: { name?: string }) => node.name === 'Zip')).toHaveLength(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(zip).not.toBeChecked();
  expect((await backup(page)).product.options?.zip).toBeUndefined();
  // Other tops have no zip to offer.
  page.once('dialog', dialog => void dialog.accept());
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(zip).toBeHidden();
});
