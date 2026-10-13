import { test, expect } from '@playwright/test';

// A small stand-in for WaterSheep, installed before the page boots; the real model is measured by
// `npm run evaluate:instructions -- --watersheep DIR` and checked live in docs/2026-10-13-watersheep.md.
function installStandIn() {
  window.__assist = { calls: [], delay: 0, fail: false };
  const words = { 'book list': 'Catalog', 'reach you': 'Contact' };
  window.__gazeTestAssistant = {
    async decide(state, question, options) {
      window.__assist.calls.push({ state, options });
      await new Promise(resolve => setTimeout(resolve, window.__assist.delay));
      if (window.__assist.fail) throw new Error('model unavailable');
      const wanted = Object.entries(words).find(([phrase]) => state.includes(phrase))?.[1];
      const raw = options.map(option => (wanted && option.includes(`"${wanted}"`) ? 50 : 1));
      const sum = raw.reduce((a, b) => a + b, 0);
      return { probs: raw.map(value => value / sum) };
    },
    async yes() { return 0; },
  };
}

const state = new WeakMap();
test.beforeEach(async ({ page }) => {
  const evidence = { external: [], errors: [] };
  state.set(page, evidence);
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') { evidence.external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(installStandIn);
});
test.afterEach(async ({ page }) => {
  expect(state.get(page).external, 'nothing is downloaded or sent').toEqual([]);
  expect(state.get(page).errors).toEqual([]);
});

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function look(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}
async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}
async function turnOnMatching(page) {
  await panel(page).locator('details.settings').evaluate(details => { details.open = true; });
  await panel(page).getByLabel('Smarter target matching').check();
  await expect(panel(page).locator('.assist-state')).toHaveText('Smarter target matching is on.');
}

test('smarter matching is opt-in, picks a control named differently, and only sends names', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  await look(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  // Off by default: the rules alone cannot tell what "the book list" is.
  await typeInstruction(page, 'show me the book list');
  await expect(status(page)).toContainText('No control called "book list"');
  expect(await page.evaluate(() => window.__assist.calls.length)).toBe(0);

  await turnOnMatching(page);
  await page.evaluate(() => { window.__assist.delay = 300; });
  await typeInstruction(page, 'show me the book list');
  await expect(status(page)).toHaveText('Working out which control you mean…');
  await page.waitForURL('**/practice-site/catalog.html');
  await expect(status(page)).toContainText('Done: Catalog activated');
  // The setting persists for the tab session and loads again on the next page.
  await expect(panel(page).locator('.assist-state')).toHaveText('Smarter target matching is on.');
});

test('a newer instruction or cancel discards a pending model answer, and failures keep the rule answer', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  await turnOnMatching(page);
  await look(page, page.getByRole('link', { name: 'Contact', exact: true }));
  await page.evaluate(() => { window.__assist.delay = 600; });
  await typeInstruction(page, 'open the page to reach you');
  await expect(status(page)).toHaveText('Working out which control you mean…');
  await typeInstruction(page, 'cancel');
  await expect(status(page)).toHaveText('Cancelled.');
  await page.waitForTimeout(900);
  expect(new URL(page.url()).pathname).toBe('/practice-site/index.html');
  await expect(status(page)).toHaveText('Cancelled.');
  const sent = await page.evaluate(() => window.__assist.calls.at(-1));
  expect(sent.state).toBe('open the page to reach you');
  expect(sent.options.at(-1)).toBe('none of these');
  expect(sent.options.every(option => /^(link|button|text field|search field|dropdown|checkbox|clickable item|[a-z ]+) "/.test(option) || option === 'none of these')).toBe(true);

  await page.evaluate(() => { window.__assist.delay = 0; window.__assist.fail = true; });
  await typeInstruction(page, 'open the page to reach you');
  await expect(status(page)).toContainText('No control called');
  expect(new URL(page.url()).pathname).toBe('/practice-site/index.html');
});
