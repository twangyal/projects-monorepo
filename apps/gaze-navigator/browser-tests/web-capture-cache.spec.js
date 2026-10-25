import { test, expect } from '@playwright/test';

// The capture cache may only skip work; it must never report a control that moved away or miss one
// once the caller has cleared the cache for a page change.
async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async () => {
    document.body.innerHTML = '<button id="near" style="position:absolute;left:100px;top:100px">Near</button>';
    const { captureContext } = await import('/src/web/page-context.js');
    window.cache = { entry: null, rects: null };
    window.names = () => captureContext(document, { x: 110, y: 110, radius: 60, scopeCache: window.cache }).elements.map(element => element.name);
  });
}

test('cached rectangles are re-measured, so a moved control is not reported', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => window.names())).toEqual(['Near']);
  // Moved without clearing the rectangle cache (as during a CSS animation).
  await page.evaluate(() => { document.getElementById('near').style.left = '700px'; });
  expect(await page.evaluate(() => window.names())).toEqual([]);
});

test('clearing the cache finds controls added in new shadow roots', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => window.names())).toEqual(['Near']);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:130px;top:130px';
    host.attachShadow({ mode: 'open' }).innerHTML = '<button>Inside</button>';
    document.body.append(host);
    window.cache.entry = null;
    window.cache.rects = null;
  });
  expect((await page.evaluate(() => window.names())).sort()).toEqual(['Inside', 'Near']);
});
