import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, id: string) {
  const wait = page.waitForEvent('download'); await page.locator(id).click(); const file = await wait;
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}
async function backup(page: Page) { return JSON.parse((await download(page, '#backup')).text); }
async function svgDimensions(page: Page, text: string) {
  return page.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const points = doc.querySelector('g[data-piece="front"] polygon:nth-child(2)')!.getAttribute('points')!.split(' ').map(p => p.split(',').map(Number));
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }, text);
}
function dxfFront(text: string) {
  const sew = text.split('0\nPOLYLINE\n8\nSEW\n')[1].split('0\nSEQEND')[0];
  const points = [...sew.matchAll(/0\nVERTEX\n8\nSEW\n10\n([^\n]+)\n20\n([^\n]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  return { width: Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])), height: Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])) };
}
for (const width of [1280, 390]) test(`graded SVG and DXF use the selected size without editing the sample at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  const before = await backup(page);
  await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('M');
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('L');
  await expect(page.getByRole('combobox', { name: 'Size shown', exact: true })).toHaveValue('M');
  const svg = await download(page, '#pattern-svg'), dxf = await download(page, '#pattern-dxf');
  expect(svg.name).toMatch(/-size-L-pattern\.svg$/); expect(dxf.name).toMatch(/-size-L-pattern\.dxf$/);
  expect(svg.text).toContain('size L'); expect(dxf.text).toContain('size L');
  const dimensions = await svgDimensions(page, svg.text);
  expect(dimensions.width).toBeCloseTo(56.5, 2); expect(dimensions.height).toBeCloseTo(73.5, 2);
  const mm = dxfFront(dxf.text); expect(mm.width).toBeCloseTo(565, 2); expect(mm.height).toBeCloseTo(735, 2);
  expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('L');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await backup(page)).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('non-M sample and edited fit grade into the export, while unsupported sizes never fall back', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  const design = await backup(page); design.product = { ...(await import('../src/product.ts')).template('blank'), spec: { styleNumber: '', season: '', sampleSize: 'S' }, fit: { hemWidth: 60 } };
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'size-s.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) });
  await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('S');
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('M');
  const file = await download(page, '#pattern-svg'); const dimensions = await svgDimensions(page, file.text);
  expect(dimensions.width).toBeCloseTo(62.5, 2); expect(dimensions.height).toBeCloseTo(73.5, 2); expect(file.text).toContain('size M');
  expect(await backup(page)).toEqual(design);
  design.product.measurements.chest = 146; delete design.product.fit;
  await page.getByLabel('Import project backup', { exact: true }).setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(design)) });
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('XL');
  const downloads: string[] = []; page.on('download', d => downloads.push(d.suggestedFilename()));
  await page.locator('#pattern-svg').click(); await expect(page.locator('#message')).toContainText('Size XL would be outside');
  await page.locator('#pattern-dxf').click(); await expect(page.locator('#message')).toContainText('Size XL would be outside');
  expect(downloads).toEqual([]);
  await page.getByRole('button', { name: /^Use the Flared skirt template/ }).click();
  await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('M');
  await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('M');
  const skirt = await download(page, '#pattern-svg'); expect(skirt.name).toMatch(/-pattern\.svg$/); expect(skirt.name).not.toContain('-size-'); expect(skirt.text).toContain('size M');
  // Reload only after persistence finishes; the confirmation handler would otherwise accept leaving unsaved work.
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload(); await expect(page.getByRole('combobox', { name: 'Pattern export size', exact: true })).toHaveValue('M');
});
