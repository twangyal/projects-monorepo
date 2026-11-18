import { test, expect } from '@playwright/test';

// A bookshop's choices said as preferences: format radio buttons, a topic dropdown and a checkbox on a message form.
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
      <h1>The Lighthouse</h1>
      <fieldset><legend>Format</legend>
        <label><input type="radio" name="format" value="paperback" checked> Paperback</label>
        <label><input type="radio" name="format" value="hardcover"> Hardcover</label>
        <label><input type="radio" name="format" value="audio"> Audiobook</label>
      </fieldset>
      <form style="margin-top: 380px" onsubmit="return false">
        <p><label>Topic <select id="topic"><option>General question</option><option>Order problem</option><option>Book suggestion</option></select></label></p>
        <p><label><input type="checkbox" id="copy"> Send me a copy</label></p>
      </form>`;
  });
});

test('a format, a topic and a copy are chosen by saying what is wanted', async ({ page }) => {
  await lookAt(page, page.getByLabel('Hardcover'));
  await typeInstruction(page, 'the hardback is fine');
  await expect(page.getByLabel('Hardcover')).toBeChecked();
  await typeInstruction(page, 'softback please');
  await expect(page.getByLabel('Paperback')).toBeChecked();
  await lookAt(page, page.locator('#topic'));
  await typeInstruction(page, 'I have a complaint about my order');
  await expect(page.locator('#topic')).toHaveValue('Order problem');
  // The box is found just outside the circle; a name with "send" in it is confirmed first, as any such control is.
  await typeInstruction(page, "I'd like a copy of this sent to me");
  await expect(status(page)).toContainText('"Send me a copy" may have consequences');
  await expect(page.locator('#copy')).not.toBeChecked();
  await typeInstruction(page, 'confirm');
  await expect(page.locator('#copy')).toBeChecked();
  // Said again, the box stays ticked rather than being clicked off.
  await typeInstruction(page, 'send me a copy too');
  await expect(status(page)).toContainText('may have consequences');
  await typeInstruction(page, 'confirm');
  await expect(page.locator('#copy')).toBeChecked();
});
