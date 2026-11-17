import { test, expect } from '@playwright/test';

// A page whose controls are named like commands: "Find out more", "Check availability" and "Turn on notifications",
// beside a text field that finding, searching or entering would otherwise type into.
const markup = `
  <div style="padding:20px;width:520px">
    <label>Email address <input id="email" type="email"></label>
    <p>Holiday cottages in the Lakes. <a href="#more">Find out more</a></p>
    <button id="availability" type="button">Check availability</button>
    <button id="notify" type="button" role="switch" aria-checked="false">Turn on notifications</button>
  </div>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    document.querySelector('#availability').addEventListener('click', () => { document.body.dataset.checked = 'yes'; });
    const notify = document.querySelector('#notify');
    notify.addEventListener('click', () => notify.setAttribute('aria-checked', String(notify.getAttribute('aria-checked') !== 'true')));
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.say = async text => {
      const result = window.controller.handle(text, captureContext(document, { x: 200, y: 90, radius: 160 }));
      return await (result.followUp ?? result);
    };
  }, markup);
}

test('controls named like commands are pressed when their names are said, and nothing is typed into the field', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.say('find out more'));
  await expect(page).toHaveURL(/#more$/);
  await expect(page.locator('#email')).toHaveValue('');
  await page.evaluate(() => window.say('check availability'));
  await expect(page.locator('body')).toHaveAttribute('data-checked', 'yes');
  // A switch said by its whole name is turned on, and saying it again leaves it on.
  await page.evaluate(() => window.say('turn on notifications'));
  await expect(page.locator('#notify')).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => window.say('turn on notifications'));
  await expect(page.locator('#notify')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#email')).toHaveValue('');
});
