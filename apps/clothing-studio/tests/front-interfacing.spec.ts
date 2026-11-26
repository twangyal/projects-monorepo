import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, id: string) {
  const pending = page.waitForEvent('download');
  await page.locator(id).click();
  return readFile((await (await pending).path())!);
}
const backup = async (page: Page) => JSON.parse((await download(page, '#backup')).toString());

for (const width of [1280, 390]) test(`fused coat fronts follow cuts, history, descriptions and saved data at ${width}px`, async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 900 });
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await page.locator('#product-editor').getByRole('button', { name: /^Use the Blazer template/ }).click();
  const control = page.getByRole('checkbox', { name: 'Front interfacing', exact: true });
  await expect(control).toBeVisible();
  await control.check();
  const support = page.locator('[data-pattern-key="frontInterfacing"]');
  await expect(support).toHaveAccessibleName(/Front interfacing,.*75 gsm.*grain follows Front body/);
  await expect(support).toHaveAttribute('role', 'img');
  await expect(page.locator('#techpack-preview')).toContainText('I1 Front interfacing');
  await expect(page.locator('#techpack-preview')).toContainText('before sewing darts');
  await page.locator('#undo').click();
  await expect(control).not.toBeChecked(); await expect(support).toHaveCount(0);
  await page.locator('#redo').click(); await expect(control).toBeChecked();
  await page.getByRole('checkbox', { name: 'Lined', exact: true }).check();
  await page.locator('#part-list input[value="front"]').check();
  await page.getByLabel('Fabric grain angle (°)', { exact: true }).fill('32.5');
  await page.getByLabel('Fabric grain angle (°)', { exact: true }).press('Tab');
  await expect(support.locator('[data-grain]')).toHaveAttribute('data-angle', '32.5');
  await page.getByRole('combobox', { name: 'Pattern export size', exact: true }).selectOption('L');
  const svg = (await download(page, '#pattern-svg')).toString();
  expect(svg).toContain('Front interfacing'); expect(svg).toContain('75 gsm'); expect(svg).toContain('grain 32.5'); expect(svg).toContain('size L');
  const saved = (await backup(page)).product;
  expect(saved.options.interfacing).toBe(true); expect(saved.options.lining).toBe(true);
  expect(Object.keys(saved.parts)).not.toContain('frontInterfacing');
  await expect(page.locator('#save-state')).toContainText('Locally saved');
  await page.reload(); await expect(control).toBeChecked();
  expect((await backup(page)).product).toEqual(saved);
  const description = page.getByLabel('Describe a style', { exact: false }).first();
  await description.fill('"KEEP" on the front');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  const withArtwork = (await backup(page)).product;
  expect(withArtwork.artwork.length).toBeGreaterThan(0);
  await description.fill('"LOGO" on the front interfacing');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  expect((await backup(page)).product).toEqual(withArtwork);
  await description.fill('striped front interfacing');
  await page.locator('#describe-part').click();
  expect((await backup(page)).product).toEqual(withArtwork);
  await description.fill('no fused fronts');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(control).not.toBeChecked(); await expect(support).toHaveCount(0);
  expect((await backup(page)).product.options.lining).toBe(true);
  await page.locator('#undo').click(); await expect(control).toBeChecked();
  await page.getByRole('checkbox', { name: 'Coat', exact: true }).uncheck();
  await expect(control).toBeHidden(); expect((await backup(page)).product.options.interfacing).toBeUndefined();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the real outfit worker and GLB export keep an interfaced coat as one bonded front', async ({ page }) => {
  test.setTimeout(180000);
  await page.goto('/');
  const editor = page.locator('#product-editor');
  await editor.getByRole('button', { name: /^Use the Blazer template/ }).click();
  await page.getByRole('checkbox', { name: 'Front interfacing', exact: true }).check();
  await page.getByRole('combobox', { name: 'Wear with', exact: true }).selectOption({ label: 'Crew sweatshirt' });
  await page.locator('#garment-drape-on').click();
  await expect(page.locator('#garment-drape-status')).toContainText('Worn over the Crew sweatshirt', { timeout: 150000 });
  const glb = await download(page, '#product-glb');
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
  expect(json.nodes.some((node: { name?: string }) => /Front body/.test(node.name ?? ''))).toBe(true);
  // Plain visual backing follows the single bonded front; it is not another simulated garment.
  expect(json.nodes.filter((node: { extras?: { fusedSupport?: string } }) => node.extras?.fusedSupport).map((node: { extras: { fusedSupport: string } }) => node.extras.fusedSupport).sort()).toEqual(['front', 'lapel']);
  expect((await backup(page)).product.options.interfacing).toBe(true);
});
