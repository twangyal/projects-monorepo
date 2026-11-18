import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
async function glbNodes(page: Page) {
  const bytes = await download(page, 'Export 3D model (GLB) ↓'), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('jeans close with a fly and a buttoned waistband carrying belt loops; taken off, the waist is elasticated again, and shorts can have them', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Jeans template/ }).click();
  const fly = page.getByRole('checkbox', { name: 'Fly front', exact: true }), loops = page.getByRole('checkbox', { name: 'Belt loops', exact: true });
  await expect(fly).toBeChecked();
  await expect(loops).toBeChecked();
  await expect(loops).toBeEnabled();
  await expect(editor(page).locator('#fly-help')).toBeVisible();
  // A buttoned waist is measured fastened.
  await expect(editor(page).getByLabel('Waist, buttoned (cm)', { exact: true })).toHaveValue('76');
  await expect(page.getByRole('radio', { name: 'Belt loops', exact: true })).toHaveCount(1);
  // The tech pack measures the fly and lists its zip and button; the pattern has the belt loop strip.
  const techpack = editor(page).locator('#techpack-preview');
  await expect(techpack).toContainText('Fly opening');
  await expect(techpack).toContainText('17 mm metal shank (tack) button');
  await expect(techpack).not.toContainText('Waistband elastic');
  await expect(editor(page).locator('[data-piece="beltLoop"]')).toHaveCount(1);
  // In 3D: the loops, their bar tacks, the J-stitched fly on the front legs and the waistband's button.
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Belt loops', 'Belt loops stitching', 'Front legs stitching', 'Waistband button']));

  // Taken off, the fly takes the belt loops with it, and the waist is elasticated and measured relaxed again.
  await fly.uncheck();
  await expect(page.locator('#message')).toContainText('Fly front removed: the waistband is elasticated again, without belt loops');
  await expect(loops).not.toBeChecked();
  await expect(loops).toBeDisabled();
  await expect(editor(page).getByLabel('Waist, relaxed (cm)', { exact: true })).toHaveValue('76');
  await expect(techpack).toContainText('Waistband elastic');
  const plain = (await backup(page)).product;
  expect(plain.options.fly).toBeUndefined();
  expect(plain.options.beltLoops).toBeUndefined();
  expect(plain.parts.beltLoop).toBeUndefined();

  // Shorts can have both, the loops starting in the waistband's style.
  await editor(page).getByRole('button', { name: /^Use the Pull-on shorts template/ }).click();
  await expect(fly).not.toBeChecked();
  await expect(loops).toBeDisabled();
  await fly.check();
  await expect(page.locator('#message')).toContainText('Fly front added');
  await expect(loops).toBeEnabled();
  await loops.check();
  await expect(page.locator('#message')).toContainText('Belt loops added');
  const saved = (await backup(page)).product;
  expect(saved.options).toMatchObject({ fly: true, beltLoops: true });
  expect(saved.parts.beltLoop).toEqual(saved.parts.waistband);
});
