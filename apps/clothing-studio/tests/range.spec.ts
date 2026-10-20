import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const file = await wait; return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) }; }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).bytes.toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('colorways are saved, compared as renders, costed into a range plan, applied back and exported', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  // Before any colorway, the plan shows the current design.
  await expect(editor(page).locator('#range-table')).toContainText('Current design');

  await editor(page).getByLabel('Colorway name').fill('Ecru and red');
  await editor(page).getByRole('button', { name: 'Save as colorway' }).click();
  await expect(page.locator('#message')).toContainText('Saved the current styling as the colorway “Ecru and red”');
  // Restyle both sleeves navy, then save the second colorway.
  for (const part of ['Left sleeve', 'Right sleeve']) {
    await editor(page).getByRole('radio', { name: part }).check();
    await editor(page).getByRole('button', { name: 'Apply color #1f2a4f', exact: true }).click();
  }
  await editor(page).getByLabel('Colorway name').fill('Ecru and navy');
  await editor(page).getByRole('button', { name: 'Save as colorway' }).click();
  const cards = editor(page).getByRole('list', { name: 'Colorways' }).getByRole('listitem');
  await expect(cards).toHaveCount(2);
  // Each colorway has its own front render.
  for (const name of ['Ecru and red', 'Ecru and navy']) {
    const image = editor(page).getByRole('img', { name: `Front render of ${name}` });
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth), { timeout: 20000 }).toBeGreaterThan(100);
  }
  const sources = await editor(page).locator('img[data-colorway-thumb]').evaluateAll(nodes => nodes.map(node => (node as HTMLImageElement).src));
  expect(new Set(sources).size).toBe(2);

  // Units and costing feed the plan.
  await editor(page).getByLabel('Units for Ecru and red').fill('100');
  await editor(page).getByLabel('Units for Ecru and red').dispatchEvent('change');
  await editor(page).getByLabel('Units for Ecru and navy').fill('50');
  await editor(page).getByLabel('Units for Ecru and navy').dispatchEvent('change');
  await editor(page).getByRole('button', { name: 'Apply colorway details', exact: true }).click();
  await editor(page).getByRole('combobox', { name: 'Currency' }).selectOption('EUR');
  await editor(page).getByLabel('Retail price').fill('40');
  await editor(page).getByLabel('Slub jersey per m').fill('10');
  await editor(page).getByRole('button', { name: 'Apply costing' }).click();
  await expect(page.locator('#message')).toContainText('Costing applied');
  const table = editor(page).locator('#range-table');
  await expect(table).toContainText('Range plan (EUR)');
  await expect(table.locator('tr[data-range-row="c1"]')).toContainText('€40.00');
  await expect(table.locator('tr.range-total')).toContainText('150');
  await expect(table.locator('tr.range-total')).toContainText('€6000.00');
  const saved = (await backup(page)).product;
  expect(saved.colorways.map((c: { name: string; units: number }) => [c.name, c.units])).toEqual([['Ecru and red', 100], ['Ecru and navy', 50]]);
  expect(saved.costing).toMatchObject({ currency: 'EUR', retail: 40 });
  expect(saved.costing.fabricPrices['slub-160']).toBe(10);

  // Showing a colorway in the editor restyles the garment as one undoable edit.
  await editor(page).getByRole('button', { name: 'Show Ecru and red in the editor' }).click();
  expect((await backup(page)).product.parts.sleeveLeft.color).toBe('#b23a2e');
  await editor(page).getByRole('button', { name: 'Delete Ecru and navy' }).click();
  await expect(cards).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cards).toHaveCount(2);

  const workbook = await download(page, 'Download range plan (Excel) ↓');
  expect(workbook.name).toMatch(/-range-plan\.xlsx$/);
  expect(workbook.bytes.subarray(0, 2).toString()).toBe('PK');
  expect(workbook.bytes.toString('latin1')).toContain('Ecru and navy');

  // Undo schedules a new native save; export completion is not its durability boundary.
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(cards).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
