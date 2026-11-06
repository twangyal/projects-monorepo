import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
}
for (const change of ['label', 'link', 'focus', 'form destination', 'base target']) test(`confirmation refuses a reused control when its ${change} changes`, async ({page}) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(change => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:fixed;top:45px;left:30px;z-index:9999;background:white;';
    wrapper.innerHTML = change === 'form destination'
      ? '<form action="/original"><button id="checkout">Download receipt</button></form>'
      : '<a id="checkout" href="/original" download>Download receipt</a>';
    document.body.append(wrapper);
    window.activations = [];
    wrapper.querySelector('#checkout').addEventListener('click', event => {
      event.preventDefault(); window.activations.push(event.currentTarget.getAttribute('href') ?? event.currentTarget.form.getAttribute('action'));
    });
  }, change);
  const target = page.locator('#checkout');
  await target.hover();
  await say(page, 'click download receipt');
  await expect(panel(page).locator('.status')).toContainText('Say confirm');
  await target.evaluate((node, change) => {
    if (change === 'label') node.textContent = 'Delete receipt';
    else if (change === 'link') node.href = '/different';
    else if (change === 'base target') {
      const base = document.createElement('base'); base.target = '_blank'; document.head.prepend(base);
    } else if (change === 'form destination') node.form.action = '/different';
    else node.addEventListener('focus', () => { node.href = '/different'; }, {once:true});
  }, change);
  await say(page, 'confirm');
  await expect(panel(page).locator('.status')).toContainText('control changed');
  expect(await page.evaluate(() => window.activations)).toEqual([]);
  await target.evaluate(node => { document.querySelector('base[target]')?.remove(); if (node.form) node.form.setAttribute('action', '/original'); else node.href = '/original'; node.textContent = 'Download receipt'; });
  await target.hover(); await say(page, 'click download receipt'); await say(page, 'confirm');
  expect(await page.evaluate(() => window.activations)).toEqual(['/original']);
});
