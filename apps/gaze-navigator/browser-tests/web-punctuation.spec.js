import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('dictation types spoken punctuation as marks, with new lines', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const message = page.locator('#message');
  await message.evaluate(element => element.scrollIntoView({ block: 'start' }));
  const box = await message.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 12);
  await say(page, 'type hello comma can you help question mark new line thanks period');
  await expect(message).toHaveValue('hello, can you help?\nThanks.');
});
