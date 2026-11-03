import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function say(page, text) { await panel(page).getByLabel('Typed instruction').fill(text); await panel(page).getByRole('button', { name: 'Do it', exact: true }).click(); }

test('saved details fill the form under the gaze after a yes, and undo empties it again', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.evaluate(() => {
    const host = document.getElementById('gaze-web-navigator');
    for (const element of [...document.body.children]) if (element !== host) element.remove();
    document.body.insertAdjacentHTML('afterbegin', `<main><form id="delivery" style="margin:40px;display:grid;gap:8px;width:320px">
      <label>First name <input id="first" autocomplete="given-name"></label>
      <label>Last name <input id="last" autocomplete="family-name"></label>
      <label>Email <input id="email" type="email"></label>
      <label>Phone <input id="phone" type="tel" value="01234 567890"></label>
      <label>Postcode <input id="postcode" name="postcode"></label>
      <label>Password <input id="password" type="password"></label>
      <label>Message <textarea id="message"></textarea></label></form></main>`);
  });
  const box = await page.locator('#email').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await say(page, 'fill in my details');
  await expect(status(page)).toContainText('No details are saved yet.');
  await say(page, 'remember my name is Jo Smith');
  await expect(status(page)).toContainText('Your name is saved on this device.');
  await say(page, 'remember my email is jo at example dot com');
  await say(page, 'remember my postcode is sw1a 1aa');
  await say(page, 'remember my phone number is 07700 900123');
  await say(page, 'what details do you have');
  await expect(status(page)).toContainText('Saved on this device: your name, email address, postcode and phone number.');
  // Nothing is written before a yes, and the replies never repeat the details themselves.
  await say(page, 'fill in my details');
  await expect(status(page)).toContainText('Fill 4 fields (First name, Last name, Email and Postcode) with your saved details?');
  await expect(status(page)).not.toContainText('Jo Smith');
  await expect(page.locator('#first')).toHaveValue('');
  await say(page, 'confirm');
  await expect(status(page)).toContainText('Filled First name, Last name, Email and Postcode.');
  await expect(page.locator('#first')).toHaveValue('Jo');
  await expect(page.locator('#last')).toHaveValue('Smith');
  await expect(page.locator('#email')).toHaveValue('jo@example.com');
  await expect(page.locator('#postcode')).toHaveValue('SW1A 1AA');
  // A field that already held something, a password and free text are left alone.
  await expect(page.locator('#phone')).toHaveValue('01234 567890');
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.locator('#message')).toHaveValue('');
  await say(page, 'undo');
  await expect(status(page)).toContainText('Emptied First name, Last name, Email and Postcode again.');
  await expect(page.locator('#email')).toHaveValue('');
  await say(page, 'forget my details');
  await expect(status(page)).toContainText('All your saved details are forgotten.');
});
