import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const seen = [];
  errors.set(page, seen);
  page.on('pageerror', error => seen.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:4173' ? route.continue() : route.abort());
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

const panel = page => page.locator('#gaze-web-navigator section');
const tasks = page => page.getByRole('region', { name: 'Practice tasks' });
async function look(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}
async function say(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}

test('practice tasks are checked from the page, count instructions and mistakes, and download a report', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for the task flow');
  test.setTimeout(90000);
  await page.goto('/practice-site/index.html');
  // Only the home page invites; the run starts from there.
  await look(page, tasks(page).getByRole('button', { name: 'Start practice tasks' }));
  await say(page, 'click start practice tasks');
  await expect(tasks(page)).toContainText('Practice task 1 of 8');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Open the Catalog.');

  // A detour to the Help page is an unintended action for the first task.
  await look(page, page.getByRole('link', { name: 'Help', exact: true }));
  await say(page, 'open help');
  await page.waitForURL('**/help.html');
  await expect(tasks(page)).toContainText('Practice task 1 of 8');
  await look(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  await say(page, 'open catalog');
  await page.waitForURL('**/catalog.html');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Sort the catalog by price, low to high.');

  await look(page, page.getByLabel('Sort by'));
  await say(page, 'set sort by to price, low to high');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Search the site for “river”.');

  await look(page, page.getByRole('searchbox', { name: 'Search books' }));
  await say(page, 'search for river');
  await page.waitForURL('**/search.html?q=river');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Open The Quiet River and choose the Hardcover format.');

  // A request the navigator cannot place is counted, not acted on.
  await say(page, 'frobnicate the thing');
  await look(page, page.getByRole('link', { name: 'The Quiet River' }));
  await say(page, 'open the quiet river');
  await page.waitForURL('**/book.html');
  await look(page, page.getByLabel('Format'));
  await say(page, 'set format to hardcover');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Write the gift note “Happy birthday”.');

  await look(page, page.getByLabel('Gift note'));
  await say(page, 'type happy birthday');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Add The Quiet River to your cart.');

  await look(page, page.getByRole('button', { name: 'Add to cart' }));
  await say(page, 'click add to cart');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Scroll the reader reviews to the end.');

  // Skipping moves on and is reported as skipped.
  await look(page, tasks(page).getByRole('button', { name: 'Skip task' }));
  await say(page, 'click skip task');
  await expect(tasks(page).locator('.practice-task')).toHaveText('Go to Contact and choose the topic “Order problem”.');
  await look(page, page.getByRole('link', { name: 'Contact', exact: true }));
  await say(page, 'open contact');
  await page.waitForURL('**/contact.html');
  await look(page, page.getByLabel('Topic'));
  await say(page, 'set topic to order problem');

  await expect(tasks(page)).toContainText('Practice tasks finished');
  await expect(tasks(page).getByRole('status')).toContainText('7 of 8 tasks completed, 6 with nothing done by mistake.');
  const download = page.waitForEvent('download');
  await tasks(page).getByRole('button', { name: 'Download report' }).click();
  const report = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(report.kind).toBe('gaze-navigator-practice-report');
  expect(report.details.map(task => task.outcome)).toEqual(['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'skipped', 'completed']);
  expect(report.details[0]).toMatchObject({ instructions: 2, acted: 2, unintended: 1 });
  expect(report.details[0].events.map(event => event.text)).toEqual(['typed: “open help” → acted', 'opened help', 'typed: “open catalog” → acted']);
  expect(report.details[3]).toMatchObject({ instructions: 3, failed: 1, unintended: 0 });
  expect(report.details[6].instructions).toBe(0);
  expect(report.unintended).toBe(1);

  // The finished run stays with the tab until it is closed.
  await page.reload();
  await expect(tasks(page)).toContainText('Practice tasks finished');
  await tasks(page).getByRole('button', { name: 'Close' }).click();
  await expect(tasks(page)).toBeHidden();
});

test('consequential actions and other books in the cart count as mistakes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'one viewport is enough for the task flow');
  await page.goto('/practice-site/index.html');
  await tasks(page).getByRole('button', { name: 'Start practice tasks' }).click();
  await page.goto('/practice-site/catalog.html');
  // Sorting is the current task; adding a book is not.
  await page.getByRole('button', { name: 'Add to cart' }).nth(1).click();
  await page.goto('/practice-site/account.html');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.goto('/practice-site/catalog.html');
  await tasks(page).getByRole('button', { name: 'Stop practice' }).click();
  await expect(tasks(page).getByRole('status')).toContainText('1 of 8 tasks completed, 1 with nothing done by mistake.');
  const run = await page.evaluate(() => JSON.parse(sessionStorage.getItem('northwind-practice-run')));
  expect(run.tasks[1]).toMatchObject({ outcome: 'stopped', unintended: 3 });
  expect(run.tasks[1].events.map(event => event.text)).toEqual(['added Mountain Letters to the cart', 'opened account', 'pressed Delete account']);
  expect(run.tasks[2].outcome).toBe('not reached');
});
