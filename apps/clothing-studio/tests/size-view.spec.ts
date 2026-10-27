import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('another size is shown and draped on the same body without changing the design', async ({ page }) => {
  test.setTimeout(150000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const size = page.getByRole('combobox', { name: 'Size shown', exact: true });
  await expect(size).toHaveValue('M');
  await expect(size.locator('option[value=M]')).toHaveText('M (sample)');
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('10 cm of ease at the chest', { timeout: 120000 });

  // Size L is 5 cm larger at the chest on the same 94 cm body.
  await size.selectOption('L');
  await expect(page.locator('#message')).toContainText('Showing size L, graded from M, on the same body.');
  await expect(page.locator('#garment-drape-status')).toContainText('Size L, graded from M. Draped on a body with a 94 cm chest: 15 cm of ease', { timeout: 120000 });
  expect((await backup(page)).product.measurements).toEqual({ chest: 104, length: 72, sleeve: 21 });

  await size.selectOption('M');
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body with a 94 cm chest: 10 cm of ease', { timeout: 120000 });
  await expect(page.locator('#garment-drape-status')).not.toContainText('Size L');

  // A flared skirt has no grading.
  await editor(page).getByRole('button', { name: /^Use the Flared skirt template/ }).click();
  await expect(size).toBeDisabled();
});
