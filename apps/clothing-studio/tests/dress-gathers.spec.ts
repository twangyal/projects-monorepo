import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('a dress skirt is gathered into its waist seam, cut wider in the pattern and sewn with gathering rows', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Fit-and-flare dress template/ }).click();
  const gathering = editor(page).getByLabel('Skirt gathering (× waist seam)');
  await expect(gathering).toBeVisible();
  await expect(gathering).toHaveValue('1');
  await expect(editor(page).locator('#dress-gather-note')).toContainText('gathers it into the seam');

  await gathering.fill('1.5');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  expect((await backup(page)).product.measurements).toEqual({ chest: 96, length: 95, sleeve: 21, gather: 1.5 });
  // The skirt pieces are cut half as wide again at the waist, and the tech pack says how they are gathered.
  await expect(editor(page).locator('#techpack-preview')).toContainText('Run two gathering rows along each skirt’s waist edge');
  await expect(editor(page).locator('#techpack-preview')).toContainText('cut 1.5× the seam (60.0 cm against 40.0 cm)');

  // A waist edge longer than the hem is refused, and the design keeps its gathers; discarding the draft shows them again.
  await gathering.fill('2');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('must be no longer than its hem');
  expect((await backup(page)).product.measurements.gather).toBe(1.5);
  await editor(page).getByRole('button', { name: 'Discard all product drafts', exact: true }).click();
  await expect(gathering).toHaveValue('1.5');

  // Without the waist seam there is nothing to gather into: the field goes, and so do the gathers, until Undo.
  const seam = page.getByRole('checkbox', { name: 'Waist seam (a dress cut into bodice and skirt)', exact: true });
  await seam.uncheck();
  await expect(gathering).toBeHidden();
  expect((await backup(page)).product.measurements.gather).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(seam).toBeChecked();
  await expect(gathering).toHaveValue('1.5');

  // A description gathers a T-shirt dress, cutting it at the waist and widening its hem to the gathered edge; a tee has
  // no field for it.
  await editor(page).getByRole('button', { name: /^Use the T-shirt dress template/ }).click();
  await expect(gathering).toBeHidden();
  await editor(page).getByLabel('Describe a style', { exact: true }).fill('gathered skirt');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('gathered skirt: 1.5 times the waist seam, hem widened to 81 cm (½)');
  await expect(seam).toBeChecked();
  await expect(gathering).toHaveValue('1.5');
  const dress = (await backup(page)).product;
  expect([dress.base, dress.measurements.gather, dress.fit.hemWidth]).toEqual(['tee', 1.5, 81]);
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(gathering).toBeHidden();
});
