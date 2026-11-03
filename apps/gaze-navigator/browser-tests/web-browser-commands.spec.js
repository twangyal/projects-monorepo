import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('on a page without the extension, reload works and tabs and zoom say they need the extension', async ({ page }) => {
  await page.goto('/practice-site/catalog.html');
  await expect(panel(page)).toBeVisible();
  await say(page, 'zoom in');
  await expect(status(page)).toContainText('Tabs and zoom need the Gaze Navigator extension. Nothing was changed.');
  await say(page, 'next tab');
  await expect(status(page)).toContainText('need the Gaze Navigator extension');
  await page.evaluate(() => { window.beforeReload = true; });
  const reloaded = page.waitForEvent('load');
  await say(page, 'reload the page');
  await reloaded;
  expect(await page.evaluate(() => window.beforeReload ?? false)).toBe(false);
  await expect(panel(page)).toBeVisible();
});
