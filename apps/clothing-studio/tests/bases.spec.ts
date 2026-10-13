import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');
const painted = (page: Page, fx: number, fy: number) => page.locator('#product-canvas').evaluate((node, [x, y]) => {
  const source = node as HTMLCanvasElement, c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d')!;
  g.drawImage(source, source.width * x - 4, source.height * y - 4, 8, 8, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) opaque++; return opaque;
}, [fx, fy]);

test('a hoodie and a sweatshirt are styled part by part, including hood, pocket and rib trims', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Pullover hoodie');
  const parts = editor(page).getByRole('radiogroup', { name: 'Garment parts' }).getByRole('radio');
  await expect(parts).toHaveCount(9);
  await expect(editor(page).getByRole('radio', { name: 'Hood' })).toBeVisible();
  await expect(editor(page).getByRole('radio', { name: 'Neck rib' })).toHaveCount(0);
  // The hood is drawn above the shoulders.
  await expect.poll(() => painted(page, 0.5, 0.3)).toBeGreaterThan(40);
  // Style the hood and pocket separately.
  await editor(page).getByRole('radio', { name: 'Hood' }).check();
  await editor(page).getByRole('button', { name: 'Apply color #b23a2e', exact: true }).click();
  await editor(page).getByRole('radio', { name: 'Pocket' }).check();
  await editor(page).getByRole('button', { name: 'Apply Gingham check print', exact: true }).click();
  let saved = (await backup(page)).product;
  expect(saved.base).toBe('hoodie');
  expect(saved.parts.hood.color).toBe('#b23a2e');
  expect(saved.parts.pocket.print.motif).toBe('gingham');
  expect(saved.parts.front.print).toBeNull();
  await expect(editor(page).locator('[data-piece="hood"]')).toHaveAttribute('aria-label', /^Hood, /);
  await expect(editor(page).locator('#techpack-preview')).toContainText('Kangaroo pocket');
  await expect(editor(page).locator('#product-neckline option[value=v]')).toHaveJSProperty('disabled', true);
  // Copying a style to every part keeps the rib trims in rib.
  await editor(page).getByRole('radio', { name: 'Front body' }).check();
  await editor(page).getByRole('button', { name: 'Apply color #9fae91', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Use this style on every part' }).click();
  saved = (await backup(page)).product;
  expect(saved.parts.cuffLeft.material).toBe('rib-220');
  expect(saved.parts.hood.color).toBe('#9fae91');

  // Switching to a sweatshirt template brings its own parts; the selected hood falls back to the front body.
  await editor(page).getByRole('radio', { name: 'Hood' }).check();
  page.once('dialog', dialog => dialog.accept());
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Crew sweatshirt');
  await expect(parts).toHaveCount(8);
  await expect(editor(page).locator('#inspector-heading')).toHaveText('Front body');
  await expect(editor(page).getByRole('radio', { name: 'Hem band' })).toBeVisible();
  await expect(editor(page).locator('#techpack-preview')).toContainText('Hem band height');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
