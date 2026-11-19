import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function glbNodes(page: Page): Promise<string[]> {
  const bytes = await download(page, 'Export 3D model (GLB) ↓'), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('a blazer can be lined: the lining is styled on its own, shows inside in 3D, and is cut and bagged in', async ({ page }) => {
  test.setTimeout(150000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blazer template/ }).click();
  const lined = page.getByRole('checkbox', { name: 'Lined', exact: true });
  await expect(lined).not.toBeChecked();
  await expect(editor(page).locator('#lining-help')).toBeHidden();
  await lined.check();
  await expect(page.locator('#message')).toContainText('Lined: the body and sleeves are lined');
  await expect(editor(page).locator('#lining-help')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Lining', exact: true })).toHaveCount(1);
  // The pattern adds the lining's pieces, in the lining fabric; the tech pack buys it and bags it in.
  for (const [key, name] of [['liningFront', 'Front lining'], ['liningBack', 'Back lining'], ['liningSleeve', 'Sleeve lining']]) {
    await expect(page.locator(`#product-pieces [data-pattern-key="${key}"]`)).toHaveAccessibleName(new RegExp(`^${name},.*Viscose lining`));
  }
  const techpack = editor(page).locator('#techpack-preview');
  await expect(techpack).toContainText('Viscose lining');
  await expect(techpack).toContainText('bag it in');
  // In 3D the body and sleeves are lined inside.
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Front body lining', 'Back body lining', 'Left sleeve lining', 'Right sleeve lining']));

  // The lining is styled on its own from a description, and Undo takes it back.
  await page.getByLabel('Describe a style', { exact: false }).first().fill('burgundy lining');
  await page.getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(page.locator('#describe-result')).toContainText('Lining: colour: burgundy');
  let saved = (await backup(page)).product;
  expect(saved.options.lining).toBe(true);
  expect(saved.parts.lining.color).not.toBe(saved.parts.front.color);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await backup(page)).product.parts.lining.color).toBe(saved.parts.front.color);

  // Unlined, the pieces go; no longer a coat, the option is not offered.
  await lined.uncheck();
  await expect(page.locator('#message')).toContainText('Unlined again');
  await expect(page.locator('#product-pieces [data-pattern-key="liningFront"]')).toHaveCount(0);
  saved = (await backup(page)).product;
  expect(saved.options.lining).toBeUndefined();
  expect(saved.parts.lining).toBeUndefined();
  await page.getByRole('checkbox', { name: 'Coat', exact: true }).uncheck();
  await expect(lined).toBeHidden();
});
