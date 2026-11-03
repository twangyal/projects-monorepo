import { test, expect } from './helpers/expanded-workspace.ts';

test('versions are numbered for the design and compared with the current one in plain words', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  await page.getByRole('button', { name: 'Saved designs', exact: true }).click();
  const status = page.locator('#design-library-status');
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(status).toContainText('Saved version “Oxford shirt · v1”');
  // Unchanged, the saved version and the current design are the same.
  await page.getByRole('button', { name: 'Compare with current', exact: true }).click();
  await expect(status).toContainText('The current design is the same as “Oxford shirt · v1”.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Materials & prints', exact: true }).click();
  await page.locator('#part-color').fill('#1f2a4f');
  await page.locator('#part-color').dispatchEvent('change');
  await page.getByRole('button', { name: 'Saved designs', exact: true }).click();
  await page.getByRole('button', { name: 'Compare with current', exact: true }).click();
  await expect(status).toContainText('From “Oxford shirt · v1” to the current design, 1 change:');
  await expect(page.getByRole('list', { name: 'Changes from the saved design to the current one' }).getByRole('listitem')).toHaveText([/^Front body: Cotton poplin, .+ → Cotton poplin, navy$/]);
  await page.getByRole('button', { name: 'Save version', exact: true }).click();
  await expect(status).toContainText('Saved version “Oxford shirt · v2”');
  await expect(page.getByRole('list', { name: 'Changes from the saved design to the current one' })).toBeHidden();
});
