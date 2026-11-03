import { test, expect } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';

async function backup(page: Page) { const waiting = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse(await readFile((await (await waiting).path())!, 'utf8')); }
async function download(page: Page, id: string) { const waiting = page.waitForEvent('download'); await page.locator(id).click(); return (await readFile((await (await waiting).path())!)).toString(); }

test('a pencil skirt is fitted to the hip with darts, marked in its pattern, drapes, and becomes flared without a hip', async ({ page }) => {
  test.setTimeout(180000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Pencil skirt template/ }).click();
  const hip = editor.getByLabel('Fitted hip (cm)', { exact: true });
  await expect(hip).toHaveValue('96');
  await expect(editor.locator('#techpack-preview')).toContainText('4 darts per panel');
  await expect(editor.locator('#techpack-preview')).toContainText('Hip circumference');
  // The pattern marks each dart's two legs.
  const svg = await download(page, '#pattern-svg');
  expect(svg.match(/data-dart="front"/g)).toHaveLength(4);
  expect(svg).toContain('V from the waist: a dart');
  // A smaller hip needs only two darts a panel.
  await hip.fill('88'); await editor.locator('#apply-measurements').click();
  expect((await backup(page)).product.measurements).toEqual({ waist: 70, hem: 90, slant: 60, waistbandHeight: 3, hip: 88 });
  await expect(editor.locator('#techpack-preview')).toContainText('2 darts per panel');
  // Too narrow a hem for the hip is refused with the reason.
  await editor.getByLabel('Skirt hem circumference (cm)', { exact: true }).fill('60'); await editor.locator('#apply-measurements').click();
  await expect(page.locator('#message')).toContainText('hem');
  await editor.getByLabel('Skirt hem circumference (cm)', { exact: true }).fill('90');
  await editor.locator('#apply-measurements').click();
  await editor.locator('#garment-drape-on').click();
  await expect(editor.locator('#garment-drape-status')).toContainText('held at the waistline', { timeout: 90000 });
  // Without a hip it is a flared skirt again.
  await hip.fill(''); await editor.locator('#apply-measurements').click();
  expect((await backup(page)).product.measurements).toEqual({ waist: 70, hem: 90, slant: 60, waistbandHeight: 3 });
  expect(errors).toEqual([]);
});
