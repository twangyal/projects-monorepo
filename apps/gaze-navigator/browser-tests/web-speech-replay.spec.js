import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function deliver(page, text, index, final = true) {
  await page.evaluate(({ text, index, final }) => {
    const recognition = window.recognizers.at(-1);
    const results = Array.from({ length: index + 1 }, () => Object.assign([{ transcript: '' }], { isFinal: true }));
    results[index] = Object.assign([{ transcript: text }], { isFinal: final });
    recognition.onresult?.({ resultIndex: index, results });
  }, { text, index, final });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.recognizers = [];
    window.SpeechRecognition = class {
      constructor() { window.recognizers.push(this); }
      start() { this.onstart?.(); }
      abort() { this.onend?.(); }
    };
  });
  await page.goto('/practice-site/index.html');
  await page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'speech-counter'; button.textContent = 'Advance counter';
    button.style.cssText = 'position:fixed;left:12px;top:180px;z-index:2'; window.advances = 0; button.onclick = () => window.advances++;
    const field = document.createElement('textarea'); field.id = 'speech-message'; field.setAttribute('aria-label', 'Message'); field.value = 'Draft';
    field.style.cssText = 'position:fixed;left:12px;top:12px;width:130px;height:65px;z-index:2'; document.body.append(button, field);
  });
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
});
async function look(page, id, name) {
  const box = await page.locator(id).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context')).toContainText(name);
}
test('replayed finalized actions do nothing but a new result with the same words still acts', async ({ page }) => {
  await look(page, '#speech-counter', 'Advance counter');
  await deliver(page, 'click advance counter', 0);
  expect(await page.evaluate(() => window.advances)).toBe(1);
  await deliver(page, 'click advance counter', 0);
  expect(await page.evaluate(() => window.advances)).toBe(1);
  await deliver(page, 'pause', 0, false);
  await expect(panel(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await deliver(page, 'click advance counter', 1);
  expect(await page.evaluate(() => window.advances)).toBe(2);
});
test('dictation appends a finalized phrase once and native restart admits index zero again', async ({ page }) => {
  const field = page.locator('#speech-message'); await look(page, '#speech-message', 'Message');
  await deliver(page, 'start dictation into Message', 0);
  await expect(panel(page).locator('.dictation')).toBeVisible();
  await deliver(page, 'once', 1); await expect(field).toHaveValue('Draft once');
  await deliver(page, 'once', 1); await expect(field).toHaveValue('Draft once');
  await deliver(page, 'pause', 2, false);
  await deliver(page, 'pause', 2); await deliver(page, 'pause', 2);
  await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await page.evaluate(() => window.recognizers.at(-1).onend());
  await deliver(page, 'resume', 0);
  await expect(panel(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await deliver(page, 'start dictation into Message', 1);
  await deliver(page, 'fresh', 2); await expect(field).toHaveValue('Draft once fresh');
});
