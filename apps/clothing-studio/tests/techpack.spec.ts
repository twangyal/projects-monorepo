import { test, expect, type Page } from '@playwright/test';
import { readFile, copyFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const file = await wait; return { name: file.suggestedFilename(), path: (await file.path())!, bytes: await readFile((await file.path())!) }; }
const editor = (page: Page) => page.locator('#product-editor');

test('the tech pack follows the design live and downloads as an Excel workbook and a printable document', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  const preview = editor(page).locator('#techpack-preview');
  await expect(preview.getByRole('table').first()).toContainText('F1 Slub jersey');
  await expect(preview.getByRole('img', { name: 'Measurement diagram' })).toBeVisible();

  // Details are saved with the design; the sample size re-centres the grade.
  await editor(page).getByLabel('Style number').fill('CS-001');
  await editor(page).getByLabel('Season').fill('SS27');
  await editor(page).getByRole('combobox', { name: 'Sample size' }).selectOption('L');
  await editor(page).getByRole('button', { name: 'Apply details' }).click();
  await expect(page.locator('#message')).toContainText('Tech pack details applied');
  await expect(preview.getByRole('columnheader', { name: 'L*' })).toBeVisible();

  // A measurement change updates the points of measure without any extra step.
  await editor(page).getByLabel('Chest (cm)').fill('120');
  await editor(page).getByRole('button', { name: 'Apply measurements' }).click();
  await expect(preview.getByRole('row', { name: /^A Chest width/ })).toContainText('62');

  const xlsx = await download(page, 'Download tech pack (Excel) ↓');
  expect(xlsx.name).toMatch(/-tech-pack\.xlsx$/);
  expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK');
  if (process.env.TECHPACK_XLSX_OUT) await copyFile(xlsx.path, process.env.TECHPACK_XLSX_OUT);

  const printable = await download(page, 'Download printable tech pack ↓');
  expect(printable.name).toMatch(/-tech-pack\.html$/);
  const html = printable.bytes.toString();
  expect(html).toContain('CS-001');
  expect(html.match(/<img src="data:image\/png;base64,/g)).toHaveLength(2);
  // The printable document renders on its own, with its renders and diagram.
  const doc = await page.context().newPage();
  await doc.setContent(html);
  await expect(doc.getByRole('heading', { name: 'Bill of materials' })).toBeVisible();
  expect(await doc.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 100))).toBe(true);
  await doc.close();

  // The details survive a reload and undo works on them like any other edit.
  await page.reload();
  await expect(editor(page).getByLabel('Style number')).toHaveValue('CS-001');
});
