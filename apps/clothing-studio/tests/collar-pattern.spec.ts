import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) {
  const ready = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await ready).path())!, 'utf8');
}

for (const width of [1280, 390]) test(`a shirt collar's linked fold and exported cutting guidance agree at ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const collar = page.locator('.pattern-piece[data-piece="collar"]');
  await expect(collar).toBeVisible();
  await expect(collar.locator('[data-fold="collar"]')).toHaveCount(1);
  const diagram = page.locator('#techpack-preview svg');
  await expect(diagram.locator('[data-fold="collar"]')).toHaveCount(1);
  const labelsFit = await diagram.evaluate(svg => {
    const outer = svg.getBoundingClientRect();
    return [...svg.querySelectorAll('[data-piece="collar"] text')].every(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= outer.left && rect.right <= outer.right && rect.top >= outer.top && rect.bottom <= outer.bottom;
    });
  });
  expect(labelsFit).toBe(true);
  const markup = await diagram.evaluate(svg => svg.outerHTML);
  const drawing = await page.context().newPage();
  await drawing.setContent(`<style>body{margin:0}svg{width:600px;height:auto}</style>${markup}`);
  await drawing.locator('svg').screenshot({ path: testInfo.outputPath('collar-diagram.png') });
  await drawing.close();
  const before = await collar.locator('polygon').getAttribute('points');
  const svg = await download(page, 'Download printable pattern (SVG, 1:1) ↓');
  expect(svg).toContain('data-fold="collar"');
  expect(svg).toContain('cut 2 (mirror)');
  const dxf = await download(page, 'Download pattern (DXF) ↓');
  expect(dxf).toContain('\n8\nFOLD\n');
  expect(dxf).toContain('cut 2 (mirror)');
  await page.getByRole('checkbox', { name: 'Worn open', exact: true }).check();
  await expect(collar.locator('polygon')).toHaveAttribute('points', before!);
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Worn open', exact: true })).toBeChecked();
  await expect(collar.locator('[data-fold="collar"]')).toHaveCount(1);
  await expect(collar.locator('polygon')).toHaveAttribute('points', before!);
  const view = await page.context().newPage();
  await view.setContent(svg);
  await expect(view.locator('g[data-piece="collar"]')).toBeVisible();
  expect(await view.locator('[data-fold="collar"]').evaluate(node => (node as SVGLineElement).getTotalLength())).toBeGreaterThan(0);
});
