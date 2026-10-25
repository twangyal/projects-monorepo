import { test, expect } from '@playwright/test';

// Password and one-time-code values must never reach the panel, status messages or speech.
const markup = `
  <label>Email <input id="email" type="email" value="ada@example.com"></label>
  <label>Password <input id="password" type="password" value="hunter2"></label>
  <label>Code <input id="code" autocomplete="one-time-code" value="481516"></label>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    const { describeElement } = await import('/src/web/overlay.js');
    window.controller = createController({ window });
    window.capture = () => captureContext(document, { x: 20, y: 20, radius: 1000 });
    window.describeAll = () => window.capture().elements.map(describeElement);
    window.say = async text => {
      const result = window.controller.handle(text, window.capture());
      return await (result.followUp ?? result);
    };
  }, markup);
}

test('sensitive values are withheld from context and descriptions', async ({ page }) => {
  await setup(page);
  const described = await page.evaluate(() => window.describeAll());
  expect(described.join('\n')).not.toContain('hunter2');
  expect(described.join('\n')).not.toContain('481516');
  expect(described).toContain('Text field: Password, contains hidden text');
  expect(described.some(text => text.includes('ada@example.com'))).toBe(true);
  const values = await page.evaluate(() => window.capture().elements.map(({ name, value, sensitive }) => ({ name, value, sensitive })));
  expect(values.find(element => element.name === 'Password')).toEqual({ name: 'Password', value: '', sensitive: true });
});

test('typing into a password field writes the text without announcing it', async ({ page }) => {
  await setup(page);
  await page.locator('#password').evaluate(element => { element.value = ''; element.focus(); });
  const result = await page.evaluate(() => window.say('type swordfish into password'));
  expect(result.tone).toBe('success');
  expect(result.message).not.toContain('swordfish');
  await expect(page.locator('#password')).toHaveValue('swordfish');
});
