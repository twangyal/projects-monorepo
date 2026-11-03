import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

// Three kinds of menu that open under the pointer: one from page script, one from CSS that also opens on keyboard
// focus, and one from CSS :hover alone.
function addMenus() {
  const host = document.getElementById('gaze-web-navigator');
  for (const element of [...document.body.children]) if (element !== host) element.remove();
  const style = document.createElement('style');
  style.textContent = `nav ul.top { display: flex; gap: 40px; list-style: none; margin: 0; padding: 20px; }
    nav li { position: relative; } nav li > ul { position: absolute; top: 24px; left: 0; list-style: none; padding: 6px; margin: 0; background: #eee; width: 120px; }
    .js-menu > ul[hidden], .css-menu > ul, .hover-only > ul { display: none; } .css-menu:hover > ul, .css-menu:focus-within > ul, .hover-only:hover > ul { display: block; }`;
  document.head.append(style);
  document.body.insertAdjacentHTML('afterbegin', `<nav><ul class="top">
    <li class="js-menu"><a href="#shop">Shop</a><ul hidden><li><a href="#fiction">Fiction</a></li><li><a href="#poetry">Poetry</a></li><li><a href="#gift-cards">Gift cards</a></li></ul></li>
    <li class="css-menu"><a href="#help">Help</a><ul><li><a href="#delivery">Delivery</a></li><li><a href="#returns">Returns</a></li></ul></li>
    <li class="hover-only"><a href="#about">About</a><ul><li><a href="#team">Our team</a></li></ul></li></ul></nav><main style="height:1200px"></main>`);
  const shop = document.querySelector('.js-menu');
  shop.addEventListener('mouseenter', () => { shop.querySelector('ul').hidden = false; });
  shop.addEventListener('mouseleave', () => { shop.querySelector('ul').hidden = true; });
}

test('menus that open under the pointer are shown by name without following their link, and left again', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(addMenus);
  await say(page, 'use a large circle');
  // The pointer rests below the menu bar, beside the menus rather than over them.
  const help = await page.getByRole('link', { name: 'Help', exact: true }).boundingBox();
  await page.mouse.move(help.x + help.width / 2, help.y + 160);
  await say(page, 'show the shop menu');
  await expect(status(page)).toContainText('Showing what is under Shop: 3 more controls to choose from.');
  await expect(page.getByRole('link', { name: 'Gift cards', exact: true })).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('');
  await say(page, 'open gift cards');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#gift-cards');
  // Pointing at the next menu leaves the first; a menu that also opens on keyboard focus opens too.
  await say(page, 'hover over help');
  await expect(status(page)).toContainText('Showing what is under Help');
  await expect(page.getByRole('link', { name: 'Returns', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Fiction', exact: true })).toBeHidden();
  await say(page, 'close the menu');
  await expect(status(page)).toContainText('Left the menu.');
  await expect(page.getByRole('link', { name: 'Returns', exact: true })).toBeHidden();
  // A menu drawn only by the page's own :hover style needs a real mouse, and the reply says so.
  await say(page, 'point at about');
  await expect(status(page)).toContainText('Nothing new appeared when pointing at About');
  expect(await page.evaluate(() => location.hash)).toBe('#gift-cards');
});
