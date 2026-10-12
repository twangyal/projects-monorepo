import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { rawProject, TINY, literalRaster } from '../oracle/color-fixtures.ts';
import { STRIPE_SETTINGS, tinyStripe } from '../oracle/stripe-fixtures.ts';
import type { Project, Raster } from '../../src/types.ts';

async function download(page: Page, selector: string): Promise<Buffer> {
  const event = page.waitForEvent('download'); await page.locator(selector).click();
  const path = await (await event).path(); if (!path) throw new Error('Expected an actual download');
  return readFile(path);
}
async function backup(page: Page): Promise<Project> { return JSON.parse((await download(page, '#download-project')).toString()) as Project; }
function pngMatches(bytes: Buffer, expected: Raster): void {
  const actual = PNG.sync.read(bytes); expect([actual.width, actual.height]).toEqual([expected.width, expected.height]);
  expect(actual.data).toEqual(Buffer.from(expected.rgba));
}
async function open(page: Page, project = rawProject(STRIPE_SETTINGS)): Promise<void> {
  await page.locator('#project-file').setInputFiles({ name: 'synthetic-context.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#project-title')).toHaveValue(project.title); await ready(page);
}
async function ready(page: Page): Promise<void> { await expect(page.locator('#preview-status')).toHaveText('Applied settings preview ready.'); }
async function apply(page: Page, mode: string): Promise<void> {
  await page.locator('#surround-mode').selectOption(mode); await page.locator('#apply-changes').click(); await ready(page);
}
test.beforeEach(async ({ page }) => { page.on('dialog', dialog => dialog.accept()); await page.goto('/'); await expect(page.locator('#project-file')).toBeEnabled(); });

test('striped workbench exports exact pixels and diagnostics, with reversible edits and complete reload retention', async ({ page }) => {
  await open(page); const before = await backup(page);
  await expect(page.locator('#surround-mode option[value="horizontal-stripes"]')).toHaveCount(1);
  await apply(page, 'horizontal-stripes'); const applied = await backup(page);
  expect(applied.image).toEqual(before.image); expect(applied.settings).toEqual({ ...STRIPE_SETTINGS, mode: 'horizontal-stripes' });
  pngMatches(await download(page, '#download-source'), { width: 3, height: 2, rgba: TINY });
  pngMatches(await download(page, '#download-result'), tinyStripe('horizontal'));
  const report = (await download(page, '#download-report')).toString();
  const embedded = [...report.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)]; expect(embedded).toHaveLength(2);
  pngMatches(Buffer.from(embedded[1]![1]!, 'base64'), tinyStripe('horizontal'));
  expect(report).toContain('horizontal-stripes'); expect(report).toContain('Stripe band pixels'); expect(report).not.toContain('<script>');
  await page.locator('#undo').click(); expect(await backup(page)).toEqual(before);
  await page.locator('#redo').click(); expect(await backup(page)).toEqual(applied);
  await expect(page.locator('#save-status')).toHaveText('Saved in this browser.');
  await page.reload(); await expect(page.locator('#surround-mode')).toHaveValue('horizontal-stripes'); expect(await backup(page)).toEqual(applied);
  await page.locator('#cell-size').fill('3'); await page.locator('#apply-changes').click(); await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#cell-size')).toHaveValue('3'); expect(await backup(page)).toEqual(applied);
});

test('named striped alternatives compare and download exact retained patterns while preserving an unsent editor draft', async ({ page }) => {
  await open(page); const original = await backup(page);
  for (const direction of ['horizontal', 'vertical'] as const) {
    await apply(page, `${direction}-stripes`); await page.locator('#variant-name').fill(`${direction} study`); await page.locator('#keep-variant').click();
    await expect(page.locator('#variant-list li')).toHaveCount(direction === 'horizontal' ? 1 : 2);
  }
  const committed = await backup(page); expect(committed.image).toEqual(original.image); expect(committed.variants).toHaveLength(2);
  await page.locator('#variant-first').selectOption('horizontal study'); await page.locator('#variant-second').selectOption('vertical study');
  await page.locator('#view-variant-pair').click(); await expect(page.locator('#named-preview')).toBeVisible();
  const pixels = await page.evaluate(() => ['named-first-canvas', 'named-second-canvas'].map(id => {
    const canvas = document.getElementById(id) as HTMLCanvasElement, context = canvas.getContext('2d')!;
    return [[0, 4], [4, 0]].map(([x, y]) => [...context.getImageData(x!, y!, 1, 1).data]);
  }));
  expect(pixels).toEqual([[[32,64,192,255],[224,112,32,255]],[[224,112,32,255],[32,64,192,255]]]);
  await page.locator('#border-size').fill('9');
  const report = (await download(page, '#download-variant-report')).toString(), embedded = [...report.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
  expect(embedded).toHaveLength(2); pngMatches(Buffer.from(embedded[0]![1]!, 'base64'), tinyStripe('horizontal')); pngMatches(Buffer.from(embedded[1]![1]!, 'base64'), tinyStripe('vertical'));
  await expect(page.locator('#border-size')).toHaveValue('9'); expect(await backup(page)).toEqual(committed);
  await page.locator('#discard-changes').click(); await expect(page.locator('#save-status')).toHaveText('Saved in this browser.');
  await page.reload(); expect(await backup(page)).toEqual(committed);
  await page.locator('#variant-list button').filter({ hasText: 'Restore' }).first().click(); await ready(page); await expect(page.locator('#surround-mode')).toHaveValue('horizontal-stripes');
});

test('vertical bands retain the full normalized asset at maximum output through mobile keyboard apply and real PNG download', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const raster = literalRaster(720, 720), project = rawProject({ border: 128, cellSize: 128, colorA: '#e07020', colorB: '#2040c0' }, 720, 720, raster.rgba);
  await open(page, project); await page.locator('#surround-mode').selectOption('vertical-stripes'); await page.locator('#apply-changes').press('Enter'); await ready(page);
  const applied = await backup(page); expect(applied.image).toEqual(project.image);
  const actual = PNG.sync.read(await download(page, '#download-result')); expect([actual.width, actual.height]).toEqual([976, 976]);
  const bands = 'ABABABAB';
  for (let band = 0; band < bands.length; band++) {
    const color = bands[band] === 'A' ? [224,112,32,255] : [32,64,192,255];
    expect([...actual.data.subarray(band * 128 * 4, band * 128 * 4 + 4)]).toEqual(color);
  }
  for (let y = 0; y < 720; y++) expect(actual.data.subarray(((y + 128) * 976 + 128) * 4, ((y + 128) * 976 + 848) * 4)).toEqual(Buffer.from(raster.rgba.subarray(y * 2880, (y + 1) * 2880)));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('striped-surround-mobile.png'), fullPage: true });
});
