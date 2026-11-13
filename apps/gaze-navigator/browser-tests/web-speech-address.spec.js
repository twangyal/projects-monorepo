import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
async function hear(page, text, { final = true, alternatives = [] } = {}) {
  await page.evaluate(({ text, final, alternatives }) => {
    const recognition = window.recognizers.at(-1);
    recognition.onspeechstart?.();
    const result = Object.assign([text, ...alternatives].map(transcript => ({ transcript })), { isFinal: final });
    recognition.onresult?.({ resultIndex: recognition.index++, results: Array.from({ length: recognition.index }, (_, index) => index === recognition.index - 1 ? result : Object.assign([{ transcript: '' }], { isFinal: true })) });
  }, { text, final, alternatives });
}
async function look(page, target) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context')).toContainText(await target.innerText());
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.recognizers = [];
    window.SpeechRecognition = class {
      constructor() { this.index = 0; window.recognizers.push(this); }
      start() { this.onstart?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    };
  });
  await page.goto('/practice-site/index.html');
});
test('addressed speech ignores unaddressed commands and alternatives, then captures a fresh target', async ({ page }) => {
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await panel(page).getByLabel('Require “Navigator” before spoken instructions', { exact: true }).check();
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await look(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  await hear(page, 'open catalog', { alternatives: ['Navigator open catalog'] });
  await expect(panel(page).locator('.transcript')).toContainText('ignored');
  await expect(page).toHaveURL(/index.html$/);
  await hear(page, 'Navigator frobnicate the thing', { alternatives: ['open catalog'] });
  await expect(page).toHaveURL(/index.html$/);
  await look(page, page.getByRole('link', { name: 'Help', exact: true }));
  await hear(page, 'Navigator open help');
  await page.waitForURL('**/help.html');
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await expect(panel(page).getByLabel('Require “Navigator” before spoken instructions', { exact: true })).toBeChecked();
  await expect(panel(page).getByRole('button', { name: 'Stop listening', exact: true })).toBeVisible();
});
test('safety stays immediate and typed settings and commands recover while paused', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await hear(page, 'require navigator prefix');
  await expect(panel(page).locator('.status')).toContainText('Begin every spoken instruction');
  await hear(page, 'Navigator pause', { final: false });
  await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await hear(page, 'resume');
  await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await hear(page, 'Navigator turn off navigator prefix');
  await expect(panel(page).locator('.status')).toContainText('no longer require');
  await hear(page, 'resume');
  await expect(panel(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await hear(page, 'require navigator prefix');
  await hear(page, 'pause', { final: false });
  await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await panel(page).getByLabel('Typed instruction', { exact: true }).fill('turn off navigator prefix');
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
  await panel(page).getByLabel('Typed instruction', { exact: true }).fill('resume');
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
  await look(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  await panel(page).getByLabel('Typed instruction', { exact: true }).fill('open catalog');
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
  await page.waitForURL('**/catalog.html');
});

test('confirmation requires an address and changing the setting retires a pending target', async ({ page }) => {
  await page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'speech-delete'; button.textContent = 'Delete draft';
    button.style.cssText = 'position:fixed;left:12px;top:180px;z-index:2';
    window.deletedDrafts = 0; button.onclick = () => window.deletedDrafts++;
    document.body.append(button);
  });
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await hear(page, 'require navigator prefix');
  await look(page, page.locator('#speech-delete'));
  await hear(page, 'Navigator click delete draft');
  await expect(panel(page).locator('.status')).toContainText('Navigator confirm');
  await hear(page, 'confirm');
  expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await hear(page, 'Navigator confirm');
  expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
  await hear(page, 'Navigator click delete draft');
  await expect(panel(page).locator('.status')).toContainText('confirm');
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await panel(page).getByLabel('Require “Navigator” before spoken instructions', { exact: true }).uncheck();
  await hear(page, 'confirm');
  expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('dictation requires an address for every phrase and keeps the remaining words literal', async ({ page }) => {
  await page.evaluate(() => {
    const field = document.createElement('textarea'); field.id = 'speech-message'; field.setAttribute('aria-label', 'Message'); field.value = 'Draft';
    field.style.cssText = 'position:fixed;left:12px;top:12px;width:130px;height:65px;z-index:2'; document.body.append(field);
  });
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await hear(page, 'require navigator prefix');
  const field = page.locator('#speech-message'), box = await field.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context')).toContainText('Message');
  await hear(page, 'Navigator start dictation into Message');
  await expect(panel(page).locator('.dictation')).toContainText('Begin every spoken phrase');
  await hear(page, 'unaddressed words'); await expect(field).toHaveValue('Draft');
  await hear(page, 'Navigator more words'); await expect(field).toHaveValue('Draft more words');
  await hear(page, 'Navigator Navigator of the ship'); await expect(field).toHaveValue('Draft more words Navigator of the ship');
  await hear(page, 'cancel', { final: false });
  await expect(panel(page).locator('.dictation')).toBeHidden();
  await hear(page, 'Navigator unexpected words'); await expect(field).toHaveValue('Draft more words Navigator of the ship');
});

test('clarification teaches an addressed number while unaddressed answers stay ignored', async ({ page }) => {
  await page.evaluate(() => {
    window.chosenItem = 0;
    for (const n of [1, 2]) {
      const button = document.createElement('button'); button.id = `speech-choice-${n}`; button.textContent = 'Review item';
      button.style.cssText = `position:fixed;left:12px;top:${25 + 35 * n}px;z-index:2`;
      button.onclick = () => window.chosenItem = n; document.body.append(button);
    }
  });
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await hear(page, 'require navigator prefix');
  await look(page, page.locator('#speech-choice-1'));
  await expect(panel(page).locator('.context li').filter({ hasText: 'Review item' })).toHaveCount(2);
  await hear(page, 'Navigator click review item');
  await expect(panel(page).locator('.status')).toContainText('Navigator 1');
  await hear(page, '1'); expect(await page.evaluate(() => window.chosenItem)).toBe(0);
  await hear(page, 'Navigator 1'); expect(await page.evaluate(() => window.chosenItem)).toBe(1);
});
