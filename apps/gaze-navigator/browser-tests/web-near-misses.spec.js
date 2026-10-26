import { test, expect } from '@playwright/test';

// A named control a little outside the gaze circle (as webcam error leaves it) is still reached.
const markup = `
  <a id="near" href="#byron" style="position:absolute;left:300px;top:100px">Lord Byron</a>
  <a id="far" href="#far" style="position:absolute;left:1000px;top:600px">Far away</a>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    // The gaze circle (radius 90) is centred 160 px left of the link.
    window.capture = () => captureContext(document, { x: 140, y: 110, radius: 90 });
    window.say = async text => {
      const result = window.controller.handle(text, window.capture());
      return await (result.followUp ?? result);
    };
  }, markup);
}

test('captured context lists controls just outside the circle separately', async ({ page }) => {
  await setup(page);
  const context = await page.evaluate(() => {
    const { elements, nearby } = window.capture();
    return { inside: elements.map(element => element.name), nearby: nearby.map(element => [element.id, element.name]) };
  });
  expect(context.inside).toEqual([]);
  // On small viewports the practice page's own panel can also fall in the ring; the far link never does.
  expect(context.nearby[0]).toEqual([101, 'Lord Byron']);
  expect(context.nearby.map(([, name]) => name)).not.toContain('Far away');
});

test('naming the nearby control opens it and says where it was', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => window.say('open Lord Byron'));
  expect(result.tone).toBe('success');
  expect(result.message).toContain('just outside the gaze circle');
  await expect(page).toHaveURL(/#byron$/);
});

test('controls far from the gaze are still refused', async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(() => window.say('open far away'));
  expect(result.tone).toBe('error');
  await expect(page).not.toHaveURL(/#far$/);
});
