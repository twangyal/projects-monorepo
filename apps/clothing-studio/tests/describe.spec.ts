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
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
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
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('repeat size: 8 cm');
  const after = (await backup(page)).product;
  for (const [id, part] of Object.entries(before.parts) as [string, {print: Record<string, unknown> | null}][]) {
    expect(after.parts[id]).toEqual(part.print ? { ...part, print: { ...part.print, layout: 'half-drop', scaleCm: 8 } } : part);
  }
});

test('whole-garment repeat changes also work from a selected plain neckband and reject entirely unapplied prompts', async ({ page }) => {
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Breton stripe template/ }).click();
  await editor(page).getByRole('radio', { name: 'Neck rib', exact: true }).click();
  const before = (await backup(page)).product;
  const prompt = editor(page).getByLabel('Describe a style', { exact: true });
  await prompt.fill('half-drop 8 cm');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('repeat size: 8 cm');
  const after = (await backup(page)).product;
  expect(after.parts.front.print).toEqual({ ...before.parts.front.print, layout: 'half-drop', scaleCm: 8 });
  expect(after.parts.neckband).toEqual(before.parts.neckband);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).product).toEqual(before);
  await prompt.fill('unrecognized imaginary fabric');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(page.locator('#message')).toContainText('could be applied');
  expect((await backup(page)).product).toEqual(before);
});

test('a garment description chooses the garment, styles the parts it names and the rest of the garment, and Undo restores it', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Ringer tee template/ }).click();
  const before = (await backup(page)).product;
  const prompt = editor(page).getByLabel('Describe a style', { exact: true });
  await prompt.fill('oversized navy hoodie with a cream hood and white cuffs, small chest logo');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  const result = editor(page).locator('#describe-result');
  await expect(result).toContainText('Garment: garment: Pullover hoodie, started from its template; fit: 124 cm chest');
  await expect(result).toContainText('Whole garment: colour: navy');
  await expect(result).toContainText('Hood: colour: cream');
  await expect(result).toContainText('Left cuff, Right cuff: colour: white');
  await expect(result).toContainText('Not applied: small, chest, logo');
  const hoodie = (await backup(page)).product;
  expect([hoodie.base, hoodie.measurements.chest, hoodie.parts.front.color, hoodie.parts.hood.color, hoodie.parts.cuffLeft.color, hoodie.parts.cuffLeft.material])
    .toEqual(['hoodie', 124, '#1f2a4f', '#f1e8d0', '#f7f7f4', 'rib-220']);
  await expect(editor(page).getByRole('radio', { name: 'Hood', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).product).toEqual(before);

  // On the same garment, named parts change and nothing else does.
  await prompt.fill('red linen sleeves with a white collar');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  const tee = (await backup(page)).product;
  expect(tee.parts.sleeveLeft).toEqual({ material: 'linen-170', color: '#b23a2e', print: null });
  expect(tee.parts.neckband.color).toBe('#f7f7f4');
  expect(tee.parts.front).toEqual(before.parts.front);
});
