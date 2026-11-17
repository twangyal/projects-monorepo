import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function glbNodes(page: Page) {
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('a shirt gets a back yoke that is styled, patterned and sewn on its own, and coloured by description', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const yoke = page.getByRole('checkbox', { name: 'Back yoke', exact: true });
  await expect(yoke).not.toBeChecked();
  await yoke.check();
  await expect(page.locator('#message')).toContainText('Back yoke added');
  await expect(editor(page).locator('#yoke-help')).toBeVisible();
  let saved = (await backup(page)).product;
  expect(saved.options.yoke).toBe(true);
  expect(saved.parts.yoke).toEqual(saved.parts.back);
  // Its own pattern piece, cut double, 3D part and tech pack step.
  await expect(editor(page).locator('[data-piece="yoke"]')).toHaveCount(1);
  await expect(editor(page).locator('[data-piece="yoke"]')).toHaveAttribute('aria-label', /^Back yoke, /);
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Back yoke']));
  await expect(editor(page).locator('#techpack-preview')).toContainText('Sew the back body between the outer yoke and its facing');

  // Described: a navy yoke is coloured on its own.
  await editor(page).getByLabel('Describe a style', { exact: true }).fill('navy yoke');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  saved = (await backup(page)).product;
  expect(saved.parts.yoke.color).toBe('#1f2a4f');
  expect(saved.parts.back.color).not.toBe('#1f2a4f');

  // Without the button front there is no shirt to yoke: the box goes, and so does the yoke.
  await page.getByRole('checkbox', { name: 'Button front', exact: true }).uncheck();
  await expect(yoke).toBeHidden();
  saved = (await backup(page)).product;
  expect(saved.options.yoke).toBeUndefined();
  expect(saved.parts.yoke).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(yoke).toBeChecked();
});
