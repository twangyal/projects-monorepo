import { test, expect } from '@playwright/test';
const panel = page => page.locator('#gaze-web-navigator section');
async function type(page, text) {
  await panel(page).getByLabel('Typed instruction', { exact: true }).fill(text);
  await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
}
async function hear(page, text, { final = true, finishOutput = false } = {}) {
  await page.evaluate(({ text, final, finishOutput }) => {
    if (finishOutput) window.spokenFeedback.at(-1)?.onend?.();
    const recognition = window.recognizers.at(-1);
    const index = recognition.index;
    if (!recognition.open) { recognition.onspeechstart?.(); recognition.open = true; }
    const result = Object.assign([{ transcript: text }], { isFinal: final });
    recognition.onresult?.({ resultIndex: index, results: Array.from({ length: index + 1 }, (_, n) => n === index ? result : Object.assign([{ transcript: '' }], { isFinal: true })) });
    if (final) { recognition.index++; recognition.open = false; }
  }, { text, final, finishOutput });
}
async function look(page, selector) {
  const target = page.locator(selector); await target.scrollIntoViewIfNeeded(); const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context')).toContainText(await target.innerText());
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.recognizers = []; window.spokenFeedback = []; window.feedbackCancels = 0;
    window.SpeechRecognition = class {
      constructor() { this.index = 0; window.recognizers.push(this); }
      start() { this.onstart?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      cancel() { window.feedbackCancels++; }, speak(utterance) { window.spokenFeedback.push(utterance); },
    } });
  });
  await page.goto('/practice-site/index.html');
  await page.evaluate(() => {
    window.deletedDrafts = 0;
    const button = document.createElement('button'); button.id = 'feedback-delete'; button.textContent = 'Delete draft';
    button.style.cssText = 'position:fixed;left:12px;top:90px;z-index:2'; button.onclick = () => window.deletedDrafts++; document.body.append(button);
  });
  await panel(page).getByText('Tracking and settings', { exact: true }).click();
  await panel(page).getByLabel('Speak feedback', { exact: true }).check();
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
});
test('recognized confirmation during spoken feedback cannot act, then a fresh confirmation can', async ({ page }) => {
  await look(page, '#feedback-delete'); await type(page, 'click delete draft');
  await expect(panel(page).locator('.status')).toContainText('confirm');
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await expect(panel(page).locator('.transcript')).toContainText('feedback');
  await hear(page, 'confirm', { finishOutput: true }); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('speech captured during output stays ignored when its final result arrives after output ends', async ({ page }) => {
  await look(page, '#feedback-delete'); await type(page, 'click delete draft');
  await hear(page, 'confirm', { final: false });
  await hear(page, 'confirm', { finishOutput: true }); expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('dictation ignores overlapping and late words, then keeps a deliberate phrase and immediate cancel', async ({ page }) => {
  await page.evaluate(() => {
    const field = document.createElement('textarea'); field.id = 'feedback-message'; field.setAttribute('aria-label', 'Message'); field.value = 'Draft';
    field.style.cssText = 'position:fixed;left:12px;top:12px;width:130px;height:65px;z-index:2'; document.body.append(field);
  });
  await look(page, '#feedback-message'); await type(page, 'start dictation into Message');
  await expect(panel(page).locator('.dictation')).toContainText('Message');
  await hear(page, 'words from feedback', { final: false });
  await hear(page, 'words from feedback', { finishOutput: true }); await expect(page.locator('#feedback-message')).toHaveValue('Draft');
  await hear(page, 'deliberate words'); await expect(page.locator('#feedback-message')).toHaveValue('Draft deliberate words');
  await hear(page, 'cancel', { final: false }); await expect(panel(page).locator('.dictation')).toBeHidden();
});
test('addressed confirmations are also blocked, while typed replies and spoken safety remain usable', async ({ page }) => {
  await panel(page).getByLabel('Require “Navigator” before spoken instructions', { exact: true }).check();
  await look(page, '#feedback-delete'); await type(page, 'click delete draft');
  await hear(page, 'Navigator confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await type(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
  await hear(page, 'Navigator pause', { final: false }); await expect(panel(page).getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await hear(page, 'Navigator pause'); await type(page, 'resume'); await hear(page, 'cancel'); await expect(panel(page).locator('.status')).toContainText('Cancelled');
});
test('turning feedback off cancels output but does not revive an overlapping unfinished phrase', async ({ page }) => {
  await look(page, '#feedback-delete'); await type(page, 'click delete draft'); await hear(page, 'confirm', { final: false });
  const before = await page.evaluate(() => window.feedbackCancels);
  await panel(page).getByLabel('Speak feedback', { exact: true }).uncheck(); expect(await page.evaluate(() => window.feedbackCancels)).toBeGreaterThan(before);
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('a superseded output completion cannot reopen command input during the current reply', async ({ page }) => {
  await type(page, 'pause'); await type(page, 'resume');
  await page.evaluate(() => window.spokenFeedback.at(-2).onend());
  await look(page, '#feedback-delete'); await hear(page, 'click delete draft');
  await expect(panel(page).getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0);
  await hear(page, 'click delete draft', { finishOutput: true }); await expect(panel(page).getByRole('button', { name: 'Confirm', exact: true })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Confirm', exact: true }).click(); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('output errors release speech and the next phrase captures a fresh page target', async ({ page }) => {
  await page.evaluate(() => {
    const button = document.createElement('button'); button.id = 'feedback-save'; button.textContent = 'Save draft';
    button.style.cssText = 'position:fixed;left:12px;top:12px;z-index:2'; window.savedDrafts = 0; button.onclick = () => window.savedDrafts++; document.body.append(button);
  });
  await type(page, 'resume'); await look(page, '#feedback-delete'); await hear(page, 'click it');
  await page.evaluate(() => window.spokenFeedback.at(-1).onerror());
  await page.evaluate(() => {
    document.querySelector('#feedback-delete').style.top = '-1000px';
    const area = document.createElement('div'); area.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:160px;background:white;z-index:3';
    const button = document.querySelector('#feedback-save'); area.append(button); document.body.append(area);
  });
  await look(page, '#feedback-save'); await hear(page, 'click it');
  expect(await page.evaluate(() => window.deletedDrafts)).toBe(0); expect(await page.evaluate(() => window.savedDrafts), await panel(page).locator('.status').innerText()).toBe(1);
});
for (const event of ['hidden', 'pagehide', 'stop']) test(`${event} cancels output and old completion cannot restart listening`, async ({ page }) => {
  await type(page, 'pause'); const before = await page.evaluate(() => ({ cancelled: window.feedbackCancels, spoken: window.spokenFeedback.length }));
  await page.evaluate(event => {
    if (event === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); }
    else if (event === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide'));
    else window.gazeNavigator.stop();
    window.spokenFeedback.at(-1).onend();
  }, event);
  expect(await page.evaluate(() => window.feedbackCancels)).toBeGreaterThan(before.cancelled);
  expect(await page.evaluate(() => window.spokenFeedback.length)).toBe(before.spoken);
  expect(await page.evaluate(() => window.recognizers.at(-1).aborted)).toBe(true);
  if (event === 'hidden') await expect(panel(page).getByRole('button', { name: 'Start listening', exact: true })).toBeVisible();
});
test('feedback starting midway through an existing capture also retires its later final', async ({ page }) => {
  await look(page, '#feedback-delete'); await hear(page, 'confirm', { final: false });
  await type(page, 'click delete draft'); await hear(page, 'confirm', { finishOutput: true });
  expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('a refused synthesis does not discard speech already in progress when no reply played', async ({ page }) => {
  await page.evaluate(() => { window.speechSynthesis.speak = () => { throw new Error('Not allowed'); }; });
  await look(page, '#feedback-delete'); await hear(page, 'confirm', { final: false }); await type(page, 'click delete draft');
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
for (const error of ['network', 'no-speech']) test(`${error} recognition error does not revive an overlapping late confirmation`, async ({ page }) => {
  await look(page, '#feedback-delete'); await type(page, 'click delete draft'); await hear(page, 'confirm', { final: false });
  await page.evaluate(error => window.recognizers.at(-1).onerror({ error }), error);
  await hear(page, 'confirm', { finishOutput: true }); expect(await page.evaluate(() => window.deletedDrafts)).toBe(0);
  await hear(page, 'confirm'); expect(await page.evaluate(() => window.deletedDrafts)).toBe(1);
});
test('returning from a hidden tab clears overlap even when the speech adapter stops without a reset event', async ({ page }) => {
  await type(page, 'pause'); await hear(page, 'resume', { final: false });
  await page.evaluate(() => {
    const recognition = window.recognizers.at(-1); recognition.onend = null;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));
  });
  await panel(page).getByLabel('Speak feedback', { exact: true }).uncheck();
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click(); await hear(page, 'resume');
  await expect(panel(page).getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});
