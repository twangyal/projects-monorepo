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

for (const nearby of [true, false]) {
  test(`${nearby ? 'nearby' : 'inside'} question badges agree with prompt numbers and choose the second link`, async ({ page }) => {
    await page.goto('/practice-site/contact.html');
    await page.evaluate(nearby => {
      const host = document.getElementById('gaze-web-navigator');
      for (const child of [...document.body.children]) if (child !== host) child.remove();
      document.body.style.margin = '0';
      const left = nearby ? 180 : 20;
      for (let n = 1; n <= 2; n++) {
        const link = document.createElement('a');
        link.textContent = 'Read more'; link.href = `#choice-${n}`;
        link.style.cssText = `position:fixed;left:${left}px;top:${20 + n * 30}px`;
        document.body.append(link);
      }
    }, nearby);
    const panel = page.locator('#gaze-web-navigator section');
    await panel.locator('details.settings').evaluate(el => { el.open = true; });
    await panel.getByLabel('Circle size').selectOption('small');
    await panel.locator('details.settings').evaluate(el => { el.open = false; });
    await page.mouse.move(20, 65);
    // Let the overlay capture a pointer context before focus moves into its panel.
    if (nearby) await expect(panel.locator('.context li')).toHaveCount(0);
    else await expect(panel.locator('.context')).toContainText('Read more');
    await panel.getByLabel('Typed instruction').fill('open read more');
    await panel.getByRole('button', { name: 'Do it', exact: true }).click();
    await expect(panel.locator('.status')).toContainText('Say a number or cancel');
    await expect(page.locator('#gaze-web-navigator .outline.question .badge')).toHaveText(['1', '2']);
    await expect(panel.locator('.prompt button')).toHaveText(['1: Read more', '2: Read more', 'Cancel']);
    await expect(page).not.toHaveURL(/#choice/);
    await panel.getByRole('button', { name: '2: Read more', exact: true }).click();
    await expect(page).toHaveURL(/#choice-2$/);
    await expect(page.locator('#gaze-web-navigator .outline.question')).toHaveCount(0);
  });
}

test('one dropdown outline shows every offered option number', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const select = document.createElement('select');
    select.id = 'price-sort'; select.setAttribute('aria-label', 'Sort');
    select.style.cssText = 'position:fixed;left:20px;top:30px;z-index:10';
    for (const text of ['Choose sort', 'Price low to high', 'Price high to low']) {
      const option = document.createElement('option'); option.textContent = text; select.append(option);
    }
    document.body.append(select);
  });
  const panel = page.locator('#gaze-web-navigator section');
  await page.mouse.move(40, 40);
  await expect(panel.locator('.context')).toContainText('Sort');
  await panel.getByLabel('Typed instruction').fill('select price');
  await panel.getByRole('button', { name: 'Do it', exact: true }).click();
  await expect(panel.locator('.prompt button')).toHaveText(['1: Price low to high', '2: Price high to low', 'Cancel']);
  await expect(page.locator('#gaze-web-navigator .outline.question .badge')).toHaveText(['1, 2']);
  await panel.getByRole('button', { name: '1: Price low to high', exact: true }).click();
  await expect(page.locator('#price-sort')).toHaveValue('Price low to high');
});
