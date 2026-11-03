import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('"again" scrolls the page once more', async ({ page }) => {
  await page.goto('/practice-site/catalog.html');
  await page.evaluate(() => { document.body.style.minHeight = '6000px'; });
  await page.mouse.move(200, 200);
  await say(page, 'scroll down');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const once = await page.evaluate(() => window.scrollY);
  await say(page, 'again');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(once + 100);
});
