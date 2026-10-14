import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return (await readFile((await (await wait).path())!)).toString(); }
const editor = (page: Page) => page.locator('#product-editor');

test('shorts and trousers take leg measurements, leg presets and their own parts, tech pack and pattern', async ({ page }) => {
  test.setTimeout(90000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Straight trousers');
  const parts = editor(page).getByRole('radiogroup', { name: 'Garment parts' }).getByRole('radio');
  await expect(parts).toHaveCount(3);
  await expect(editor(page).getByRole('radio', { name: 'Front legs' })).toBeChecked();
  // Leg measurements replace chest, length and sleeve; artwork placement is for tops.
  await expect(editor(page).getByLabel('Inseam (cm)', { exact: true })).toHaveValue('78');
  await expect(editor(page).getByLabel('Chest (cm)', { exact: true })).toBeHidden();
  await expect(editor(page).locator('#artwork-note')).toBeVisible();
  await expect(editor(page).locator('#artwork-controls')).toBeHidden();
  await expect(editor(page).locator('#techpack-preview')).toContainText('Back rise');
  await expect(editor(page).locator('[data-piece="front"]')).toHaveAttribute('aria-label', /^Front legs, /);

  // Style the waistband, shorten the legs with a preset, and change a measurement.
  await editor(page).getByRole('radio', { name: 'Waistband' }).check();
  await editor(page).getByRole('button', { name: 'Apply color #1c1c1e', exact: true }).click();
  await editor(page).getByRole('button', { name: 'Shorts, 18 cm inseam', exact: true }).click();
  await expect(editor(page).getByLabel('Inseam (cm)', { exact: true })).toHaveValue('18');
  await editor(page).getByLabel('Hip (cm)', { exact: true }).fill('110');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  await expect(editor(page).locator('#techpack-preview')).toContainText('Double-turn 1.5 cm');
  const saved = (await backup(page)).product;
  expect(saved.base).toBe('trousers');
  expect(saved.measurements).toEqual({ waist: 76, hip: 110, rise: 28, inseam: 18, legOpening: 42 });
  expect(saved.parts.waistband.color).toBe('#1c1c1e');
  // A waistband that cannot pass the hips is refused and nothing changes.
  await editor(page).getByLabel('Waist, relaxed (cm)', { exact: true }).fill('120');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('pull on over the hips');
  expect((await backup(page)).product.measurements.waist).toBe(76);

  const dxf = await download(page, 'Download pattern (DXF) ↓');
  expect(dxf).toContain('Front legs');
  expect(dxf).toContain('cut 2 (mirror)');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(editor(page).getByLabel('Inseam (cm)', { exact: true })).toHaveValue('18');

  // Back to a top: its measurements and artwork controls return.
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  await expect(editor(page).getByLabel('Chest (cm)', { exact: true })).toBeVisible();
  await expect(editor(page).locator('#artwork-controls')).toBeVisible();
  await expect(editor(page).getByLabel('Inseam (cm)', { exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
