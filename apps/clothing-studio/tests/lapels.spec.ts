import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function glbNodes(page: Page): Promise<string[]> {
  const bytes = await download(page, 'Export 3D model (GLB) ↓'), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('a blazer has notched lapels, styled on their own; a coat can gain them, and loses them when it stops being a coat', async ({ page }) => {
  test.setTimeout(150000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blazer template/ }).click();
  const lapels = page.getByRole('checkbox', { name: 'Notched lapels', exact: true }), coat = page.getByRole('checkbox', { name: 'Coat', exact: true });
  await expect(coat).toBeChecked();
  await expect(lapels).toBeChecked();
  await expect(editor(page).locator('#lapels-help')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Lapels', exact: true })).toHaveCount(1);
  await expect(page.getByRole('radio', { name: 'Placket', exact: true })).toHaveCount(0);
  // The tech pack sews the lapels and buttons the blazer from the break point; the pattern has the facing.
  const techpack = editor(page).locator('#techpack-preview');
  await expect(techpack).toContainText('Fronts and lapels');
  await expect(techpack).toContainText('from the top button at the break point down');
  await expect(techpack).toContainText('Lapel width');
  await expect(editor(page).locator('[data-piece="lapel"]')).toHaveCount(1);
  // In 3D: the lapels, their edge stitching and the buttons.
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Lapels', 'Lapels stitching', 'Buttons']));

  // The lapels are styled on their own from a description.
  await page.getByLabel('Describe a style', { exact: false }).first().fill('black lapels');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(page.locator('#describe-result')).toContainText('Lapels: colour: black');
  let saved = (await backup(page)).product;
  expect(saved.parts.lapel.color).not.toBe(saved.parts.front.color);

  // Taken off, the coat buttons up to its collar on a placket again.
  await lapels.uncheck();
  await expect(page.locator('#message')).toContainText('Lapels removed');
  await expect(page.getByRole('radio', { name: 'Placket', exact: true })).toHaveCount(1);
  saved = (await backup(page)).product;
  expect(saved.options.lapels).toBeUndefined();
  expect(saved.parts.lapel).toBeUndefined();
  await lapels.check();
  await expect(page.locator('#message')).toContainText('Notched lapels added');
  // No longer a coat, it is a shirt again: the lapels go, and the option is not offered.
  await coat.uncheck();
  await expect(page.locator('#message')).toContainText('it is a shirt again, without lapels');
  await expect(lapels).toBeHidden();
  saved = (await backup(page)).product;
  expect(saved.options.coat).toBeUndefined();
  expect(saved.options.lapels).toBeUndefined();
  expect(saved.parts.placket).toBeTruthy();
});
