import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('puff sleeves: a T-shirt sleeve cap is cut fuller, gathered into the armhole and sewn with gathering rows', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  const puff = editor(page).getByLabel('Sleeve cap gathering (× armhole)');
  await expect(puff).toBeVisible();
  await expect(puff).toHaveValue('1');
  await expect(editor(page).locator('#sleeve-gather-note')).toContainText('makes puff sleeves');

  await puff.fill('1.5');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  expect((await backup(page)).product.measurements).toEqual({ chest: 104, length: 72, sleeve: 21, sleeveGather: 1.5 });
  await expect(editor(page).locator('#techpack-preview')).toContainText('Run two gathering rows over each sleeve cap');
  await expect(editor(page).locator('#techpack-preview')).toContainText('each cap is cut 1.5× its armhole');

  // Made sleeveless, the top has no sleeves to puff: the field goes, and so does the gathering.
  await editor(page).getByLabel('Sleeve length (cm)').fill('0');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(puff).toBeHidden();
  expect((await backup(page)).product.measurements.sleeveGather).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(puff).toHaveValue('1.5');

  // Described: "plain sleeves" takes the puff out again, and a sweatshirt has no field for it.
  await editor(page).getByLabel('Describe a style', { exact: true }).fill('plain sleeves');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('plain sleeves: no gathers at the cap');
  await expect(puff).toHaveValue('1');
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  await expect(puff).toBeHidden();
});
