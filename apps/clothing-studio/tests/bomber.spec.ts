import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function glbNodes(page: Page) {
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('the bomber jacket has a front zip and a rib stand collar, and loses the collar to become a zip sweatshirt', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Bomber jacket template/ }).click();
  const collar = page.getByRole('checkbox', { name: 'Rib stand collar', exact: true }), zip = page.getByRole('checkbox', { name: 'Front zip', exact: true });
  await expect(collar).toBeChecked();
  await expect(zip).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Polo collar and placket', exact: true })).toBeHidden();
  const saved = (await backup(page)).product;
  expect(saved.base).toBe('sweatshirt');
  expect(saved.options).toEqual({ hem: 'straight', chestPocket: false, zip: true, collar: true });
  expect(saved.parts.front.material).toBe('nylon-150');
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Collar', 'Zip']));
  await collar.uncheck();
  await expect(page.locator('#message')).toContainText('Stand collar removed');
  const ribbed = (await backup(page)).product;
  expect(ribbed.parts.neckband).toEqual(saved.parts.collar);
  expect(ribbed.parts.collar).toBeUndefined();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(collar).toBeChecked();
  // Unzipped, it is a pullover again, and the stand collar stays.
  await zip.uncheck();
  await expect(page.locator('#message')).toContainText('a pullover sweatshirt again');
  await expect(collar).toBeChecked();
});
