import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function glbNodes(page: Page) {
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('the Oxford shirt has a button front and a shirt collar, can be worn open, and becomes a polo without the buttons', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const buttons = page.getByRole('checkbox', { name: 'Button front', exact: true }), collar = page.getByRole('checkbox', { name: 'Shirt collar', exact: true });
  const open = page.getByRole('checkbox', { name: 'Worn open', exact: true });
  await expect(buttons).toBeChecked();
  await expect(collar).toBeChecked();
  await expect(open).not.toBeChecked();
  const saved = (await backup(page)).product;
  expect(saved.options).toEqual({ hem: 'curved', chestPocket: true, buttons: true, collar: true });
  expect(saved.parts.collar.material).toBe('poplin-120');
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Collar', 'Placket', 'Buttons']));
  await open.check();
  await expect(page.locator('#message')).toContainText('the front halves part at the placket');
  expect((await backup(page)).product.options.zipOpen).toBe(true);
  // Without the buttons the open front closes, and the collar is a polo's again.
  await buttons.uncheck();
  await expect(page.locator('#message')).toContainText('Button front removed');
  await expect(page.getByRole('checkbox', { name: 'Polo collar and placket', exact: true })).toBeChecked();
  expect((await backup(page)).product.options).toEqual({ hem: 'curved', chestPocket: true, collar: true });
});
