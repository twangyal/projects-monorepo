import { test, expect } from '@playwright/test';

// A stand-in for the browser's SpeechRecognition that delivers one final reading at a time.
function installFakeSpeech() {
  window.__speech = { instances: [] };
  window.SpeechRecognition = class {
    constructor() { window.__speech.instances.push(this); }
    start() { this.onstart?.(); }
    abort() { this.onend?.(); }
  };
  let index = 0;
  window.__speech.say = transcript => {
    const current = window.__speech.instances.at(-1), results = [];
    current.onspeechstart?.();
    results[index] = Object.assign([{ transcript }], { isFinal: true });
    current.onresult({ resultIndex: index++, results });
  };
}

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function lookAt(page, locator) {
  await locator.evaluate(element => window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 140), behavior: 'instant' }));
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await page.goto('/practice-site/catalog.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
});

test('a request not understood as a command offers the control its words point to, and it is used after a yes', async ({ page }) => {
  await lookAt(page, page.getByRole('link', { name: 'Account', exact: true }));
  await page.evaluate(() => window.__speech.say('I already have an account'));
  await expect(status(page)).toContainText('Did you mean "Account"?');
  await expect(page).toHaveURL(/catalog\.html$/);
  await page.evaluate(() => window.__speech.say('yes'));
  await expect(page).toHaveURL(/account\.html$/);
});

test('asking to see the cart while looking at Add to cart asks first, and adds nothing when cancelled', async ({ page }) => {
  await lookAt(page, page.getByRole('button', { name: 'Add to cart' }).first());
  await page.evaluate(() => window.__speech.say('open the cart'));
  await expect(status(page)).toContainText('Did you mean "Add to cart"?');
  await expect(page.locator('#cartCount')).toHaveText('0');
  await page.evaluate(() => window.__speech.say('cancel'));
  await expect(page.locator('#cartCount')).toHaveText('0');
  // Said as an action, it is done.
  await page.evaluate(() => window.__speech.say('add to cart'));
  await expect(page.locator('#cartCount')).toHaveText('1');
});
