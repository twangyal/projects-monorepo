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

test('fit handles: drag the shoulder point and nudge the hem corner by keyboard on the pattern piece', async ({ page }) => {
  test.setTimeout(90000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  const shoulder = editor(page).getByRole('slider', { name: 'Shoulder point: Shoulder width' });
  await expect(shoulder).toHaveAttribute('aria-valuenow', '48.4');
  // Dragging the left shoulder point outward widens the shoulders; the readout follows the drag.
  await shoulder.scrollIntoViewIfNeeded();
  const box = (await shoulder.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 6, box.y + box.height / 2, { steps: 4 });
  await expect(editor(page).locator('.fit-readout')).toContainText('Shoulder width');
  await page.mouse.up();
  await expect(page.locator('#message')).toContainText('Shoulder width');
  const widened = Number(await editor(page).getByRole('slider', { name: 'Shoulder point: Shoulder width' }).getAttribute('aria-valuenow'));
  expect(widened).toBeGreaterThan(48.4);
  expect(widened * 2 % 1).toBe(0);
  await expect(pom(page, 'E')).toHaveText(String(widened));

  // Keyboard: two left arrows widen the hem by 1 cm, and focus stays on the handle.
  const hem = editor(page).getByRole('slider', { name: 'Hem corner: Hem width (½)' });
  await hem.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(editor(page).getByRole('slider', { name: 'Hem corner: Hem width (½)' })).toHaveAttribute('aria-valuenow', '55');
  await expect(pom(page, 'I')).toHaveText('55');
  await expect(editor(page).getByRole('slider', { name: 'Hem corner: Hem width (½)' })).toBeFocused();
  const saved = (await backup(page)).product;
  expect(saved.fit).toEqual({ shoulderWidth: widened, hemWidth: 55 });
  // Undo takes back the last nudge.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(pom(page, 'I')).toHaveText('54.5');
});
