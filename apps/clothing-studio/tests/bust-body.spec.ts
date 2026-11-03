import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const field = (page: Page) => page.getByLabel('Underbust girth (cm, optional)', { exact: true });
const apply = (page: Page) => page.getByRole('button', { name: 'Apply body settings', exact: true }).click();
async function backup(page: Page) { const wait = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export project backup', exact: true }).click(); return JSON.parse((await readFile((await (await wait).path())!)).toString()); }

for (const width of [1280, 390]) test(`an underbust gives the body a bust, kept through refusals, history, profiles and the drape at ${width}px`, async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width, height: 900 });
  await page.goto('/'); await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Use the T-shirt dress template/ }).click();
  await page.getByRole('button', { name: 'Body & drape', exact: true }).click(); await page.locator('#top-body-shape summary').click();
  await page.getByLabel('Body chest girth (cm)', { exact: true }).fill('92');
  const before = await backup(page);
  // An underbust that is not under a bust, or given with a chest depth, is refused and left to correct.
  await field(page).fill('91'); await apply(page);
  await expect(page.locator('#message')).toContainText('at least 2 cm smaller than the chest'); await expect(field(page)).toHaveValue('91');
  expect((await backup(page)).topBody).toEqual(before.topBody);
  await page.getByLabel('Chest front-to-back depth (cm, optional)', { exact: true }).fill('22'); await field(page).fill('76'); await apply(page);
  await expect(page.locator('#message')).toContainText('Leave chest depth blank');
  await page.getByLabel('Chest front-to-back depth (cm, optional)', { exact: true }).fill(''); await apply(page);
  expect((await backup(page)).topBody).toMatchObject({ chest: 92, underbust: 76 });
  await expect(page.getByLabel('Body waist girth (cm, optional)', { exact: true })).toHaveAttribute('placeholder', 'Auto: 72.2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(field(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(field(page)).toHaveValue('76');
  // A saved body profile keeps the bust.
  await page.getByText('Saved body profiles', { exact: true }).click(); await page.getByLabel('Body profile name', { exact: true }).fill('Bust');
  await page.getByRole('button', { name: 'Save body as new profile', exact: true }).click(); await expect(page.locator('#body-profile-status')).toContainText('saved');
  await expect(page.locator('#body-profile-preview')).toContainText('92 cm bust / 76 underbust');
  // The drape uses it.
  await page.getByRole('button', { name: 'Drape on a body', exact: true }).click();
  await expect(page.locator('#garment-drape-status')).toContainText('Draped on a body with a 92 cm bust over a 76 cm underbust', { timeout: 150000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
