import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('trousers get ankle cuffs as joggers, carried by the 3D model, and lose them again', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Straight trousers template/ }).click();
  const cuff = page.getByLabel('Ankle cuff height (cm, 0 for none)', { exact: true });
  await expect(cuff).toHaveValue('0');
  await cuff.fill('8');
  await page.getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  const saved = (await backup(page)).product;
  expect(saved.measurements.cuffHeight).toBe(8);
  expect(Object.keys(saved.parts)).toEqual(expect.arrayContaining(['cuffLeft', 'cuffRight']));
  expect(saved.parts.cuffLeft.material).toBe('rib-220');
  // The 3D model has both cuffs.
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const names = json.nodes.map((node: { name?: string }) => node.name);
  expect(names).toEqual(expect.arrayContaining(['Left ankle cuff', 'Right ankle cuff']));
  // An impossible height is refused and leaves the design alone; 0 takes the cuffs off.
  await cuff.fill('20');
  await page.getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Ankle cuff height must be from 4 to 12 cm');
  await cuff.fill('0');
  await page.getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  expect((await backup(page)).product.measurements.cuffHeight).toBeUndefined();
});
