import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');
const pom = (page: Page, code: string) => editor(page).locator('#techpack-preview tr').filter({ has: page.locator(`td:first-child:text-is("${code}")`) }).locator('td').nth(6);

test('waist: a T-shirt is shaped at the waist from the fit fields and the pattern handles, and a hoodie is not', async ({ page }) => {
  test.setTimeout(90000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await editor(page).locator('#fit-panel summary').click();
  const field = (name: string) => editor(page).getByLabel(`${name} (cm)`, { exact: true });
  // Unshaped, the waist is where the straight side seam crosses the default body's waist line.
  await expect(field('Waist width (½)')).toHaveValue('54');
  await expect(field('Waist position')).toHaveValue('41.5');
  await expect(pom(page, 'X')).toHaveCount(0);
  const outline = editor(page).locator('[data-piece="front"] polygon'), before = await outline.getAttribute('points');

  await field('Waist width (½)').fill('46');
  await editor(page).getByRole('button', { name: 'Apply fit', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Fit applied');
  await expect(pom(page, 'X')).toHaveText('46');
  await expect(pom(page, 'Y')).toHaveText('41.5');
  await expect(outline).not.toHaveAttribute('points', before!);
  expect((await backup(page)).product.fit).toEqual({ waistWidth: 46 });

  // On the pattern, the left waist handle narrows the waist and the right one lowers the waist line, each one Undo step.
  const waist = editor(page).locator('[data-fit-handle="waistWidth"]'), line = editor(page).locator('[data-fit-handle="waistPosition"]');
  await expect(waist).toHaveAttribute('aria-valuenow', '46');
  await waist.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pom(page, 'X')).toHaveText('45.5');
  await line.focus();
  await page.keyboard.press('ArrowDown');
  await expect(pom(page, 'Y')).toHaveText('42');
  expect((await backup(page)).product.fit).toEqual({ waistWidth: 45.5, waistPosition: 42 });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(pom(page, 'Y')).toHaveText('41.5');

  // An impossible waist is refused with the reason, and nothing changes.
  await field('Waist width (½)').fill('60');
  await editor(page).getByRole('button', { name: 'Apply fit', exact: true }).click();
  await expect(page.locator('#message')).toContainText('no wider than the chest');
  await expect(pom(page, 'X')).toHaveText('45.5');
  await editor(page).locator('#discard-product-drafts').click();
  await expect(field('Waist width (½)')).toHaveValue('45.5');

  // A hoodie is held by its hem band: no waist fields or handles.
  await editor(page).getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  await expect(page.locator('#message')).toContainText('Pullover hoodie template loaded');
  await expect(field('Waist width (½)')).toBeHidden();
  await expect(field('Waist position')).toBeHidden();
  await expect(editor(page).locator('[data-fit-handle="waistWidth"]')).toHaveCount(0);
});
