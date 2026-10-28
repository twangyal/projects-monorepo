import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { GarmentDrapeResult } from '../src/garment-drape.ts';

const field = (page: Page) => page.getByLabel('Waist-to-hip depth (cm, optional)', { exact: true });
async function setup(page: Page) {
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(() => {
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        if (String(args[0]).includes('garment-drape.worker')) this.addEventListener('message', event => {
          if (event.data.kind === 'result') Object.assign(window, { hipResult: event.data.result });
        });
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  if (!(await field(page).isVisible())) await page.getByText('Waist, hip, depth and height (optional)', { exact: true }).click();
  await expect(field(page)).toBeVisible();
}
async function backup(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export project backup', exact: true }).click();
  return JSON.parse(await readFile((await (await pending).path())!, 'utf8'));
}
const apply = (page: Page) => page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
async function hipResult(page: Page, depth: number) {
  await page.waitForFunction(depth => {
    const result = (window as unknown as { hipResult?: GarmentDrapeResult }).hipResult;
    return result?.body.landmarks && Math.abs(result.body.landmarks.waist! - result.body.landmarks.hip! - depth) < 1e-6;
  }, depth, { timeout: 60000 });
  return page.evaluate(() => (window as unknown as { hipResult: GarmentDrapeResult }).hipResult);
}

for (const width of [1440, 390]) test(`measured hip depth survives history, profiles and reload and changes actual skirt worker at ${width}px`, async ({ page }, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 }); await setup(page);
  await field(page).fill('18.5'); await apply(page);
  expect((await backup(page)).topBody.hipDepth).toBe(18.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(field(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(field(page)).toHaveValue('18.5');
  await field(page).fill('4.5'); await apply(page);
  await expect(page.locator('#message')).toContainText('hip depth');
  await expect(field(page)).toHaveValue('4.5'); expect((await backup(page)).topBody.hipDepth).toBe(18.5);
  await page.getByRole('button', { name: 'Discard all product drafts', exact: true }).click(); await expect(field(page)).toHaveValue('18.5');
  await page.getByText('Saved body profiles', { exact: true }).click();
  await page.getByLabel('Body profile name', { exact: true }).fill('Measured hip');
  await page.getByRole('button', { name: 'Save body as new profile', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download body profiles', exact: true }).click();
  const profiles = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(profiles.profiles[0].body.hipDepth).toBe(18.5);
  await field(page).fill('24'); await apply(page);
  await page.getByRole('button', { name: 'Use selected body profile', exact: true }).click(); await expect(field(page)).toHaveValue('18.5');
  await expect(page.locator('#save-state')).toHaveText('Locally saved'); await page.reload();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click(); await expect(field(page)).toHaveValue('18.5');
  await page.getByRole('button', { name: 'Templates', exact: true }).click(); await page.getByRole('button', { name: /^Use the Flared skirt template/ }).click();
  await expect(page.locator('#product-status')).toContainText('Editing Flared skirt');
  expect((await backup(page)).product.base).toBe('skirt');
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  if (!(await field(page).isVisible())) await page.getByText('Waist, hip, depth and height (optional)', { exact: true }).click();
  await page.getByLabel('Body waist girth (cm, optional)', { exact: true }).fill('70');
  await page.getByLabel('Body hip girth (cm, optional)', { exact: true }).fill('104'); await apply(page);
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  const first = await hipResult(page, 18.5);
  expect(first.parts.every(part => Object.values(part.positions).every(Number.isFinite))).toBe(true);
  await field(page).fill('24'); await apply(page); const second = await hipResult(page, 24);
  expect(second.body.waist).toBe(first.body.waist); expect(second.body.hip).toBe(first.body.hip);
  expect(Object.values(second.parts[0].positions)).not.toEqual(Object.values(first.parts[0].positions));
  await page.screenshot({ path: info.outputPath(`hip-depth-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('a measured hip below a trouser proxy crotch refuses the solve without changing its saved body or patterns', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await expect(page.locator('#product-status')).toContainText('Editing Straight trousers');
  expect((await backup(page)).product.base).toBe('trousers');
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  if (!(await field(page).isVisible())) await page.getByText('Waist, hip, depth and height (optional)', { exact: true }).click();
  const product = (await backup(page)).product;
  await field(page).fill('40'); await apply(page);
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('crotch', { timeout: 15000 });
  const after = await backup(page); expect(after.topBody.hipDepth).toBe(40); expect(after.product).toEqual(product);
});

test('trouser comparisons keep both measured hip depth and height, and a height-only edit retires the result', async ({ page }) => {
  test.setTimeout(120000); await setup(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  await expect(page.locator('#product-status')).toContainText('Editing Straight trousers');
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  if (!(await field(page).isVisible())) await page.getByText('Waist, hip, depth and height (optional)', { exact: true }).click();
  await page.getByLabel('Body waist girth (cm, optional)', { exact: true }).fill('70');
  await page.getByLabel('Body hip girth (cm, optional)', { exact: true }).fill('90');
  const height = page.getByLabel('Body height (cm, optional)', { exact: true });
  await height.fill('195'); await field(page).fill('18'); await apply(page);
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  const visible = await hipResult(page, 18); expect(visible.body.landmarks!.height).toBe(195);
  await page.getByText('Compare fabrics on this garment', { exact: true }).click();
  await page.getByRole('button', { name: 'Compare garment fabrics', exact: true }).click();
  await expect(page.locator('#garment-comparison-status')).toContainText('Comparison ready', { timeout: 60000 });
  const download = page.waitForEvent('download'); await page.locator('#garment-comparison-download').click();
  const data = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect.soft(data.body.height).toBe(195); expect(data.body.hipDepth).toBe(18);
  for (const candidate of data.candidates) expect.soft(candidate.result.body).toEqual(visible.body);
  await height.fill('185'); await apply(page);
  await expect(page.locator('#garment-comparison-download')).toBeDisabled();
  await expect(page.locator('#garment-comparison-results')).toBeEmpty();
});
