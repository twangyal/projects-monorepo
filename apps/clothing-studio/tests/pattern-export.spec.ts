import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); const file = await wait; return { name: file.suggestedFilename(), text: (await readFile((await file.path())!)).toString() }; }

test('the pattern downloads as DXF for cutting software and as a 1:1 printable SVG', async ({ page }) => {
  await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  const dxf = await download(page, 'Download pattern (DXF) ↓');
  expect(dxf.name).toMatch(/-pattern\.dxf$/);
  expect(dxf.text.startsWith('0\nSECTION\n2\nHEADER\n')).toBe(true);
  expect(dxf.text.trimEnd().endsWith('0\nEOF')).toBe(true);
  expect(dxf.text.match(/\n0\nPOLYLINE\n8\nCUT\n/g)).toHaveLength(8);
  expect(dxf.text).toContain('\n1\nHem band\n');
  const svg = await download(page, 'Download printable pattern (SVG, 1:1) ↓');
  expect(svg.name).toMatch(/-pattern\.svg$/);
  expect(svg.text).toMatch(/^<svg[^>]+width="[\d.]+cm"/);
  // The printable file renders on its own with its pieces and scale square.
  const view = await page.context().newPage();
  await view.setContent(`<!doctype html><body style="margin:0">${svg.text}</body>`);
  await expect(view.locator('g[data-piece]')).toHaveCount(8);
  const square = await view.locator('rect').boundingBox();
  // 10 cm at CSS's 96 px per inch is about 378 px.
  expect(Math.round(square!.width)).toBeGreaterThan(370);
  expect(Math.round(square!.width)).toBeLessThan(385);
});
