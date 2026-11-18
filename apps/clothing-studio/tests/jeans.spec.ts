import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function glbNodes(page: Page) {
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('jeans have a back yoke and back pockets, each a part of its own, which drape with the legs and come off or go on shorts', async ({ page }) => {
  test.setTimeout(240000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Jeans template/ }).click();
  const yoke = page.getByRole('checkbox', { name: 'Back yoke', exact: true }), pockets = page.getByRole('checkbox', { name: 'Back pockets', exact: true });
  await expect(yoke).toBeChecked();
  await expect(pockets).toBeChecked();
  await expect(editor(page).locator('#trouser-yoke-help')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Back yoke', exact: true })).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Back pockets', exact: true })).toHaveCount(1);
  await expect(editor(page).locator('#techpack-preview')).toContainText('Bar-tack the top corners'.toLowerCase());
  // In 3D, each is its own part, topstitched as jeans are.
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Back yoke', 'Back pockets', 'Back yoke stitching', 'Back pockets stitching']));
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body', { timeout: 150000 });

  // Taken off, the pockets leave the design; shorts can have them.
  await pockets.uncheck();
  await expect(page.locator('#message')).toContainText('Back pockets removed');
  const plain = await backup(page);
  expect(plain.product.options.backPockets).toBeUndefined();
  expect(plain.product.parts.backPocket).toBeUndefined();
  await editor(page).getByRole('button', { name: /^Use the Pull-on shorts template/ }).click();
  await expect(pockets).not.toBeChecked();
  await pockets.check();
  await expect(page.locator('#message')).toContainText('Back pockets added');
  expect((await backup(page)).product.parts.backPocket.material).toBe('linen-170');
});
