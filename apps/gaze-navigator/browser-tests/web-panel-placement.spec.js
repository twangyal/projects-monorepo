import { test, expect } from '@playwright/test';

// The navigator panel must stay usable over any website, and must not hide the website's own fixed controls.
test('the panel stays above high z-index website layers', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    const cover = document.createElement('div');
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.1)';
    document.body.append(cover);
  });
  const box = await panel.boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [box.x + box.width / 2, box.y + box.height / 2])).toBe('gaze-web-navigator');
  await panel.getByLabel('Typed instruction').fill('scroll down');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
});

test('the panel moves aside from a fixed cookie banner, whose button can then be looked at and used', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel).toBeVisible();
  const before = await panel.boundingBox();
  await page.evaluate(() => {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;right:16px;bottom:16px;width:340px;padding:16px;z-index:9999;background:white;border:1px solid #ccc';
    banner.innerHTML = 'We use cookies. <button id="essential">Essential only</button>';
    document.body.append(banner);
  });
  await expect.poll(async () => (await panel.boundingBox()).x).toBeLessThan(before.x - 200);
  const button = await page.locator('#essential').boundingBox();
  expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [button.x + button.width / 2, button.y + button.height / 2])).toBe('essential');
  // The banner's own button now works with the navigator too.
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await panel.getByLabel('Typed instruction').fill('click essential only');
  await page.locator('#essential').evaluate(element => element.addEventListener('click', () => element.closest('div').remove()));
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(page.locator('#essential')).toHaveCount(0);
});
