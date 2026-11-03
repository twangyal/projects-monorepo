import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

const editor = (page: Page) => page.locator('#product-editor');
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }

test('a zip hoodie, a T-shirt and joggers are worn together, draped in order, and each can be edited', async ({ page }) => {
  test.setTimeout(420000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Zip hoodie template/ }).click();
  const also = page.getByRole('combobox', { name: 'And with', exact: true });
  await expect(also).toBeDisabled();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Blank tee' });
  // With a T-shirt under the hoodie, bottoms complete the outfit; another top does not.
  await expect(also).toBeEnabled();
  await expect(also.locator('option', { hasText: 'Joggers' })).toHaveCount(1);
  await expect(also.locator('option', { hasText: 'Crew sweatshirt' })).toHaveCount(0);
  await also.selectOption({ label: 'Joggers' });
  await expect(page.locator('#message')).toContainText('The Zip hoodie is worn with the Blank tee and the Joggers.');
  expect((await backup(page)).wornAlso.name).toBe('Joggers');

  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  const status = page.locator('#garment-drape-status');
  await expect(status).toContainText('Worn over the Blank tee and the Joggers: they drape first on the same body, and this top rests on both.', { timeout: 200000 });

  await page.getByRole('button', { name: 'Edit worn garment', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Editing the Blank tee. The Joggers and the Zip hoodie stay in this outfit');
  await expect(status).toContainText('Worn under the Zip hoodie, over the Joggers', { timeout: 200000 });
  // Undo goes back to editing the hoodie, with all three kept.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'And with', exact: true })).toHaveValue('kept');
});
