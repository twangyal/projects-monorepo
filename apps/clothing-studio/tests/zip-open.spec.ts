import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a zip hoodie can be worn open, with each half carrying its side of the zip, and zipped up again', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Zip hoodie template/ }).click();
  const open = page.getByRole('checkbox', { name: 'Worn open', exact: true });
  await expect(open).toBeEnabled(); await expect(open).not.toBeChecked();
  await open.check();
  await expect(page.locator('#message')).toContainText('Worn open');
  expect((await backup(page)).product.options).toEqual({ hem: 'straight', chestPocket: false, zip: true, zipOpen: true });
  // Each front half and each end of the hem band carries its own side of the zip.
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(json.nodes.filter((node: { name?: string }) => node.name === 'Zip')).toHaveLength(4);
  // Taking the zip out zips it up too; without a zip, the hoodie cannot be worn open.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(open).not.toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(open).toBeChecked();
  const zip = page.getByRole('checkbox', { name: 'Front zip', exact: true });
  await zip.uncheck();
  await expect(open).toBeDisabled(); await expect(open).not.toBeChecked();
  expect((await backup(page)).product.options).toEqual({ hem: 'straight', chestPocket: false });
  // Draped, an open zip hoodie settles open.
  await zip.check(); await open.check();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body', { timeout: 120000 });
  await expect(page.locator('#garment-drape-status')).not.toContainText('still settling');
});
