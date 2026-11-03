import { test, expect } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

async function backup(page: Page) { const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse(await readFile((await (await waiting).path())!, 'utf8')); }
async function download(page: Page, id: string) { const waiting = page.waitForEvent('download'); await page.locator(id).click(); return (await readFile((await (await waiting).path())!)).toString(); }

test('a pleated skirt: knife pleats from the template, box pleats by hand, pleat lines in the pattern, and a drape', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Pleated skirt template/ }).click();
  const style = editor.getByRole('combobox', { name: 'Pleats', exact: true }), count = editor.getByLabel('Number of pleats', { exact: true }), depth = editor.getByLabel('Pleat depth at the waist (cm)', { exact: true });
  await expect(style).toHaveValue('knife');
  await expect(count).toHaveValue('24');
  await expect(depth).toHaveValue('1.5');
  await expect(editor.locator('#techpack-preview')).toContainText('24 knife pleats (12 per panel)');
  // The pattern marks each pleat's fold line and the line it is folded to.
  const svg = await download(page, '#pattern-svg');
  expect(svg.match(/data-pleat-fold="front"/g)).toHaveLength(12);
  expect(svg).toContain('Blue solid: pleat fold line');
  // Box pleats with the depth left blank: about half as deep as they can be.
  await style.selectOption('box'); await count.fill('12'); await depth.fill('');
  await editor.locator('#apply-measurements').click();
  const saved = await backup(page);
  expect(saved.product.measurements).toEqual({ waist: 72, hem: 120, slant: 60, waistbandHeight: 4, pleats: { style: 'box', count: 12, depth: 1.5 } });
  await expect(depth).toHaveValue('1.5');
  await expect(editor.locator('#techpack-preview')).toContainText('12 box pleats (6 per panel), each box 6 cm wide');
  // Too deep for the spacing is refused with the reason, and nothing changes.
  await depth.fill('4'); await editor.locator('#apply-measurements').click();
  await expect(page.locator('#message')).toContainText('can fold at most 3 cm deep');
  expect((await backup(page)).product.measurements).toEqual(saved.product.measurements);
  await depth.fill('1.5'); await editor.locator('#apply-measurements').click();
  // The pressed pleats drape on a body.
  await editor.locator('#garment-drape-on').click();
  await expect(editor.locator('#garment-drape-status')).toContainText('held at the waistline', { timeout: 90000 });
  // No pleats takes them out again.
  await style.selectOption(''); await editor.locator('#apply-measurements').click();
  expect((await backup(page)).product.measurements).toEqual({ waist: 72, hem: 120, slant: 60, waistbandHeight: 4 });
  expect(errors).toEqual([]);
});
