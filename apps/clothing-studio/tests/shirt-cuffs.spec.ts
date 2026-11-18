import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a long-sleeved shirt gets buttoned cuffs that are styled, patterned and listed on their own, and lose them with short sleeves', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const cuffs = page.getByRole('checkbox', { name: 'Shirt cuffs', exact: true });
  await expect(cuffs).toBeEnabled();
  await cuffs.check();
  await expect(page.locator('#message')).toContainText('Cuffs added');
  await expect(editor(page).locator('#cuffs-help')).toBeVisible();
  let saved = (await backup(page)).product;
  expect(saved.options.cuffs).toBe(true);
  expect(saved.parts.cuffLeft).toEqual(saved.parts.sleeveLeft);
  await expect(editor(page).locator('[data-piece="cuffLeft"]')).toHaveCount(1);
  await expect(editor(page).locator('#techpack-preview')).toContainText('pleat the sleeve end into it');

  // Described: white cuffs on the blue shirt.
  await editor(page).getByLabel('Describe a style', { exact: true }).fill('white cuffs');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  saved = (await backup(page)).product;
  expect([saved.parts.cuffLeft.color, saved.parts.cuffRight.color]).toEqual(['#f7f7f4', '#f7f7f4']);

  // Short sleeves have no cuffs: they go, the box is greyed out, and Undo brings them back.
  await editor(page).getByLabel('Sleeve length (cm)').fill('25');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(cuffs).not.toBeChecked();
  await expect(cuffs).toBeDisabled();
  expect((await backup(page)).product.parts.cuffLeft).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cuffs).toBeChecked();
});
