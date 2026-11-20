import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) {
  const wait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  return JSON.parse((await readFile((await (await wait).path())!)).toString());
}
for (const phone of [false, true]) test(`lapel width follows pattern, history and saved designs on ${phone ? 'phone' : 'desktop'}`, async ({ page }) => {
  test.setTimeout(150000);
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blazer template/ }).click();
  await editor.locator('#fit-panel summary').click();
  const field = editor.getByLabel('Lapel width (cm)', { exact: true });
  await expect(field).toHaveValue('8');
  const front = editor.locator('[data-piece="front"]').first(), facing = editor.locator('[data-piece="lapel"]').first();
  const before = await front.innerHTML(), facingBefore = await facing.innerHTML();
  const apply = editor.getByRole('button', { name: 'Apply fit', exact: true });
  await field.fill('6.25');
  await apply.click();
  await expect(page.locator('#message')).toContainText('Fit applied');
  expect(await front.innerHTML()).not.toBe(before);
  expect(await facing.innerHTML()).not.toBe(facingBefore);
  expect((await backup(page)).product.fit.lapelWidth).toBe(6.25);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(field).toHaveValue('8');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(field).toHaveValue('6.3');
  // Applying an unrelated fit preserves the precise authored value behind the rounded display.
  await editor.getByLabel('Shoulder width (cm)', { exact: true }).fill('50');
  await apply.click();
  expect((await backup(page)).product.fit.lapelWidth).toBe(6.25);
  await editor.getByRole('checkbox', { name: 'Peak lapels', exact: true }).check();
  await expect(editor.locator('#techpack-preview')).toContainText('a peak lapel, 6.3 cm wide');
  const lapels = editor.getByRole('checkbox', { name: 'Lapels', exact: true });
  await lapels.uncheck();
  await expect(field).toBeHidden();
  await apply.click();
  expect((await backup(page)).product.fit.lapelWidth).toBe(6.25);
  await lapels.check();
  await expect(field).toHaveValue('6.3');
  await field.fill('');
  await apply.click();
  await expect(page.locator('#message')).toContainText('Fill in lapel width');
  await field.fill('13');
  await apply.click();
  await expect(page.locator('#message')).toContainText('Lapel width (cm) must be from 4 to 12');
  expect((await backup(page)).product.fit.lapelWidth).toBe(6.25);
  await page.reload();
  await expect(field).toHaveValue('6.3');
  expect((await backup(page)).product.fit.lapelWidth).toBe(6.25);
  await editor.locator('#fit-panel summary').click();
  await editor.getByRole('button', { name: 'Back to proportional', exact: true }).click();
  await expect(field).toHaveValue('8');
  await expect(front).toHaveJSProperty('innerHTML', before);
});
