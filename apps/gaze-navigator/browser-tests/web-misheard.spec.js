import { test, expect } from '@playwright/test';

// A stand-in for the browser's SpeechRecognition whose final results can carry several readings, best first.
function installFakeSpeech() {
  window.__speech = { instances: [] };
  window.SpeechRecognition = class {
    constructor() { window.__speech.instances.push(this); }
    start() { this.onstart?.(); }
    abort() { this.onend?.(); }
  };
  let index = 0;
  window.__speech.say = (...readings) => {
    const current = window.__speech.instances.at(-1), results = [];
    current.onspeechstart?.();
    results[index] = Object.assign(readings.map(transcript => ({ transcript })), { isFinal: true });
    current.onresult({ resultIndex: index++, results });
  };
}

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(installFakeSpeech);
  await page.goto('/practice-site/catalog.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const sort = page.getByLabel('Sort by');
  await sort.evaluate(element => window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 140), behavior: 'instant' }));
  const box = await sort.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
});

test('when the first reading of speech is not understood, the recogniser\'s next understood reading is used', async ({ page }) => {
  await page.evaluate(() => window.__speech.say('chews title', 'choose title'));
  await expect(page.getByLabel('Sort by')).toHaveValue('Title');
  await expect(status(page)).toContainText('Heard "choose title".');
});

test('a misheard command word is offered, and done only after a yes', async ({ page }) => {
  const sort = page.getByLabel('Sort by'), before = await sort.inputValue();
  await page.evaluate(() => window.__speech.say('chews newest'));
  await expect(status(page)).toContainText('Did you mean "choose newest"?');
  await expect(sort).toHaveValue(before);
  await page.evaluate(() => window.__speech.say('confirm'));
  await expect(sort).toHaveValue('Newest');
});
