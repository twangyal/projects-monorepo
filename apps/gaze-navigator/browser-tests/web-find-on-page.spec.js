import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }
const inView = locator => locator.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });

test('words are found on the page, stepped through, and a control they are in can be used', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    const article = document.createElement('main');
    const filler = n => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1} about our books, stores and gift cards.</p>`).join('');
    article.innerHTML = `<h1>Shop help</h1>${filler(30)}<p>Read our <a id="first" href="#first-policy">return policy</a> before sending anything back.</p>${filler(30)}
      <div style="display:none">The return policy, hidden.</div><p>Questions? See the <button id="second" type="button" onclick="this.textContent='Opened'">Return Policy</button> again.</p>${filler(10)}`;
    document.body.prepend(article);
    window.scrollTo(0, 0);
  });
  await page.mouse.move(5, 5);
  await say(page, 'find return policy on this page');
  await expect(status(page)).toContainText('Found "return policy" (1 of 2). It is in the link "return policy"');
  await expect(page.locator('#gaze-web-navigator .outline.found')).toHaveCount(1);
  expect(await inView(page.locator('#first'))).toBe(true);
  await say(page, 'next match');
  await expect(status(page)).toContainText('(2 of 2)');
  await expect.poll(() => inView(page.locator('#second'))).toBe(true);
  await say(page, 'click it');
  await expect(page.locator('#second')).toHaveText('Opened');
  await say(page, 'find xyzzy on this page');
  await expect(status(page)).toContainText('"xyzzy" is not on this page.');
  await expect(page.locator('#gaze-web-navigator .outline.found')).toHaveCount(0);
});
