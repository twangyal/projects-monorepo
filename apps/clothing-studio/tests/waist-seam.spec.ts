import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
async function glbNodes(page: Page) {
  const wait = page.waitForEvent('download'); await page.locator('#product-glb').click();
  const bytes = await readFile((await (await wait).path())!), json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  return json.nodes.map((node: { name?: string }) => node.name);
}
const editor = (page: Page) => page.locator('#product-editor');

test('the fit-and-flare dress is cut at the waist into a bodice and a skirt that are styled, patterned and sewn apart', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Fit-and-flare dress template/ }).click();
  const seam = page.getByRole('checkbox', { name: 'Waist seam (a dress cut into bodice and skirt)', exact: true });
  await expect(seam).toBeChecked();
  await expect(editor(page).locator('#waist-seam-help')).toBeVisible();
  let saved = (await backup(page)).product;
  expect(saved.options).toEqual({ hem: 'straight', chestPocket: false, waistSeam: true });
  expect(saved.parts.skirtFront.print.motif).toBe('dots');
  expect(saved.parts.front.print).toBeNull();
  // The skirt pieces are their own pattern pieces, 3D parts and tech pack step.
  await expect(editor(page).locator('[data-piece="skirtFront"]')).toHaveCount(1);
  await expect(editor(page).locator('[data-piece="skirtBack"]')).toHaveCount(1);
  expect(await glbNodes(page)).toEqual(expect.arrayContaining(['Front skirt', 'Back skirt']));
  await expect(editor(page).locator('#techpack-preview')).toContainText('Waist seam');
  // The hem width is set on the skirt piece, where the hem is.
  const hem = editor(page).locator('[data-fit-handle="hemWidth"]');
  await expect(hem).toHaveAttribute('data-fit-part', 'skirtFront');
  await expect(hem).toHaveAttribute('aria-valuenow', '76');
  await hem.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#message')).toContainText('Hem width (½) 76.5 cm');
  expect((await backup(page)).product.fit.hemWidth).toBe(76.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();

  // Without the seam the body is one piece again, and Undo brings the styled skirt back.
  await seam.uncheck();
  await expect(page.locator('#message')).toContainText('Waist seam removed');
  saved = (await backup(page)).product;
  expect(saved.options.waistSeam).toBeUndefined();
  expect(saved.parts.skirtFront).toBeUndefined();
  await expect(editor(page).locator('[data-piece="skirtFront"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(seam).toBeChecked();
  expect((await backup(page)).product.parts.skirtFront.print.motif).toBe('dots');

  // A tee is not long enough for one: the box is there but off until it is a dress.
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(seam).toBeVisible();
  await expect(seam).toBeDisabled();
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  await expect(seam).toBeHidden();
});
