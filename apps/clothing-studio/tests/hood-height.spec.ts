import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
async function download(page: Page, name: string) {
  const waiting = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await waiting).path())!);
}
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function setup(page: Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the Pullover hoodie template/ }).click();
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await page.locator('#fit-panel summary').click();
}
const height = (page: Page) => page.getByLabel('Hood side height (cm)', { exact: true });
function hoodPositions(glb: Buffer) {
  const length = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + length).toString());
  const node = json.nodes.find((n: { name: string }) => n.name === 'Hood');
  const accessor = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView], offset = 28 + length + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  return Array.from({ length: accessor.count * 3 }, (_, i) => glb.readFloatLE(offset + i * 4));
}
test('hood side height reaches pattern GLB tech pack and exact saved history', async ({ page }) => {
  await setup(page); await expect(height(page)).toBeVisible(); const original = await backup(page);
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  const prior = hoodPositions(await download(page, 'Export 3D model (GLB) ↓'));
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await height(page).fill('40'); await page.locator('#apply-fit').click(); await expect(page.locator('#message')).toContainText('Fit applied');
  const saved = await backup(page); expect(saved.product.fit).toEqual({ hoodHeight: 40 });
  const actual = await page.locator('[data-piece="hood"] polygon').evaluate(p => (p as SVGGraphicsElement).getBBox().height);
  expect(actual).toBe(40);
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  const changed = hoodPositions(await download(page, 'Export 3D model (GLB) ↓'));
  expect(changed.length).toBe(prior.length);
  const ys = (values: number[]) => values.filter((_, i) => i % 3 === 1);
  expect(Math.max(...ys(changed)) - Math.max(...ys(prior))).toBeCloseTo(8, 5);
  for (let i = 0; i < prior.length; i++) if (i % 3 !== 1) expect(changed[i]).toBe(prior[i]);
  await page.getByRole('button', { name: 'Tech pack', exact: true }).click();
  await expect(page.locator('#techpack-preview tr').filter({ has: page.locator('td:first-child:text-is("K")') }).locator('td').nth(6)).toHaveText('40');
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).product).toEqual(original.product);
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload(); expect((await backup(page)).product).toEqual(saved.product);
});
test('phone hood draft survives navigation refuses invalid values and resets without leaking to other tops', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 }); await setup(page); await expect(height(page)).toBeVisible(); const before = await backup(page);
  await height(page).fill('44.5'); await height(page).press('ArrowDown'); await expect(height(page)).toHaveValue('44');
  await height(page).fill('44.5'); await page.getByRole('button', { name: 'Materials & prints', exact: true }).click();
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click(); await expect(height(page)).toHaveValue('44.5');
  await page.locator('#apply-fit').click(); await expect(page.locator('#message')).toContainText('Hood side height'); expect(await backup(page)).toEqual(before);
  await height(page).fill('24'); await page.locator('#apply-fit').click(); await page.locator('#reset-fit').click(); await expect(height(page)).toHaveValue('32');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(height(page)).toHaveValue('24');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await height(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('hood-height-phone.png') });
  await page.getByRole('button', { name: 'Templates', exact: true }).click(); page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await expect(height(page)).toBeHidden(); await expect(height(page)).toBeDisabled(); expect((await backup(page)).product.fit).toBeUndefined();
});

test('edited hood builds a real owned drape and exports its captured mesh', async ({ page }) => {
  test.setTimeout(90000);
  await setup(page); await height(page).fill('40'); await page.locator('#apply-fit').click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click();
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body', { timeout: 60000 });
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  const positions = hoodPositions(await download(page, 'Export 3D model (GLB) ↓'));
  expect(positions.length).toBeGreaterThan(100); expect(positions.every(Number.isFinite)).toBe(true);
  expect((await backup(page)).product.fit).toEqual({ hoodHeight: 40 });
  await page.getByRole('button', { name: 'Patterns & measurements', exact: true }).click();
  await height(page).fill('24'); await page.locator('#apply-fit').click();
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body', { timeout: 60000 });
  await page.getByRole('button', { name: 'Exports', exact: true }).click();
  const changed = hoodPositions(await download(page, 'Export 3D model (GLB) ↓'));
  expect(changed.length).toBe(positions.length); expect(changed).not.toEqual(positions);
  expect(changed.every(Number.isFinite)).toBe(true); expect((await backup(page)).product.fit).toEqual({ hoodHeight: 24 });
});
