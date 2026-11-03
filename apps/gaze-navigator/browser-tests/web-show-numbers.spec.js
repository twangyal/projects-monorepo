import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }
// The number shown on a control: the badge of the numbered outline drawn round it.
const numberOn = (page, locator) => locator.evaluate(element => {
  const rect = element.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const outline = [...document.getElementById('gaze-web-navigator').shadowRoot.querySelectorAll('.outline.numbered')].find(box => {
    const r = box.getBoundingClientRect();
    return x > r.left && x < r.right && y > r.top && y < r.bottom && r.width < rect.width + 10;
  });
  return outline ? Number(outline.querySelector('.badge').textContent) : null;
});

test('numbers on every control can be said instead of looking, stay put while shown, and are hidden again', async ({ page }) => {
  await page.goto('/practice-site/catalog.html');
  await expect(panel(page)).toBeVisible();
  const cart = page.locator('.add-to-cart');
  // The first book near the top of the screen, and the gaze resting far from it.
  await cart.nth(0).evaluate(button => window.scrollTo({ top: button.getBoundingClientRect().top + window.scrollY - 140, behavior: 'instant' }));
  await page.mouse.move(5, 5);
  await say(page, 'show numbers');
  await expect(status(page)).toContainText(/Numbers shown on \d+ controls/);
  const outlines = page.locator('#gaze-web-navigator .outline.numbered');
  expect(await outlines.count()).toBeGreaterThan(1);
  const first = await numberOn(page, cart.nth(0));
  expect(first).toBeGreaterThan(0);
  const count = page.locator('#cartCount');
  const before = Number(await count.textContent());
  await say(page, `click ${first}`);
  await expect(count).toHaveText(String(before + 1));
  // A number on its own works too while numbers are shown.
  await say(page, String(first));
  await expect(count).toHaveText(String(before + 2));
  await say(page, 'click 999');
  await expect(status(page)).toContainText('There is no number 999 on the screen');
  // Scrolling a little keeps the numbers of controls still on screen.
  await page.mouse.wheel(0, 40);
  await expect.poll(() => numberOn(page, cart.nth(0))).toBe(first);
  await say(page, 'hide numbers');
  await expect(status(page)).toContainText('Numbers hidden.');
  await expect(outlines).toHaveCount(0);
});
