import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a wool coat goes over a sweatshirt and drapes on it; a long shirt is made a coat and shortened back', async ({ page }) => {
  test.setTimeout(240000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Wool coat template/ }).click();
  const coat = page.getByRole('checkbox', { name: 'Coat', exact: true });
  await expect(coat).toBeChecked();
  await expect(editor(page).locator('#coat-help')).toBeVisible();
  await expect(editor(page).locator('#techpack-preview')).toContainText('blind-stitch');
  // A tee, shirt, polo, dress or sweatshirt goes under a coat, and it goes with trousers; a hoodie does not go under it.
  const wearWith = page.getByRole('combobox', { name: 'Wear with', exact: true });
  for (const name of ['Blank tee', 'Oxford shirt', 'Polo shirt', 'T-shirt dress', 'Crew sweatshirt', 'Straight trousers']) await expect(wearWith.locator('option', { hasText: name })).toHaveCount(1);
  await expect(wearWith.locator('option', { hasText: 'Pullover hoodie' })).toHaveCount(0);
  // Over a sweatshirt, both are made for the sweatshirt's lower arms.
  await wearWith.selectOption({ label: 'Crew sweatshirt' });
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Worn over the Crew sweatshirt', { timeout: 150000 });

  // A shirt long enough becomes a coat with the box; shortened below a coat's length it is a shirt again.
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  await expect(coat).not.toBeChecked();
  await coat.check();
  await expect(page.locator('#message')).toContainText('Made a coat');
  expect((await backup(page)).product.options.coat).toBe(true);
  await editor(page).getByLabel('Body length (cm)').fill('62');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(coat).not.toBeChecked();
  await expect(coat).toBeDisabled();
  expect((await backup(page)).product.options.coat).toBeUndefined();
});
