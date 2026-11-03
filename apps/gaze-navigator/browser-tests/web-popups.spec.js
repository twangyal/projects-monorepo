import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

// A page with a consent banner fixed at the bottom (in a shadow root, as some consent tools build it) and a newsletter
// pop-up, neither of them where the user is looking.
function addPopups() {
  const host = document.getElementById('gaze-web-navigator');
  for (const element of [...document.body.children]) if (element !== host) element.remove();
  document.body.insertAdjacentHTML('afterbegin', `<main><h1>Recipes</h1><p style="height:1600px">Soup of the day.</p></main>
    <div id="newsletter" role="dialog" aria-label="Newsletter" style="position:fixed;top:80px;right:40px;padding:16px;background:#fff;border:1px solid">
      Get recipes by email. <button>Sign up</button> <button aria-label="Close">×</button></div>
    <div id="consent-host" style="position:fixed;left:0;right:0;bottom:0"></div>`);
  const root = document.getElementById('consent-host').attachShadow({ mode: 'open' });
  root.innerHTML = `<div style="background:#fff;padding:16px;border-top:2px solid">We use cookies to measure visits and show ads.
    <button id="accept">Accept all</button> <button id="reject">Reject all</button> <button>Manage preferences</button></div>`;
  window.choices = [];
  for (const id of ['accept', 'reject']) root.getElementById(id).addEventListener('click', () => { window.choices.push(id); document.getElementById('consent-host').remove(); });
  document.querySelector('#newsletter [aria-label=Close]').addEventListener('click', () => document.getElementById('newsletter').remove());
}

test('cookie banners and pop-ups are answered by name, wherever they are on the page', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(addPopups);
  await page.mouse.move(200, 200);
  await say(page, 'reject cookies');
  await expect(status(page)).toContainText('Pressed "Reject all" on the cookie banner.');
  expect(await page.evaluate(() => window.choices)).toEqual(['reject']);
  await say(page, 'accept cookies');
  await expect(status(page)).toContainText('No cookie banner was found on this page.');
  await say(page, 'close the pop-up');
  await expect(status(page)).toContainText('Closed the pop-up with "Close".');
  await expect(page.locator('#newsletter')).toHaveCount(0);
  await say(page, 'close the pop-up');
  await expect(status(page)).toContainText('No pop-up with a close button was found on this page.');
});
