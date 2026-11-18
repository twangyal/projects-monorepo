import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
const logState = page => panel(page).locator('.log-state');
async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}
async function lookAt(page, locator) {
  await locator.evaluate(element => window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 140), behavior: 'instant' }));
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}
const addToCart = (page, title) => page.locator(`.add-to-cart[data-title="${title}"]`);
async function openSettings(page) {
  await panel(page).locator('details.settings').evaluate(details => { details.open = true; });
}
async function download(page) {
  const [file] = await Promise.all([page.waitForEvent('download'), panel(page).getByRole('button', { name: 'Download log' }).click()]);
  expect(file.suggestedFilename()).toMatch(/^gaze-navigator-log-\d{4}-\d{2}-\d{2}\.json$/);
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}

test('a session log is off until turned on, keeps each instruction across pages and downloads as a file', async ({ page }) => {
  await page.goto('/practice-site/catalog.html');
  await expect(status(page)).toContainText('Ready');
  await openSettings(page);
  await expect(logState(page)).toHaveText('Logging is off.');
  await typeInstruction(page, 'scroll down');
  await expect(logState(page)).toHaveText('Logging is off.');
  await expect(panel(page).getByRole('button', { name: 'Download log' })).toBeDisabled();

  await panel(page).getByLabel('Keep a log of instructions in this tab').check();
  await expect(logState(page)).toHaveText('Logging is on. No instructions logged yet.');
  await lookAt(page, addToCart(page, 'The Quiet River'));
  await typeInstruction(page, 'add to cart');
  await expect(status(page)).toContainText('Add to cart');
  await expect(logState(page)).toHaveText('1 instruction logged on 1 website.');
  await typeInstruction(page, 'flibbertigibbet wobble');
  await expect(logState(page)).toHaveText('2 instructions logged on 1 website.');
  // An instruction that leaves the page is logged before it goes.
  await lookAt(page, page.getByRole('link', { name: 'Account', exact: true }));
  await typeInstruction(page, 'open account');
  await expect(page).toHaveURL(/account\.html$/);
  await expect(status(page)).toContainText('Now on "Account');
  await openSettings(page);
  await expect(logState(page)).toHaveText('3 instructions logged on 1 website.');
  await expect(panel(page).getByLabel('Keep a log of instructions in this tab')).toBeChecked();

  const log = await download(page);
  expect(log.kind).toBe('gaze-navigator-session-log');
  expect(log.instructions).toBe(3);
  expect(log.entries.map(entry => entry.outcome)).toEqual(['acted', expect.stringMatching(/failed|other|asked/), 'acted']);
  for (const entry of log.entries) {
    expect(entry).toMatchObject({ via: 'typed', pointer: 'mouse', site: new URL(page.url()).hostname });
    expect(entry.tookMs).toBeGreaterThanOrEqual(0);
    // What was said and the replies are left out unless asked for.
    expect(entry).not.toHaveProperty('said');
    expect(entry).not.toHaveProperty('reply');
  }
  await expect(logState(page)).toHaveText('Downloaded 3 instructions.');
});

test('the words are logged only when asked for, and clearing takes a second press', async ({ page }) => {
  await page.goto('/practice-site/catalog.html');
  await expect(status(page)).toContainText('Ready');
  await openSettings(page);
  const words = panel(page).getByLabel('Include what was said and the replies');
  await expect(words).toBeDisabled();
  await panel(page).getByLabel('Keep a log of instructions in this tab').check();
  await words.check();
  await lookAt(page, addToCart(page, 'Mountain Letters'));
  await typeInstruction(page, 'add to cart');
  await expect(logState(page)).toHaveText('1 instruction logged on 1 website.');
  const [entry] = (await download(page)).entries;
  expect(entry.said).toBe('add to cart');
  expect(entry.reply).toContain('Add to cart');

  // Turning logging off keeps what was logged.
  await panel(page).getByLabel('Keep a log of instructions in this tab').uncheck();
  await typeInstruction(page, 'scroll down');
  await expect(logState(page)).toHaveText('1 instruction logged on 1 website; logging is off.');

  const clear = panel(page).getByRole('button', { name: 'Clear log' });
  await clear.click();
  await expect(logState(page)).toHaveText('Press Clear log again to delete 1 logged instruction.');
  await expect(panel(page).getByRole('button', { name: 'Download log' })).toBeEnabled();
  await clear.click();
  await expect(logState(page)).toHaveText('The log is cleared.');
  await expect(panel(page).getByRole('button', { name: 'Download log' })).toBeDisabled();
  await expect(clear).toBeDisabled();
});
