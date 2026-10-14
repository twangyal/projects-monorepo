import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('modules: a curved hem, a chest pocket and sleeve presets reach the pattern, tech pack, save and undo', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Ringer tee');
  const parts = editor(page).getByRole('radiogroup', { name: 'Garment parts' }).getByRole('radio');
  await expect(parts).toHaveCount(5);

  await editor(page).locator('#product-hem').selectOption('curved');
  await expect(page.locator('#message')).toContainText('Curved shirttail hem');
  await expect(editor(page).locator('#techpack-preview')).toContainText('Side length');
  await expect(editor(page).locator('#techpack-preview')).toContainText('Curved shirttail');

  await editor(page).getByRole('checkbox', { name: 'Add a chest pocket' }).check();
  await expect(parts).toHaveCount(6);
  await expect(editor(page).locator('#inspector-heading')).toHaveText('Chest pocket');
  await expect(editor(page).locator('[data-piece="chestPocket"]')).toHaveAttribute('aria-label', /^Chest pocket, 12\.0 by 16\.0 cm/);
  await expect(editor(page).locator('#techpack-preview')).toContainText('Chest pocket placement');
  // Style the pocket on its own.
  await editor(page).getByRole('button', { name: 'Apply Gingham check print', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Long sleeve, 60 cm', exact: true }).click();
  await expect(editor(page).getByLabel('Sleeve length (cm)', { exact: true })).toHaveValue('60');
  const saved = (await backup(page)).product;
  expect(saved.options).toEqual({ hem: 'curved', chestPocket: true });
  expect(saved.parts.chestPocket.print.motif).toBe('gingham');
  expect(saved.parts.front.print).toBeNull();
  expect(saved.measurements.sleeve).toBe(60);

  // Undo steps back through the sleeve, the print and the pocket.
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(parts).toHaveCount(5);
  await expect(editor(page).getByRole('checkbox', { name: 'Add a chest pocket' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(parts).toHaveCount(6);
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(editor(page).getByRole('checkbox', { name: 'Add a chest pocket' })).toBeChecked();
  await expect(editor(page).locator('#product-hem')).toHaveValue('curved');

  // A hoodie keeps a straight banded hem and its kangaroo pocket.
  page.once('dialog', dialog => dialog.accept());
  await editor(page).getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Pullover hoodie');
  await expect(editor(page).getByRole('checkbox', { name: 'Add a chest pocket' })).toBeDisabled();
  await expect(editor(page).locator('#product-hem option[value=curved]')).toHaveJSProperty('disabled', true);
  await expect(editor(page).locator('#module-help')).toContainText('kangaroo pocket');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
