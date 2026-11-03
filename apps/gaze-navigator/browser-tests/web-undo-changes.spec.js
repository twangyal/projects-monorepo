import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }
// On small screens the navigator panel covers the lower part of the page, so each control is brought near the top first.
async function lookAt(page, locator) { await locator.evaluate(element => { element.scrollIntoView({ block: 'start' }); scrollBy(0, -80); }); const box = await locator.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); }

test('a checkbox or dropdown changed by mistake is put back by "undo"', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const copy = page.getByRole('checkbox', { name: 'Send me a copy', exact: true }), topic = page.getByRole('combobox', { name: 'Topic', exact: true });
  await lookAt(page, copy);
  // Its name says "send", so ticking it is confirmed first; putting it back needs no question.
  await say(page, 'tick send me a copy');
  await say(page, 'confirm');
  await expect(copy).toBeChecked();
  await say(page, 'undo');
  await expect(status(page)).toContainText('Undone.');
  await expect(copy).not.toBeChecked();
  await lookAt(page, topic);
  await say(page, 'choose order problem');
  await expect(topic).toHaveValue('Order problem');
  await say(page, 'take that back');
  await expect(status(page)).toContainText('Undone.');
  await expect(topic).toHaveValue('General question');
  // Nothing is left to put back, so the next "undo" changes nothing on the page.
  await say(page, 'undo');
  await expect(topic).toHaveValue('General question');
  await expect(copy).not.toBeChecked();
});
