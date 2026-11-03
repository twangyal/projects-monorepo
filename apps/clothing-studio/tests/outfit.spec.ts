import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a top is worn over trousers, draped together, kept with the design and undoable', async ({ page }) => {
  test.setTimeout(150000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const wearWith = page.getByRole('combobox', { name: 'Wear with', exact: true });
  await expect(wearWith).toHaveValue('');
  // Only bottoms are offered with a top.
  await expect(wearWith.locator('option', { hasText: 'Ringer tee' })).toHaveCount(0);
  await wearWith.selectOption({ label: 'Straight trousers' });
  await expect(page.locator('#message')).toContainText('The Blank tee is worn with the Straight trousers.');
  await expect(wearWith).toHaveValue('kept');
  expect((await backup(page)).wornWith.name).toBe('Straight trousers');

  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Worn over the Straight trousers', { timeout: 120000 });
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body with a 94 cm chest');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Wear with', exact: true })).toHaveValue('');
  expect((await backup(page)).wornWith).toBeUndefined();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();

  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Wear with', exact: true })).toHaveValue('kept');
  await expect(page.getByRole('combobox', { name: 'Wear with', exact: true }).locator('option[value=kept]')).toHaveText('Straight trousers (kept with this design)');
});

test('bottoms are worn under a top, with the chest that top is draped for', async ({ page }) => {
  test.setTimeout(150000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Pull-on shorts template/ }).click();
  await expect(page.getByLabel('Body chest girth (cm)', { exact: true })).toBeHidden();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Ringer tee' });
  await expect(page.getByLabel('Body chest girth (cm)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Body chest girth (cm)', { exact: true })).toHaveValue('94');
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Worn under the Ringer tee', { timeout: 120000 });
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Nothing else' });
  await expect(page.locator('#message')).toContainText('The Pull-on shorts is worn on its own.');
  await expect(page.locator('#garment-drape-status')).not.toContainText('Worn under', { timeout: 120000 });
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body', { timeout: 120000 });
});

test('a body the bottoms cannot be worn on is explained by the outfit drape', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Flared skirt template/ }).click();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Blank tee' });
  await page.locator('#top-body-shape summary').click();
  await page.getByLabel('Body waist girth (cm, optional)').fill('90');
  await page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText("smaller than the skirt's 80 cm waist", { timeout: 60000 });
  await expect(page.getByRole('combobox', { name: 'Wear with', exact: true })).toHaveValue('kept');
});

test('a top is tucked into trousers and draped that way, undoably; a dress cannot be tucked', async ({ page }) => {
  test.setTimeout(240000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const tuck = page.getByRole('checkbox', { name: 'Tuck the top in', exact: true });
  await expect(tuck).toBeDisabled();
  await expect(page.locator('#garment-tuck-help')).toHaveText('Choose bottoms with Wear with to tuck a top in.');
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  await expect(tuck).toBeEnabled();
  await tuck.check();
  await expect(page.locator('#message')).toContainText('The Blank tee is tucked into the Straight trousers.');
  expect((await backup(page)).tucked).toBe(true);
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  const status = page.locator('#garment-drape-status');
  await expect(status).toContainText('Tucked into the Straight trousers', { timeout: 120000 });
  await expect(status).not.toContainText('the hem falls');

  // Undo leaves it untucked, draped over the trousers again (undo shows the styling shell until Drape is chosen).
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tuck).not.toBeChecked();
  expect((await backup(page)).tucked).toBeUndefined();
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(status).toContainText('Worn over the Straight trousers', { timeout: 120000 });
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(tuck).toBeChecked();

  // Taking the trousers off drops the tuck; a dress worn with them cannot be tucked.
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Nothing else' });
  await expect(tuck).toBeDisabled();
  expect((await backup(page)).tucked).toBeUndefined();
  page.once('dialog', dialog => void dialog.accept());
  await editor(page).getByRole('button', { name: /^Use the T-shirt dress template/ }).click();
  await expect(page.locator('#message')).toContainText('T-shirt dress template loaded.');
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Straight trousers' });
  await expect(tuck).toBeDisabled();
  await expect(page.locator('#garment-tuck-help')).toContainText('A dress cannot be tucked in');
});
