import { test, expect } from '@playwright/test';

// A mail composer: a rich-text body and a toolbar whose buttons, like real ones, keep the editor's selection on mousedown.
const markup = `
  <div style="padding:20px;width:600px">
    <div role="toolbar" aria-label="Formatting">
      <button id="bold" type="button">Bold</button> <button id="italic" type="button">Italic</button>
      <button id="link" type="button">Insert link</button> <button id="list" type="button">Bulleted list</button>
    </div>
    <div id="body" contenteditable="true" role="textbox" aria-label="Message body" style="min-height:80px;border:1px solid #888">Hello Sam, see you soon</div>
  </div>`;

async function setup(page) {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(async markup => {
    document.body.innerHTML = markup;
    for (const [id, command, value] of [['bold', 'bold'], ['italic', 'italic'], ['link', 'createLink', 'https://example.com/'], ['list', 'insertUnorderedList']]) {
      const button = document.getElementById(id);
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => document.execCommand(command, false, value));
    }
    const { captureContext } = await import('/src/web/page-context.js');
    const { createController } = await import('/src/web/controller.js');
    window.controller = createController({ window });
    window.say = async text => {
      const result = window.controller.handle(text, captureContext(document, { x: 250, y: 90, radius: 200 }));
      return await (result.followUp ?? result);
    };
  }, markup);
}

test('formatting and inserting by voice press the editor toolbar and keep the words selected there', async ({ page }) => {
  await setup(page);
  // Select words in the message, then format them: the toolbar does it, and nothing is typed.
  await page.evaluate(() => window.say('select text see you'));
  await page.evaluate(() => window.say('make it bold'));
  await expect(page.locator('#body b, #body strong')).toHaveText('see you');
  // The editor keeps focus, as when a toolbar is clicked, so writing carries on there.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('body');
  await page.evaluate(() => window.say('italics'));
  await expect(page.locator('#body i, #body em')).toHaveText('see you');
  await page.evaluate(() => window.say('insert a link'));
  await expect(page.locator('#body a')).toHaveAttribute('href', 'https://example.com/');
  await expect(page.locator('#body')).toContainText('Hello Sam, see you soon');
  await expect(page.locator('#body')).not.toContainText('link');
  // Words that name no toolbar control are still typed.
  await page.evaluate(() => window.say('bullet points'));
  await expect(page.locator('#body ul li')).toHaveCount(1);
});
