import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');
const pom = (page: Page, code: string) => editor(page).locator('#techpack-preview tr').filter({ has: page.locator(`td:first-child:text-is("${code}")`) }).locator('td').nth(6);

test('fit: editing points of measure changes the tech pack and pattern, keeps the rest proportional, and undoes', async ({ page }) => {
  test.setTimeout(90000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await editor(page).locator('#fit-panel summary').click();
  const field = (name: string) => editor(page).getByLabel(`${name} (cm)`, { exact: true });
  await expect(field('Shoulder width')).toHaveValue('48.4');
  const outline = editor(page).locator('[data-piece="front"] polygon'), before = await outline.getAttribute('points');

  // A tapered body with a narrower shoulder and a lower neck.
  await field('Shoulder width').fill('42');
  await field('Front neck drop').fill('10');
  await field('Hem width (½)').fill('48');
  await editor(page).getByRole('button', { name: 'Apply fit', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Fit applied');
  await expect(pom(page, 'E')).toHaveText('42');
  await expect(pom(page, 'G')).toHaveText('10');
  await expect(pom(page, 'I')).toHaveText('48');
  await expect(outline).not.toHaveAttribute('points', before!);
  let saved = (await backup(page)).product;
  expect(saved.fit).toEqual({ shoulderWidth: 42, frontNeckDrop: 10, hemWidth: 48 });

  // Untouched values keep scaling with the chest.
  await editor(page).getByLabel('Chest (cm)', { exact: true }).fill('112');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(field('Shoulder width')).toHaveValue('42');
  await expect(field('Neck width')).toHaveValue('31.9');
  saved = (await backup(page)).product;
  expect(saved.fit).toEqual({ shoulderWidth: 42, frontNeckDrop: 10, hemWidth: 48 });

  // An impossible fit is refused without changing anything.
  await field('Neck width').fill('28');
  await field('Shoulder width').fill('30');
  await editor(page).getByRole('button', { name: 'Apply fit', exact: true }).click();
  await expect(page.locator('#message')).toContainText('narrower than the shoulders');
  expect((await backup(page)).product.fit).toEqual({ shoulderWidth: 42, frontNeckDrop: 10, hemWidth: 48 });

  await editor(page).getByRole('button', { name: 'Back to proportional', exact: true }).click();
  await expect(pom(page, 'G')).toHaveText('8');
  expect((await backup(page)).product.fit).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(pom(page, 'G')).toHaveText('10');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(pom(page, 'E')).toHaveText('42');
});
