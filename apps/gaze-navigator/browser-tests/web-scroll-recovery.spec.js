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

// A sidebar list far from the gaze, with page content around the gaze.
const sidebar = '<aside id="side" class="vertical" style="right:10px;top:20px;width:150px;height:300px"><ul style="margin:0">' +
  Array.from({ length: 40 }, (_, i) => `<li>Element ${i}</li>`).join('') + '</ul></aside><p style="position:absolute;left:40px;top:400px">Article text</p>';

test('a named region away from the gaze is scrolled, and the reply says so', async ({ page }) => {
  await setup(page, sidebar);
  for (const said of ['scroll the list down a bit', 'scroll the sidebar down a bit']) {
    const result = await page.evaluate(said => window.say(said, window.capture(80, 420)), said);
    expect(result.performed).toBe('scroll');
    expect(result.message).toMatch(/It was the (list|sidebar) away from the gaze circle\./);
  }
  expect(await page.evaluate(() => [scrollY, document.querySelector('#side').scrollTop])).toEqual([0, 150]);
});

test('the spoken region wins over a different pane under the gaze', async ({ page }) => {
  await setup(page, sidebar + '<section id="comments" class="vertical" style="left:25px;top:50px;width:150px;height:220px"><div style="height:650px">Comment thread</div></section>');
  const result = await page.evaluate(() => window.say('scroll the comments down a bit', window.capture(innerWidth - 90, 110)));
  expect(result.performed).toBe('scroll');
  expect(result.message).toContain('comments away from the gaze');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#side').scrollTop, document.querySelector('#comments').scrollTop])).toEqual([0, 0, 55]);
});

test('a named region that cannot scroll in the requested direction leaves the page and the gazed pane still', async ({ page }) => {
  await setup(page, sidebar);
  const result = await page.evaluate(() => window.say('scroll the sidebar right a bit', window.capture(innerWidth - 90, 110)));
  expect(result.performed).toBeNull();
  expect(result.message).toContain('No visible sidebar can scroll right');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#side').scrollLeft])).toEqual([0, 0]);
});

test('an unmatched name leaves the page still and an unnamed request scrolls it', async ({ page }) => {
  await setup(page, sidebar);
  const missing = await page.evaluate(() => window.say('scroll the comments down a bit', window.capture(80, 420)));
  expect(missing.performed).toBeNull();
  expect(missing.message).toContain('No visible comments can scroll down');
  expect(await page.evaluate(() => [scrollY, document.querySelector('#side').scrollTop])).toEqual([0, 0]);
  expect((await page.evaluate(() => window.say('scroll down a bit', window.capture(80, 420)))).performed).toBe('scroll');
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test('a nearer outer pane wins over its farther matching child', async ({ page }) => {
  await setup(page, '<aside id="outer" class="vertical" style="left:40px;top:30px;width:190px;height:300px"><div style="height:600px"><div id="inner" class="vertical" style="left:20px;top:190px;width:120px;height:80px"><div style="height:400px">Nested content</div></div></div></aside>');
  const result = await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(25, 40)));
  expect(result.performed).toBe('scroll');
  expect(await page.evaluate(() => [document.querySelector('#outer').scrollTop, document.querySelector('#inner').scrollTop])).toEqual([75, 0]);
});

test('a matching pane hidden after capture does not block another visible match', async ({ page }) => {
  const other = '<aside id="left-sidebar" class="vertical" style="left:20px;top:50px;width:150px;height:220px"><div style="height:650px">Other sidebar</div></aside>';
  await setup(page, sidebar + other);
  const result = await page.evaluate(() => {
    const captured = window.capture(innerWidth - 90, 110);
    document.querySelector('#side').style.visibility = 'hidden';
    return window.say('scroll the sidebar down a bit', captured);
  });
  expect(result.performed).toBe('scroll');
  expect(await page.evaluate(() => [document.querySelector('#side').scrollTop, document.querySelector('#left-sidebar').scrollTop])).toEqual([0, 55]);
});

test('again keeps the previously used named pane and does not switch after removal', async ({ page }) => {
  const other = '<aside id="left-sidebar" class="vertical" style="left:20px;top:50px;width:150px;height:220px"><div style="height:650px">Other sidebar</div></aside>';
  await setup(page, sidebar + other);
  const result = await page.evaluate(() => {
    const left = () => window.capture(80, 110);
    const first = window.say('scroll the sidebar down a bit', window.capture(innerWidth - 90, 110));
    const again = window.say('again', left());
    const position = document.querySelector('#side').scrollTop;
    document.querySelector('#side').remove();
    const removed = window.say('again', left());
    return [first.performed, again.performed, position, removed.tone, document.querySelector('#left-sidebar').scrollTop];
  });
  expect(result).toEqual(['scroll', 'scroll', 150, 'error', 0]);
});

test('nearest named pane uses top-page coordinates for a same-origin frame', async ({ page }) => {
  const markup = '<aside id="near-left" class="vertical" style="left:25px;top:30px;width:120px;height:180px"><div style="height:450px">Left sidebar</div></aside>' +
    '<iframe id="sidebar-frame" style="position:absolute;left:240px;top:30px;width:130px;height:200px;border:0" srcdoc="<body style=\'margin:0\'><aside id=\'frame-pane\' style=\'width:120px;height:180px;overflow-y:auto\'><div style=\'height:450px\'>Frame sidebar</div></aside></body>"></iframe>';
  await setup(page, markup);
  const pane = page.frameLocator('#sidebar-frame').locator('#frame-pane');
  await expect(pane).toBeVisible();
  const result = await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(205, 100)));
  expect(result.performed).toBe('scroll');
  expect(await pane.evaluate(node => node.scrollTop)).toBe(45);
  expect(await page.locator('#near-left').evaluate(node => node.scrollTop)).toBe(0);
});

const thinSidebar = '<aside id="thin" style="position:absolute;left:5px;top:5px;width:16px;height:140px;overflow-y:auto"><div style="height:600px">Sidebar content</div></aside>';

test('a narrow named sidebar between viewport samples scrolls without gaze or page movement', async ({ page }) => {
  await setup(page, thinSidebar);
  const result = await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)));
  expect(result.performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('a short horizontal grid between viewport samples scrolls only on its supported axis', async ({ page }) => {
  await setup(page, '<div id="thin" role="grid" style="position:absolute;left:125px;top:1px;width:150px;height:16px;overflow-x:auto;overflow-y:hidden"><div style="width:900px;height:12px">Table columns</div></div>');
  const result = await page.evaluate(() => window.say('scroll the table right a bit', window.capture(200, 420)));
  expect(result.performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  expect((await page.evaluate(() => window.say('scroll the table down a bit', window.capture(200, 420)))).performed).toBeNull();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('narrow named scroll panes are found inside open shadow roots and same-origin frames', async ({ page }) => {
  for (const surface of ['shadow', 'frame']) {
    await setup(page, surface === 'shadow' ? '<div id="host"></div>' : '<iframe id="frame" style="position:absolute;left:3px;top:3px;width:22px;height:150px;border:0"></iframe>');
    await page.evaluate(({ surface, html }) => {
      const root = surface === 'shadow' ? document.querySelector('#host').attachShadow({ mode:'open' }) : document.querySelector('#frame').contentDocument.body;
      root.innerHTML = html;
    }, { surface, html: thinSidebar });
    const pane = surface === 'shadow' ? page.locator('#thin') : page.frameLocator('#frame').locator('#thin');
    const result = await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)));
    expect(result.performed, surface).toBe('scroll');
    expect(await pane.evaluate(node => node.scrollTop), surface).toBe(35);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.unroute('**/scroll-fixture');
  }
});

test('a list inside an unlabelled narrow scroll wrapper reveals its scrollable ancestor', async ({ page }) => {
  await setup(page, '<div id="thin" style="position:absolute;left:5px;top:5px;width:16px;height:140px;overflow:auto"><ul style="margin:0;padding:0">' + Array.from({ length:40 }, (_, i) => `<li>Row ${i}</li>`).join('') + '</ul></div>');
  expect((await page.evaluate(() => window.say('scroll the list down a bit', window.capture(200, 420)))).performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('a partially clipped narrow sidebar is discovered in its painted portion', async ({ page }) => {
  await setup(page, '<div style="position:absolute;left:3px;top:3px;width:8px;height:100px;overflow:hidden">' + thinSidebar + '</div>');
  expect((await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)))).performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('unpainted and navigator-owned narrow panes never receive a named scroll or move the page', async ({ page }) => {
  for (const body of [
    thinSidebar.replace('left:5px', 'display:none;left:5px'),
    thinSidebar.replace('left:5px', 'visibility:hidden;left:5px'),
    thinSidebar.replace('left:5px', 'opacity:0;left:5px'),
    thinSidebar.replace('left:5px', 'left:-50px'),
    thinSidebar + '<div style="position:absolute;left:0;top:0;width:25px;height:150px;background:white">Cover</div>',
    '<div style="position:absolute;left:3px;top:300px;width:8px;height:100px;overflow:hidden">' + thinSidebar.replace('top:5px', 'top:150px') + '</div>',
    '<aside id="navigator">' + thinSidebar + '</aside>',
    '<aside style="position:absolute;left:5px;top:5px;width:16px;height:140px">No overflow</aside>',
  ]) {
    await setup(page, body);
    const result = await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)));
    expect(result.performed).toBeNull();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    if (await page.locator('#thin').count()) expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(0);
    await page.unroute('**/scroll-fixture');
  }
});

test('a visible narrow sidebar can override inherited visibility hiding', async ({ page }) => {
  await setup(page, '<div style="visibility:hidden">' + thinSidebar.replace('left:5px', 'visibility:visible;left:5px') + '</div>');
  expect((await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)))).performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

for (const display of ['contents', 'inline']) test(`a ${display} ancestor does not clip a narrow sidebar to an empty box`, async ({ page }) => {
  await setup(page, `<div style="display:${display};overflow:hidden">` + thinSidebar + '</div>');
  expect((await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)))).performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('excluded navigator labels cannot consume the page pane discovery budget', async ({ page }) => {
  await setup(page, '<aside id="navigator">' + Array.from({ length:420 }, (_, i) => `<span aria-label="Navigator label ${i}"></span>`).join('') + '</aside>' + thinSidebar);
  expect((await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)))).performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('a detached frame in a captured named-region context refuses without throwing', async ({ page }) => {
  await setup(page, '<iframe id="frame" style="position:absolute;left:3px;top:3px;width:22px;height:150px;border:0"></iframe>');
  await page.evaluate(html => { document.querySelector('#frame').contentDocument.body.innerHTML = html; }, thinSidebar);
  const result = await page.evaluate(() => {
    const context = window.capture(200, 420);
    window.detachedPane = document.querySelector('#frame').contentDocument.querySelector('#thin');
    document.querySelector('#frame').remove();
    return window.say('scroll the sidebar down a bit', context);
  });
  expect(result.performed).toBeNull();
  expect(await page.evaluate(() => [scrollY, window.detachedPane.scrollTop])).toEqual([0, 0]);
});

test('a border clipping a sidebar to a painted sliver does not hide that scroll pane', async ({ page }) => {
  await setup(page, '<div style="position:absolute;left:0;top:0;width:8px;height:140px;border:5px solid;overflow:hidden">' + thinSidebar.replace('left:5px;top:5px', 'left:-15px;top:0') + '</div>');
  expect((await page.evaluate(() => window.say('scroll the sidebar down a bit', window.capture(200, 420)))).performed).toBe('scroll');
  expect(await page.locator('#thin').evaluate(node => node.scrollTop)).toBe(35);
  expect(await page.evaluate(() => scrollY)).toBe(0);
});
