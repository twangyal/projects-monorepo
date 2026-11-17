import { test, expect, type Page } from './helpers/expanded-workspace.ts';

const editor = (page: Page) => page.locator('#product-editor');

test('an Oxford shirt is worn open over a T-shirt and draped on it', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const wearWith = page.getByRole('combobox', { name: 'Wear with', exact: true });
  // Tops without a button front are offered to wear underneath, and a hoodie over it; another shirt is not.
  for (const name of ['Blank tee', 'Tank top', 'T-shirt dress', 'Pullover hoodie', 'Joggers']) await expect(wearWith.locator('option', { hasText: name })).toHaveCount(1);
  await expect(wearWith.locator('option', { hasText: 'Oxford shirt' })).toHaveCount(0);
  await wearWith.selectOption({ label: 'Blank tee' });
  await expect(page.locator('#message')).toContainText('The Oxford shirt is worn with the Blank tee.');
  await expect(page.locator('#garment-tuck-help')).toHaveText('A top worn over another is not tucked in.');
  await editor(page).getByRole('checkbox', { name: 'Worn open', exact: true }).check();
  await expect(page.locator('#message')).toContainText('Worn open: the front halves part at the placket');

  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  const status = page.locator('#garment-drape-status');
  await expect(status).toContainText('Worn over the Blank tee: the Blank tee drapes first on the same body, and this top rests on it.', { timeout: 150000 });
  // Edited from the tee, the shirt is the garment over it.
  await page.getByRole('button', { name: 'Edit worn garment', exact: true }).click();
  await expect(wearWith.locator('option[value=kept]')).toHaveText('Oxford shirt (kept with this design)');
  await expect(status).toContainText('Worn under the Oxford shirt: this top drapes first', { timeout: 150000 });
});
