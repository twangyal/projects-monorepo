import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('waist darts are set for a dress bodice, drawn on its front and back, sewn in the tech pack and go with the waist seam', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Fit-and-flare dress template/ }).click();
  const intake = editor(page).getByLabel('Waist dart intake (cm, 0 for none)');
  await expect(intake).toBeVisible();
  await expect(intake).toHaveValue('0');
  await expect(editor(page).locator('#waist-dart-note')).toContainText('toward the shoulder blades');
  await intake.fill('2');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  expect((await backup(page)).product.measurements.waistDart).toBe(2);
  for (const part of ['front', 'back']) await expect(page.locator(`[data-piece="${part}"]`).first().locator('.dart-line')).toHaveCount(2);
  await expect(editor(page).locator('#techpack-preview')).toContainText('Sew each dart from the bodice’s waist edge to its point'.replace('’', "'"));

  // Without the waist seam there is no bodice: the field and the darts go, until Undo.
  const seam = page.getByRole('checkbox', { name: 'Waist seam (a dress cut into bodice and skirt)', exact: true });
  await seam.uncheck();
  await expect(intake).toBeHidden();
  expect((await backup(page)).product.measurements.waistDart).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(seam).toBeChecked();
  await expect(intake).toHaveValue('2');
  // A T-shirt has no field for them.
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(intake).toBeHidden();
});
