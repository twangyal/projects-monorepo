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
  // Wide screens move it to the left; on narrow ones, where it spans the width, it moves to the top.
  const button = await page.locator('#essential').boundingBox();
  await expect.poll(() => page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [button.x + button.width / 2, button.y + button.height / 2])).toBe('essential');
  expect(await panel.boundingBox()).not.toEqual(before);
  // The banner's own button now works with the navigator too.
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await panel.getByLabel('Typed instruction').fill('click essential only');
  await page.locator('#essential').evaluate(element => element.addEventListener('click', () => element.closest('div').remove()));
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(page.locator('#essential')).toHaveCount(0);
});

test('moving aside, the panel never lands on the place the user is looking at', async ({ page }) => {
  // On narrow screens the panel spans the width and can only move between top and bottom.
  test.skip(page.viewportSize().width < 1000, 'needs room for corners');
  await page.goto('/practice-site/index.html');
  const panel = page.locator('#gaze-web-navigator section');
  await expect(panel).toBeVisible();
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const child of [...document.body.children]) if (child !== host) child.remove();
    document.body.insertAdjacentHTML('beforeend', `<button id="watched" style="position:absolute;left:120px;top:${innerHeight - 220}px">Favourite</button>`);
  });
  const watched = await page.locator('#watched').boundingBox();
  await page.mouse.move(watched.x + watched.width / 2, watched.y + watched.height / 2);
  await expect(panel.locator('.context')).toContainText('Favourite');
  // A fixed chat bar under the panel's corner makes it move; the free bottom-left corner would cover the gaze.
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button id="top" style="position:fixed;right:16px;bottom:16px;width:340px;height:120px">Chat with us</button>'));
  const fixed = await page.locator('#top').boundingBox();
  const hit = ([x, y]) => document.elementFromPoint(x, y)?.id;
  await expect.poll(() => page.evaluate(hit, [fixed.x + fixed.width / 2, fixed.y + fixed.height / 2])).toBe('top');
  expect(await page.evaluate(hit, [watched.x + watched.width / 2, watched.y + watched.height / 2])).toBe('watched');
  await page.locator('#watched').evaluate(element => element.addEventListener('click', () => { element.textContent = 'Saved'; }));
  await panel.getByLabel('Typed instruction').fill('press favourite');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(page.locator('#watched')).toHaveText('Saved');
});
