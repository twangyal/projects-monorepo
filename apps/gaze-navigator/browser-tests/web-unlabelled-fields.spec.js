import { test, expect } from '@playwright/test';

// A log-in form like one on a live site: both labels say for="username", so the username box is named "Username
// Password" and the password box has no name at all.
const form = `<form><label for="username">Username</label><input id="username" type="text">
  <label for="username">Password</label><input id="password" type="password"></form>`;
async function setup(page) {
  await page.route('**/unlabelled-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0} form{width:300px}</style>${form}` }));
  await page.goto('/unlabelled-fixture');
  await page.evaluate(async () => {
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.capture = (x = 60, y = 30) => captureContext(document, { x, y, radius: 200 });
    window.say = text => window.controller.handle(text, window.capture());
  });
}

test('a field whose label points at another one is named by the label before it, and a nameless password box as one', async ({ page }) => {
  await setup(page);
  let result = await page.evaluate(() => window.say('type alice into username'));
  expect(await page.locator('#username').inputValue()).toBe('alice');
  result = await page.evaluate(() => window.say('type secret into the password'));
  expect(await page.locator('#password').inputValue()).toBe('secret');
  expect(await page.locator('#username').inputValue()).toBe('alice');
  // The password is never shown back.
  expect(result.message).not.toContain('secret');
  // Without the mislabelled "Password" label in front of it, the box is still found as the password.
  await page.evaluate(() => { document.querySelector('label[for=username]:nth-of-type(2)').remove(); document.querySelector('#password').value = ''; });
  await page.evaluate(() => window.say('type hunter2 into the password field'));
  expect(await page.locator('#password').inputValue()).toBe('hunter2');
  expect(await page.locator('#username').inputValue()).toBe('alice');
});
