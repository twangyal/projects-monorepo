import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('describe a style: words become an editable style on one part or every part, with what was understood', async ({ page }) => {
  test.setTimeout(90000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  const prompt = editor(page).getByLabel('Describe a style', { exact: true });

  await prompt.fill('Navy breton stripe on heavyweight ecru jersey');
  await editor(page).getByRole('button', { name: 'Apply to this part', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('fabric: Heavyweight jersey');
  await expect(editor(page).locator('#part-material')).toHaveValue('jersey-240');
  await expect(editor(page).locator('#part-print')).toHaveValue('stripe');
  let saved = (await backup(page)).product;
  expect(saved.parts.front).toEqual({ material: 'jersey-240', color: '#efe8d8', print: { motif: 'stripe', color: '#1f2a4f', scaleCm: 2, layout: 'grid' } });
  expect(saved.parts.back.material).toBe('terry-300');

  // Every part, with an unknown word reported; rib trims keep their rib knit and stay plain.
  await prompt.fill('sparkly sage linen');
  await prompt.press('Enter');
  await expect(editor(page).locator('#describe-result')).toContainText('Not understood: sparkly');
  await editor(page).getByRole('button', { name: 'Apply to every part', exact: true }).click();
  saved = (await backup(page)).product;
  expect(saved.parts.back).toEqual({ material: 'linen-170', color: '#9fae91', print: null });
  expect(saved.parts.cuffLeft).toEqual({ material: 'rib-220', color: '#9fae91', print: null });

  // Nothing recognisable changes nothing; undo takes back the last description.
  await prompt.fill('something nice');
  await editor(page).getByRole('button', { name: 'Apply to this part', exact: true }).click();
  await expect(page.locator('#message')).toContainText('No fabric, colour or print');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  saved = (await backup(page)).product;
  expect(saved.parts.back.material).toBe('terry-300');
  expect(saved.parts.front.material).toBe('linen-170');
});

test('unapplied construction colors remain visible without recoloring the garment, and Undo restores the prior style', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  const prompt = editor(page).getByLabel('Describe a style', { exact: true });
  const before = (await backup(page)).product;
  await prompt.fill('washed black denim with red topstitching');
  await editor(page).getByRole('button', { name: 'Apply to this part', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('Not understood: red, topstitching');
  await expect(editor(page).locator('#describe-result')).toContainText('colour: washed black');
  const styled = (await backup(page)).product;
  expect(styled.parts.front.material).toBe('denim-340');
  expect(styled.parts.front.color).not.toBe('#b23a2e');
  expect(styled.parts.back).toEqual(before.parts.back);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).product).toEqual(before);

  await prompt.fill('red topstitching on black denim');
  await prompt.press('Enter');
  await expect(editor(page).locator('#describe-result')).toContainText('Not understood: red, topstitching');
  expect((await backup(page)).product.parts.front.color).toBe('#1c1c1e');
});


test('repeat-only descriptions update every printed part while plain rib trims remain unchanged', async ({ page }) => {
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Breton stripe template/ }).click();
  const before = (await backup(page)).product;
  await editor(page).getByLabel('Describe a style', { exact: true }).fill('half-drop 8 cm');
  await editor(page).getByRole('button', { name: 'Apply to every part', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('repeat size: 8 cm');
  const after = (await backup(page)).product;
  for (const [id, part] of Object.entries(before.parts) as [string, {print: Record<string, unknown> | null}][]) {
    expect(after.parts[id]).toEqual(part.print ? { ...part, print: { ...part.print, layout: 'half-drop', scaleCm: 8 } } : part);
  }
});
