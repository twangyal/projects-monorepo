import { test, expect } from '@playwright/test';

test('typed browser-tab requests distinguish native submission and keyboard entry from page-generated events', async ({ page }) => {
  await page.route('**/tab-origin-test.html', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><title>Command origin</title><body><button>Website control</button><script type="module">
import { startWebNavigator } from '/src/web/overlay.js';
window.browserOrigins = [];
startWebNavigator({ window, browser: { run: async (action, origin) => { window.browserOrigins.push(origin?.userInput === true); return { ok: true, message: 'Origin checked.' }; } } });
</script></body></html>` }));
  await page.goto('/tab-origin-test.html');
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel).toBeVisible();
  const generate = (method) => page.evaluate(method => {
    const root = document.getElementById('gaze-web-navigator').shadowRoot;
    const field = root.querySelector('input[aria-label="Typed instruction"]');
    field.value = 'switch to browser tab Mail';
    const form = field.closest('form');
    if (method === 'requestSubmit') form.requestSubmit(); else form.querySelector('button').click();
  }, method);
  await generate('requestSubmit'); await generate('click');
  await expect.poll(() => page.evaluate(() => window.browserOrigins)).toEqual([false, false]);
  await panel.getByLabel('Typed instruction').fill('switch to browser tab Mail');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await panel.getByLabel('Typed instruction').fill('switch to browser tab Mail');
  await panel.getByLabel('Typed instruction').press('Enter');
  await expect.poll(() => page.evaluate(() => window.browserOrigins)).toEqual([false, false, true, true]);
  await page.getByRole('button', { name: 'Website control', exact: true }).click();
  await page.keyboard.press('Alt+Shift+G');
  await expect(panel.locator('.status')).toContainText('Keyboard command mode');
  await page.keyboard.type('switch to browser tab Mail');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.browserOrigins)).toEqual([false, false, true, true, true]);
  await page.getByRole('button', { name: 'Website control', exact: true }).click();
  await page.keyboard.press('Alt+Shift+G');
  await expect(panel.locator('.status')).toContainText('Keyboard command mode');
  await page.keyboard.type('switch to browser tab Mail');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true })));
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.browserOrigins)).toEqual([false, false, true, true, true, false]);
});
