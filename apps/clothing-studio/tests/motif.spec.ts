import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function download(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await download(page, 'Export project backup')).toString()); }
const editor = (page: Page) => page.locator('#product-editor');
/** Share of pixels in the middle of the 3D view that are close to the motif's red. */
const redShare = (page: Page) => page.locator('#product-canvas').evaluate(node => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 200; const x = c.getContext('2d')!;
  const source = node as HTMLCanvasElement; x.drawImage(source, source.width * 0.35, source.height * 0.4, source.width * 0.3, source.height * 0.3, 0, 0, 200, 200);
  const d = x.getImageData(0, 0, 200, 200).data; let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) red++; return red / (d.length / 4);
});

test('an uploaded motif repeats in the chosen layout and size on the 3D garment, the pattern and the tech pack', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Blank tee template/ }).click();
  await expect(editor(page).locator('#product-status')).toContainText('Editing Blank tee');
  const before = await redShare(page);
  // A red star with a transparent background.
  const star = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 120; const x = c.getContext('2d')!; x.fillStyle = '#d62828'; x.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 22 : 56, a = -Math.PI / 2 + i * Math.PI / 5; x.lineTo(60 + Math.cos(a) * r, 60 + Math.sin(a) * r); } x.closePath(); x.fill(); return c.toDataURL('image/png').split(',')[1]; });
  await editor(page).locator('#motif-file').setInputFiles({ name: 'red-star.png', mimeType: 'image/png', buffer: Buffer.from(star, 'base64') });
  await expect(page.locator('#message')).toContainText('“red-star” repeats on the front body');
  let saved = (await backup(page)).product;
  expect(saved.motifs).toHaveLength(1);
  expect(saved.motifs[0]).toMatchObject({ id: 'm1', name: 'red-star', width: 120, height: 120 });
  expect(saved.parts.front.print).toEqual({ motif: 'upload:m1', color: '#1f2a4f', scaleCm: 8, layout: 'grid' });
  await expect.poll(() => redShare(page), { timeout: 15000 }).toBeGreaterThan(before + 0.05);
  // The uploaded motif keeps its own colors; layout and size still apply.
  await expect(editor(page).locator('#print-color')).toBeDisabled();
  await editor(page).getByRole('combobox', { name: 'Repeat', exact: true }).selectOption('mirror');
  await editor(page).getByLabel('Repeat size (cm)').fill('5');
  await editor(page).getByLabel('Repeat size (cm)').dispatchEvent('change');
  expect((await backup(page)).product.parts.front.print).toMatchObject({ layout: 'mirror', scaleCm: 5 });
  // The same motif applies to another part from the library, and the pattern piece is filled with it.
  await editor(page).getByRole('radio', { name: 'Back body' }).check();
  await editor(page).getByRole('button', { name: 'Apply red-star print', exact: true }).click();
  expect((await backup(page)).product.parts.back.print.motif).toBe('upload:m1');
  await expect(editor(page).locator('#part-print')).toHaveValue('upload:m1');
  const tech = editor(page).locator('#techpack-preview');
  await expect(tech).toContainText('red-star print from supplied artwork in its own colours');
  // Removing the motif clears its prints in one undoable step.
  await editor(page).getByRole('button', { name: 'Remove motif red-star' }).click();
  saved = (await backup(page)).product;
  expect(saved.motifs).toBeUndefined();
  expect([saved.parts.front.print, saved.parts.back.print]).toEqual([null, null]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).product.parts.back.print.motif).toBe('upload:m1');
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(editor(page).getByRole('button', { name: 'Apply red-star print', exact: true })).toBeVisible();
  // The reloaded 5 cm mirror repeat draws smaller stars than the first 8 cm one, so less of the view is red.
  await expect.poll(() => redShare(page), { timeout: 15000 }).toBeGreaterThan(before + 0.02);
});
