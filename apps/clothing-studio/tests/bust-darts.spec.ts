import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }
const editor = (page: Page) => page.locator('#product-editor');

test('bust darts are set from the measurements, drawn on the front piece, sewn in the tech pack and undone', async ({ page }) => {
  test.setTimeout(120000);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await editor(page).getByRole('button', { name: /^Use the Oxford shirt template/ }).click();
  const intake = editor(page).getByLabel('Bust dart intake (cm, 0 for none)');
  await expect(intake).toBeVisible();
  await expect(intake).toHaveValue('0');
  await expect(editor(page).locator('#bust-dart-note')).toContainText('pointing up toward the bust');
  const front = page.locator('[data-piece="front"]').first();
  await expect(front.locator('.dart-line')).toHaveCount(0);
  const before = (await front.getAttribute('aria-label'))!;

  await intake.fill('2.5');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Measurements applied');
  expect((await backup(page)).product.measurements.bustDart).toBe(2.5);
  // A button front's half has its dart, drawn from the side seam to its point, and the piece is cut longer.
  await expect(front.locator('.dart-line')).toHaveCount(1);
  const height = (label: string) => Number(/by ([\d.]+) cm/.exec(label)![1]);
  expect(height((await front.getAttribute('aria-label'))!) - height(before)).toBeCloseTo(2.5, 5);
  await expect(editor(page).locator('#techpack-preview')).toContainText('Sew each dart from the side seam to its point');
  await expect(editor(page).locator('#techpack-preview')).toContainText('2.5 cm taken in at each side seam');

  // Out of range is refused and the darts stay; Undo takes them off again.
  await intake.fill('7');
  await editor(page).getByRole('button', { name: 'Apply measurements', exact: true }).click();
  await expect(page.locator('#message')).toContainText('Bust dart intake');
  expect((await backup(page)).product.measurements.bustDart).toBe(2.5);
  await editor(page).getByRole('button', { name: 'Discard all product drafts', exact: true }).click();
  await expect(intake).toHaveValue('2.5');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(intake).toHaveValue('0');
  await expect(front.locator('.dart-line')).toHaveCount(0);

  // A description adds them; a knit sweatshirt has no field for them.
  await editor(page).getByLabel('Describe a style', { exact: true }).fill('shirt with bust darts');
  await editor(page).getByRole('button', { name: 'Apply to the garment', exact: true }).click();
  await expect(editor(page).locator('#describe-result')).toContainText('bust darts: 2.5 cm taken in at each side seam');
  await expect(intake).toHaveValue('2.5');
  await editor(page).getByRole('button', { name: /^Use the Crew sweatshirt template/ }).click();
  await expect(intake).toBeHidden();
});
