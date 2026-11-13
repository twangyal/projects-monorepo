import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function type(page, text) {
  await panel(page).getByLabel('Typed instruction', { exact: true }).fill(text);
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
}
async function hear(page, text, finishOutput = false) {
  await page.evaluate(({ text, finishOutput }) => {
    if (finishOutput) window.helpOutput.at(-1)?.onend?.();
    const r = window.helpRecognition, index = r.index++;
    r.onspeechstart?.();
    const results = Array.from({ length: index + 1 }, () => Object.assign([{ transcript: '' }], { isFinal: true }));
    results[index] = Object.assign([{ transcript: text }], { isFinal: true });
    r.onresult?.({ resultIndex: index, results });
  }, { text, finishOutput });
}
async function look(page, selector) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
async function listening(page) { await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click(); }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.helpOutput = [];
    window.SpeechRecognition = class {
      constructor() { this.index = 0; window.helpRecognition = this; }
      start() { this.onstart?.(); }
      abort() { this.onend?.(); }
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() {}, speak(utterance) { window.helpOutput.push(utterance); },
    } });
  });
  await page.goto('/practice-site/contact.html');
  await expect(panel(page).getByLabel('Typed instruction', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const area = document.createElement('div'); area.style.cssText = 'position:fixed;left:8px;top:8px;width:220px;z-index:2;background:white';
    area.innerHTML = '<textarea id="help-message" aria-label="Help message" style="width:200px;height:70px">PRIVATE DRAFT</textarea><button id="help-delete" style="display:block;margin-top:25px">Delete draft</button>';
    document.body.append(area); window.helpWrites = 0; window.helpDeletes = 0;
    area.querySelector('textarea').addEventListener('input', () => window.helpWrites++);
    area.querySelector('button').onclick = () => window.helpDeletes++;
  });
});

test('spoken help gives field guidance without values or edits and stays usable with a collapsed panel', async ({ page }) => {
  await listening(page); await look(page, '#help-message'); await hear(page, 'what can I say');
  await expect(panel(page).locator('.status')).toContainText('type hello');
  await expect(panel(page).locator('.status')).not.toContainText('PRIVATE DRAFT');
  await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT');
  expect(await page.evaluate(() => window.helpWrites)).toBe(0);
  await hear(page, 'hide the navigator'); await hear(page, 'what can I say here');
  await expect(panel(page).locator('.status')).toBeVisible();
  await expect(panel(page).locator('.status')).toContainText('type hello');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('help preserves a confirmation and its original target after looking elsewhere', async ({ page }) => {
  await listening(page); await look(page, '#help-delete'); await hear(page, 'click delete draft');
  await expect(panel(page).getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await look(page, '#help-message'); await hear(page, 'what can I say');
  await expect(panel(page).locator('.status')).toContainText('Waiting for confirmation');
  await expect(panel(page).getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.helpDeletes)).toBe(0);
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.helpDeletes)).toBe(1);
  await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT');
});

test('help keeps a numbered clarification answer available', async ({ page }) => {
  await page.evaluate(() => {
    const area = document.createElement('div'); area.style.cssText = 'position:fixed;left:10px;top:200px;z-index:2;background:white';
    area.innerHTML = '<button id="help-first">Details</button><button id="help-second">Details</button>';
    document.body.append(area); window.helpChoices = [];
    for (const [index, button] of [...area.children].entries()) button.onclick = () => window.helpChoices.push(index + 1);
  });
  await listening(page);
  const first = await page.locator('#help-first').boundingBox(), second = await page.locator('#help-second').boundingBox();
  await page.mouse.move((first.x + first.width / 2 + second.x + second.width / 2) / 2, first.y + first.height / 2);
  await hear(page, 'click details'); await expect(panel(page).locator('.status')).toContainText('Which');
  await hear(page, 'help with the navigator'); await expect(panel(page).locator('.status')).toContainText('1, 2');
  expect(await page.evaluate(() => window.helpChoices)).toEqual([]);
  await hear(page, 'two'); expect(await page.evaluate(() => window.helpChoices)).toEqual([2]);
});

test('dictation help keeps its selected field and Undo while ordinary help questions stay literal', async ({ page }) => {
  await listening(page); await look(page, '#help-message'); await hear(page, 'start dictation into Help message');
  await hear(page, 'hello'); await hear(page, 'help with the navigator');
  await expect(panel(page).locator('.status')).toContainText('Dictation is active');
  await expect(panel(page).locator('.dictation')).toBeVisible();
  await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT hello');
  await hear(page, 'undo typing'); await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT');
  await hear(page, 'what can I say'); await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT what can I say');
  await hear(page, 'help with the navigator'); await hear(page, 'stop dictation'); await expect(panel(page).locator('.dictation')).toBeHidden();
});

test('addressed help teaches the prefix and gives paused recovery without resuming', async ({ page }) => {
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await panel(page).getByLabel('Require “Navigator” before spoken instructions', { exact: true }).check();
  await listening(page); await look(page, '#help-message'); await hear(page, 'what can I say');
  await expect(panel(page).locator('.transcript')).toContainText('ignored');
  await hear(page, 'Navigator what can I say'); await expect(panel(page).locator('.status')).toContainText('Navigator help with the navigator');
  await hear(page, 'pause'); await hear(page, 'Navigator help with the navigator');
  await expect(panel(page).locator('.status')).toContainText('resume');
  await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT');
});

test('following the addressed help example during dictation never inserts help text', async ({ page }) => {
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await panel(page).getByLabel('Require “Navigator” before spoken instructions', { exact: true }).check();
  await listening(page); await look(page, '#help-message');
  await hear(page, 'Navigator start dictation into Help message');
  await hear(page, 'Navigator help with the navigator');
  await expect(panel(page).locator('.status')).toContainText('Navigator help with the navigator');
  await hear(page, 'Navigator help with the navigator');
  await expect(page.locator('#help-message')).toHaveValue('PRIVATE DRAFT');
  await expect(panel(page).locator('.dictation')).toBeVisible();
  expect(await page.evaluate(() => window.helpWrites)).toBe(0);
});

test('spoken help uses feedback output and overlapping commands remain blocked', async ({ page }) => {
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await panel(page).getByLabel('Speak feedback', { exact: true }).check();
  await listening(page); await look(page, '#help-message'); await hear(page, 'what can I say', true);
  expect(await page.evaluate(() => window.helpOutput.at(-1).text)).toContain('type hello');
  expect(await page.evaluate(() => window.helpOutput.at(-1).text)).not.toContain('PRIVATE DRAFT');
  await look(page, '#help-delete'); await hear(page, 'click delete draft');
  await expect(panel(page).locator('.transcript')).toContainText('feedback');
  await expect(panel(page).getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await hear(page, 'pause'); await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});

test('website Help stays reachable and the panel teaches the explicit dictation exception', async ({ page }) => {
  await panel(page).getByText('What can I say?', { exact: true }).click();
  await expect(panel(page).getByText('During dictation, say', { exact: false })).toContainText('help with the navigator');
  await panel(page).getByText('What can I say?', { exact: true }).click();
  await look(page, 'a[href="help.html"]');
  await type(page, 'open help'); await expect(page).toHaveURL(/help.html$/);
});
