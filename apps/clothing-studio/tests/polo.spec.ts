import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a tee becomes a polo with a collar, placket and buttons in 3D, and back again', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const polo = page.getByRole('checkbox', { name: 'Polo collar and placket', exact: true });
  await expect(polo).toBeVisible(); await expect(polo).not.toBeChecked();
  await polo.check();
  await expect(page.locator('#message')).toContainText('Polo collar and placket added');
  const saved = (await backup(page)).product;
  expect(saved.options).toEqual({ hem: 'straight', chestPocket: false, collar: true });
  expect(Object.keys(saved.parts)).toEqual(expect.arrayContaining(['collar', 'placket']));
  expect(saved.parts.neckband).toBeUndefined();
  // The 3D model carries the collar, the placket and its buttons.
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const names = json.nodes.map((node: { name?: string }) => node.name);
  expect(names).toEqual(expect.arrayContaining(['Collar', 'Placket', 'Buttons']));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(polo).not.toBeChecked();
  expect((await backup(page)).product.parts.neckband).toBeDefined();
  // A sweatshirt has no polo collar to offer.
  page.once('dialog', dialog => void dialog.accept());
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  await expect(polo).toBeHidden();
});
