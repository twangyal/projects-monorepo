import { test, expect } from '@playwright/test';

const region = '<div id="list" class="vertical" style="left:120px;top:60px;width:140px;height:100px"><div style="height:600px">Reviews</div></div>';
async function setup(page, body = region) {
  await page.route('**/scroll-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
    body { margin:0; height:2000px } .vertical { position:absolute;overflow-y:auto } .horizontal { position:absolute;overflow-x:auto }
    </style>${body}` }));
  await page.goto('/scroll-fixture');
  await page.evaluate(async () => {
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.capture = (x = 100, y = 100) => captureContext(document, { x, y, radius: 60, exclude: document.querySelector('#navigator') });
    window.say = (text, context = window.capture()) => window.controller.handle(text, context);
    window.positions = () => ({ page: scrollY, list: document.querySelector('#list')?.scrollTop ?? null });
  });
}

test('a circle touching one list scrolls that list and reports recovery', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => window.say('scroll down a bit'));
  expect(await page.evaluate(() => window.positions())).toEqual({ page: 0, list: 25 });
  expect(result.performed).toBe('scroll');
  expect(result.message).toContain('edge of the gaze circle');
});

test('explicit page scrolling bypasses a list under the gaze center', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => window.say('scroll the page down', window.capture(150, 100)));
  expect(result.performed).toBe('scroll');
  expect(await page.locator('#list').evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test('independent nearby lists are refused without scrolling the page', async ({ page }) => {
  await setup(page, region + '<div id="other" class="vertical" style="left:20px;top:60px;width:60px;height:100px"><div style="height:600px">Other</div></div>');
  const result = await page.evaluate(() => window.say('scroll down'));
  expect(result.performed).toBeNull();
  expect(result.message).toMatch(/more than one|several/i);
  expect(await page.evaluate(() => [scrollY, document.querySelector('#list').scrollTop, document.querySelector('#other').scrollTop])).toEqual([0, 0, 0]);
});

test('nearby recovery chooses only regions supporting the requested axis', async ({ page }) => {
  await setup(page, region + '<div id="strip" class="horizontal" style="left:20px;top:60px;width:60px;height:100px"><div style="width:600px">Albums</div></div>');
  expect((await page.evaluate(() => window.say('scroll down a bit'))).performed).toBe('scroll');
  expect((await page.evaluate(() => window.say('scroll right a bit'))).performed).toBe('scroll');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#list').scrollTop, document.querySelector('#strip').scrollLeft])).toEqual([0, 25, 15]);
});

test('a recovered list at its end never redirects scrolling to the page', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    document.querySelector('#list').scrollTop = 500;
    return window.say('scroll down');
  });
  expect(result.performed).toBeNull();
  expect(result.message).toContain('cannot scroll');
  expect(await page.evaluate(() => window.positions())).toEqual({ page: 0, list: 500 });
});

test('hidden, covered, navigator-owned and distant lists do not steal page scrolling', async ({ page }) => {
  for (const body of [
    region.replace('left:120px', 'display:none;left:120px'),
    region + '<div style="position:absolute;left:115px;top:50px;width:160px;height:130px;background:white">Cover</div>',
    `<aside id="navigator">${region}</aside>`,
    region.replace('left:120px', 'left:270px'),
  ]) {
    await setup(page, body);
    const result = await page.evaluate(() => window.say('scroll down'));
    expect(result.performed).toBe('scroll');
    expect(await page.locator('#list').evaluate(element => element.scrollTop)).toBe(0);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    await page.unroute('**/scroll-fixture');
  }
});

test('open shadow-root lists work both near an edge and under the center', async ({ page }) => {
  await setup(page, '<div id="host"></div>');
  await page.evaluate(() => {
    document.querySelector('#host').attachShadow({ mode:'open' }).innerHTML = '<div id="inner" style="position:absolute;left:120px;top:60px;width:140px;height:100px;overflow:auto"><div style="height:600px">Shadow reviews</div></div>';
  });
  for (const x of [100, 150]) {
    expect((await page.evaluate(x => window.say('scroll down a bit', window.capture(x, 100)), x)).performed).toBe('scroll');
  }
  expect(await page.locator('#inner').evaluate(element => element.scrollTop)).toBe(50);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('nested nearby regions prefer the innermost list without moving its outer region', async ({ page }) => {
  await setup(page, '<div id="outer" class="vertical" style="left:120px;top:40px;width:150px;height:160px"><div style="height:700px"><div id="list" style="margin:20px 10px;width:120px;height:100px;overflow:auto"><div style="height:600px">Inner</div></div></div></div>');
  expect((await page.evaluate(() => window.say('scroll down a bit'))).performed).toBe('scroll');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#outer').scrollTop, document.querySelector('#list').scrollTop])).toEqual([0, 0, 25]);
});

test('a captured region removed before dispatch is refused without page fallback', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const context = window.capture();
    document.querySelector('#list').remove();
    return window.say('scroll down', context);
  });
  expect(result.performed).toBeNull();
  expect(result.message).toMatch(/no longer|changed/);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('an exact-point list takes priority over another list touched by the circle', async ({ page }) => {
  await setup(page, region + '<div id="other" class="vertical" style="left:20px;top:60px;width:60px;height:100px"><div style="height:600px">Other</div></div>');
  expect((await page.evaluate(() => window.say('scroll down a bit', window.capture(130, 100)))).performed).toBe('scroll');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#list').scrollTop, document.querySelector('#other').scrollTop])).toEqual([0, 25, 0]);
});

test('a captured list hidden before dispatch is refused', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const context = window.capture();
    document.querySelector('#list').style.display = 'none';
    return window.say('scroll down', context);
  });
  expect(result.performed).toBeNull();
  expect(await page.evaluate(() => window.positions())).toEqual({ page: 0, list: 0 });
});

test('nested recovery crosses a shadow boundary without treating the outer region as a competitor', async ({ page }) => {
  await setup(page, '<div id="outer" class="vertical" style="left:120px;top:40px;width:150px;height:160px"><div style="height:700px"><div id="host" style="margin:20px 10px"></div></div></div>');
  await page.evaluate(() => {
    document.querySelector('#host').attachShadow({ mode:'open' }).innerHTML = '<div id="inner" style="width:120px;height:100px;overflow:auto"><div style="height:600px">Shadow reviews</div></div>';
  });
  const result = await page.evaluate(() => window.say('scroll down a bit'));
  expect(result.performed).toBe('scroll');
  expect(await page.locator('#inner').evaluate(element => element.scrollTop)).toBe(25);
  expect(await page.locator('#outer').evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('same-origin frame regions scroll, but a removed frame invalidates capture', async ({ page }) => {
  await setup(page, '<iframe id="frame" style="position:absolute;left:120px;top:60px;width:140px;height:100px;border:0" srcdoc="<style>body{margin:0}</style><div id=list style=height:100px;overflow:auto><div style=height:600px>Frame reviews</div></div>"></iframe>');
  await expect(page.frameLocator('#frame').locator('#list')).toBeVisible();
  expect((await page.evaluate(() => window.say('scroll down a bit'))).performed).toBe('scroll');
  expect(await page.frameLocator('#frame').locator('#list').evaluate(element => element.scrollTop)).toBe(25);
  const result = await page.evaluate(() => {
    const context = window.capture();
    window.removedFrameList = document.querySelector('#frame').contentDocument.querySelector('#list');
    document.querySelector('#frame').remove();
    window.removedFrameTop = window.removedFrameList.scrollTop;
    return window.say('scroll down', context);
  });
  expect(result.performed).toBeNull();
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => window.removedFrameList.scrollTop === window.removedFrameTop)).toBe(true);
});

test('a horizontal child does not hide its vertical scroll ancestor during recovery', async ({ page }) => {
  await setup(page, '<div id="outer" class="vertical" style="left:120px;top:60px;width:140px;height:100px"><div style="height:600px"><div id="strip" style="width:140px;height:100px;overflow-x:auto"><div style="width:600px">Albums</div></div></div></div>');
  expect((await page.evaluate(() => window.say('scroll down a bit'))).performed).toBe('scroll');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#outer').scrollTop, document.querySelector('#strip').scrollLeft])).toEqual([0, 25, 0]);
});

test('looking inside a same-origin iframe retains its outer scrolling region', async ({ page }) => {
  await setup(page, '<div id="outer" class="vertical" style="left:120px;top:60px;width:140px;height:100px"><div style="height:600px"><iframe id="frame" style="width:140px;height:100px;border:0" srcdoc="<p>Frame content</p>"></iframe></div></div>');
  await expect(page.frameLocator('#frame').locator('p')).toBeVisible();
  expect((await page.evaluate(() => window.say('scroll down a bit', window.capture(150, 100)))).performed).toBe('scroll');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#outer').scrollTop])).toEqual([0, 25]);
});

test('a region made invisible after capture is refused without moving it', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => {
    const context = window.capture();
    document.querySelector('#list').style.visibility = 'hidden';
    return window.say('scroll down a bit', context);
  });
  expect(result.performed).toBeNull();
  expect(await page.evaluate(() => window.positions())).toEqual({ page: 0, list: 0 });
});
