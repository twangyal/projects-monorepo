import { test, expect } from '@playwright/test';

// A checkout's choices said by their rank: a size dropdown, a delivery dropdown with prices and times, and postage
// radio buttons further down the page.
const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function lookAt(page, locator) {
  await locator.evaluate(element => window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 140), behavior: 'instant' }));
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}
async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await expect(status(page)).toContainText('Ready');
  await page.evaluate(() => {
    document.querySelector('main').innerHTML = `
      <h1>Checkout</h1>
      <p><label>Size <select id="size"><option>Choose a size</option><option>XS</option><option>S</option><option>M</option><option>L</option><option>XL</option></select></label></p>
      <p style="margin-top: 40px"><label>Delivery <select id="delivery"><option>Standard, 3-5 days, £3.99</option><option>Next day, £6.99</option><option>Collect in store, free</option></select></label></p>
      <fieldset style="margin-top: 420px"><legend>Postage</legend>
        <label><input type="radio" name="post" value="second"> Second class (2-3 days)</label>
        <label><input type="radio" name="post" value="first"> First class (next day)</label>
        <label><input type="radio" name="post" value="signed"> Signed for (1-2 days)</label>
      </fieldset>`;
  });
});

test('the largest size, the cheapest delivery and the fastest postage are chosen by their rank', async ({ page }) => {
  await lookAt(page, page.locator('#size'));
  await typeInstruction(page, 'the largest size');
  await expect(page.locator('#size')).toHaveValue('XL');
  await lookAt(page, page.locator('#delivery'));
  await typeInstruction(page, 'the cheapest delivery');
  await expect(page.locator('#delivery')).toHaveValue('Collect in store, free');
  await typeInstruction(page, 'I would like the quickest delivery');
  await expect(page.locator('#delivery')).toHaveValue('Next day, £6.99');
  await lookAt(page, page.getByLabel('First class (next day)'));
  await typeInstruction(page, 'the fastest one');
  await expect(page.getByLabel('First class (next day)')).toBeChecked();
});

test('a rank the choices cannot be ranked by changes nothing', async ({ page }) => {
  await lookAt(page, page.locator('#size'));
  await typeInstruction(page, 'the cheapest size');
  await expect(status(page)).toContainText('not understood');
  await expect(page.locator('#size')).toHaveValue('Choose a size');
});
