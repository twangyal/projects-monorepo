import { test, expect, type Page } from './helpers/expanded-workspace.ts';

const editor = (page: Page) => page.locator('#product-editor');

test('a zip hoodie is worn over a T-shirt, draped on it, and either can be the one edited', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Zip hoodie template/ }).click();
  const wearWith = page.getByRole('combobox', { name: 'Wear with', exact: true });
  // T-shirts are offered to wear underneath, beside bottoms; other sweatshirts and hoodies are not.
  await expect(wearWith.locator('option', { hasText: 'Blank tee' })).toHaveCount(1);
  await expect(wearWith.locator('option', { hasText: 'Joggers' })).toHaveCount(1);
  await expect(wearWith.locator('option', { hasText: 'Crew sweatshirt' })).toHaveCount(0);
  await wearWith.selectOption({ label: 'Blank tee' });
  await expect(page.locator('#message')).toContainText('The Zip hoodie is worn with the Blank tee.');
  await expect(page.getByRole('checkbox', { name: 'Tuck the top in', exact: true })).toBeDisabled();
  await expect(page.locator('#garment-tuck-help')).toHaveText('A top worn over another is not tucked in.');

  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  const status = page.locator('#garment-drape-status');
  await expect(status).toContainText('Worn over the Blank tee: the Blank tee drapes first on the same body, and this top rests on it.', { timeout: 150000 });
  // The body is the one the T-shirt underneath is draped for.
  await expect(status).toContainText('Draped on a body with a 94 cm chest');

  await page.getByRole('button', { name: 'Edit worn garment', exact: true }).click();
  await expect(wearWith).toHaveValue('kept');
  await expect(wearWith.locator('option[value=kept]')).toHaveText('Zip hoodie (kept with this design)');
  await expect(status).toContainText('Worn under the Zip hoodie: this top drapes first', { timeout: 150000 });
});
