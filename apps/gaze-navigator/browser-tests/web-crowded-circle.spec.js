import { test, expect } from '@playwright/test';

// A list of links as dense as Hacker News: forty story links a line apart around the gaze, and a small "new" link in
// the bar above them, inside the circle but further away than its nearest dozen links.
const stories = Array.from({ length: 40 }, (_, i) => `<a href="#story-${i}" style="position:absolute;left:20px;top:${120 + i * 14}px;font:11px sans-serif">Story number ${i + 1} about something</a>`).join('');
const page = `<!doctype html><style>body{margin:0;height:1500px}</style>
  <a href="#newest" id="new" style="position:absolute;left:60px;top:100px;font:11px sans-serif">new</a>
  <a href="#outside" id="past" style="position:absolute;left:330px;top:100px;font:11px sans-serif">past</a>${stories}`;
async function setup(browserPage) {
  await browserPage.route('**/crowded-fixture', route => route.fulfill({ contentType: 'text/html', body: page }));
  await browserPage.goto('/crowded-fixture');
  await browserPage.evaluate(async () => {
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.capture = (x, y) => captureContext(document, { x, y, radius: 130 });
    window.say = (text, x, y) => window.controller.handle(text, window.capture(x, y));
  });
}

test('a control named inside a crowded circle is used directly, though it is not among the nearest dozen', async ({ page: browserPage }) => {
  await setup(browserPage);
  // The gaze rests on the story list, 100 px below the "new" link.
  const context = await browserPage.evaluate(() => { const c = window.capture(80, 200); return { near: c.elements.map(e => e.name), crowded: c.nearby.filter(e => e.inside).map(e => e.name) }; });
  expect(context.near).toHaveLength(12);
  expect(context.near).not.toContain('new');
  expect(context.crowded).toContain('new');
  const result = await browserPage.evaluate(() => window.say('open new', 80, 200));
  expect(result.performed).toBe('activate');
  expect(result.message).not.toContain('outside the gaze circle');
  expect(browserPage.url()).toContain('#newest');
  // A link just outside the circle still says so.
  await browserPage.evaluate(() => { location.hash = ''; });
  const outside = await browserPage.evaluate(() => window.say('open past', 150, 230));
  expect(outside.performed).toBe('activate');
  expect(outside.message).toContain('It was just outside the gaze circle.');
});
