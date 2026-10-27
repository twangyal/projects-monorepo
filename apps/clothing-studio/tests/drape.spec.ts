import { test, expect, type Page } from './helpers/expanded-workspace.ts';
import { readFile } from 'node:fs/promises';

async function bytes(page: Page, name: string) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await wait).path())!); }
async function backup(page: Page) { return JSON.parse((await bytes(page, 'Export project backup')).toString()); }
async function simulate(page: Page) {
  await page.getByRole('button', { name: 'Simulate drape', exact: true }).click();
  await expect(page.locator('#drape-status')).toContainText('Drape simulated', { timeout: 40000 });
  return Number((await page.locator('#drape-metrics').textContent())!.match(/(\d+) folds/)![1]);
}

test('a measured skirt drapes by fabric on the body proxy, exports its draped surface, and keeps fabric through history and reload', async ({ page }) => {
  test.setTimeout(150000);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Simulate drape', exact: true })).toBeDisabled();
  await page.getByLabel('Hem circumference (cm)', { exact: true }).fill('180');
  await page.getByRole('button', { name: 'Apply measured pattern', exact: true }).click();
  const before = await backup(page);
  expect(before.construction.fabric).toBeUndefined();

  const cottonFolds = await simulate(page);
  await expect(page.locator('#drape-view [data-drape-face]')).toHaveCount(24 * 96);
  await expect(page.locator('#drape-metrics')).toContainText('(assumed — apply body measurements to use yours)');
  const obj = (await bytes(page, 'Export draped OBJ')).toString();
  expect(obj.match(/^v /gm)).toHaveLength(25 * 96);
  expect(obj.match(/^f /gm)).toHaveLength(24 * 96);
  expect(obj).toContain('g Front_Panel'); expect(obj).toContain('g Back_Panel');
  // The waist row stays at the waistline; the hem hangs below the waist.
  const vertices = obj.split('\n').filter(line => line.startsWith('v ')).map(line => line.split(' ').slice(1).map(Number));
  expect(vertices.slice(0, 96).every(([, y]) => Math.abs(y!) < 1e-6)).toBe(true);
  expect(Math.min(...vertices.slice(24 * 96).map(([, y]) => y!))).toBeGreaterThan(50);

  // Rotation is view-only.
  const view = await page.locator('#drape-view').innerHTML();
  await page.getByRole('button', { name: 'Rotate drape right', exact: true }).click();
  expect(await page.locator('#drape-view').innerHTML()).not.toBe(view);
  expect(await backup(page)).toEqual(before);

  // Fabric is one undoable saved edit; stiffer denim forms fewer folds than fluid chiffon.
  await page.getByLabel('Fabric', { exact: true }).selectOption('denim-340');
  await expect(page.locator('#drape-status')).toContainText('Simulate again');
  await expect(page.getByRole('button', { name: 'Export draped OBJ', exact: true })).toBeDisabled();
  expect((await backup(page)).construction.fabric).toBe('denim-340');
  const denimFolds = await simulate(page);
  await page.getByLabel('Fabric', { exact: true }).selectOption('chiffon-50');
  const chiffonFolds = await simulate(page);
  expect(chiffonFolds).toBeGreaterThan(denimFolds);
  expect(cottonFolds).toBeGreaterThanOrEqual(denimFolds);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await backup(page)).construction.fabric).toBe('denim-340');
  // Pattern edits keep the chosen fabric.
  await page.getByLabel('Slant seam length (cm)', { exact: true }).fill('55');
  await page.getByRole('button', { name: 'Apply measured pattern', exact: true }).click();
  expect((await backup(page)).construction).toMatchObject({ slant: 55, fabric: 'denim-340' });
  await expect(page.locator('#save-state')).toHaveText('Locally saved');
  await page.reload();
  await expect(page.getByLabel('Fabric', { exact: true })).toHaveValue('denim-340');
});

test('simulation uses entered body measurements, can be cancelled, and fits a phone screen', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Apply measured pattern', exact: true }).click();
  await page.getByLabel('Use body measurements', { exact: true }).check();
  await page.getByLabel('Body waist circumference (cm)', { exact: true }).fill('76');
  await page.getByLabel('Body hip circumference (cm)', { exact: true }).fill('104');
  await page.getByLabel('Waist-to-hip depth (cm)', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Apply body measurements', exact: true }).click();
  const before = await backup(page);
  await page.getByRole('button', { name: 'Simulate drape', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel simulation', exact: true }).click();
  await expect(page.locator('#drape-status')).toHaveText('Simulation cancelled. Nothing was changed.');
  expect(await backup(page)).toEqual(before);
  await simulate(page);
  await expect(page.locator('#drape-metrics')).toContainText('waist 76 cm, hip 104 cm at 20 cm (your entered measurements)');
  const clearance = Number((await page.locator('#drape-metrics').textContent())!.match(/closest approach to the body (-?[\d.]+) cm/)![1]);
  expect(clearance).toBeGreaterThanOrEqual(0.3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('changing drape fabric preserves unapplied measured-pattern drafts', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Apply measured pattern', exact: true }).click();
  const before = await backup(page);
  await page.getByLabel('Waist circumference (cm)', { exact: true }).fill('90');
  await page.getByLabel('Fabric', { exact: true }).selectOption('denim-340');
  await expect(page.getByLabel('Waist circumference (cm)', { exact: true })).toHaveValue('90');
  expect(await backup(page)).toEqual(before);
  await page.getByRole('button', { name: 'Discard pattern edits', exact: true }).click();
  await page.getByLabel('Fabric', { exact: true }).selectOption('denim-340');
  expect((await backup(page)).construction.fabric).toBe('denim-340');
});
