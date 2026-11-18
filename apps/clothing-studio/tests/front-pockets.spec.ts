import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function glbNodes(page: Page) {
  const bytes = await download(page, 'Export 3D model (GLB) ↓'), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('jeans have scoop front pockets, their facings a part of their own, which come off or go on shorts', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Jeans template/ }).click();
  const fronts = page.getByRole('checkbox', { name: 'Front pockets', exact: true });
  await expect(fronts).toBeChecked();
  await expect(editor(page).locator('#front-pockets-help')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Front pockets', exact: true })).toHaveCount(1);
  // The tech pack measures and sews them, with pocketing for the bags; the pattern has the facing as a piece.
  await expect(editor(page).locator('#techpack-preview')).toContainText('Front pocket opening');
  await expect(editor(page).locator('#techpack-preview')).toContainText('Cotton twill pocketing');
  await expect(editor(page).locator('[data-piece="frontPocket"]')).toHaveCount(1);
  // In 3D the facings are their own part, topstitched along the opening as jeans are.
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Front pockets', 'Front pockets stitching']));

  // Taken off, they leave the design; shorts can have them, the facings starting in the front legs' style.
  await fronts.uncheck();
  await expect(page.locator('#message')).toContainText('Front pockets removed');
  const plain = (await backup(page)).product;
  expect(plain.options.frontPockets).toBeUndefined();
  expect(plain.parts.frontPocket).toBeUndefined();
  await editor(page).getByRole('button', { name: /^Use the Pull-on shorts template/ }).click();
  await expect(fronts).not.toBeChecked();
  await fronts.check();
  await expect(page.locator('#message')).toContainText('Front pockets added');
  const saved = (await backup(page)).product;
  expect(saved.options.frontPockets).toBe(true);
  expect(saved.parts.frontPocket).toEqual(saved.parts.front);
});
