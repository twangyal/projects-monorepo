import { test, expect } from '@playwright/test';

const evidence = new WeakMap();

// A controllable stand-in for the browser's SpeechRecognition, installed before page scripts run.
function installFakeSpeech() {
  window.__speech = { instances: [] };
  window.SpeechRecognition = class {
    constructor() { window.__speech.instances.push(this); this.running = false; }
    start() { this.running = true; this.onstart?.(); }
    abort() { this.running = false; this.onend?.(); }
  };
  const current = () => window.__speech.instances.at(-1);
  let index = 0;
  window.__speech.begin = () => current().onspeechstart?.();
  window.__speech.say = (text, isFinal = true) => {
    const results = [];
    results[index] = Object.assign([{ transcript: text }], { isFinal });
    current().onresult({ resultIndex: index, results });
    if (isFinal) index++;
  };
  window.__speech.fail = error => current().onerror({ error });
}

test.beforeEach(async ({ page }) => {
  const state = { external: [], errors: [] };
  evidence.set(page, state);
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== 'http://127.0.0.1:4173') {
      state.external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(installFakeSpeech);
});
test.afterEach(async ({ page }) => {
  expect(evidence.get(page).external, 'the practice site and navigator stay local').toEqual([]);
  expect(evidence.get(page).errors, 'page must not throw').toEqual([]);
});

const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');

// Brings the element into the upper part of the viewport, clear of the panel, then "looks" at it.
async function look(page, locator) {
  await locator.evaluate(element => {
    const top = element.getBoundingClientRect().top + window.scrollY - Math.min(140, window.innerHeight * 0.2);
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  });
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}

async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}

async function setCircle(page, size) {
  await panel(page).locator('details.settings').evaluate(details => { details.open = true; });
  await panel(page).getByLabel('Circle size').selectOption(size);
}

test('ordinary page controls are discovered, numbered, and opened from a typed instruction', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  await expect(status(page)).toContainText('Ready on "Home');
  await look(page, page.getByRole('link', { name: 'Catalog', exact: true }));
  await expect(panel(page).locator('.context li').first()).toHaveText('Link: Catalog');
  await expect(page.locator('#gaze-web-navigator .outline .badge').first()).toHaveText('1');
  // Moving onto the panel keeps the page context for typing.
  await typeInstruction(page, 'open catalog');
  await page.waitForURL('**/practice-site/catalog.html');
  await expect(status(page)).toContainText('Done: Catalog activated. Now on "Catalog');
});

test('speech context is captured when speaking starts, even if gaze moves before the words finish', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  await expect(panel(page).getByRole('button', { name: 'Stop listening' })).toHaveAttribute('aria-pressed', 'true');
  await look(page, page.getByLabel('Your name'));
  await page.evaluate(() => window.__speech.begin());
  await look(page, page.getByLabel('Message'));
  await page.evaluate(() => window.__speech.say('type Ada Lovelace'));
  await expect(page.getByLabel('Your name')).toHaveValue('Ada Lovelace');
  await expect(page.getByLabel('Message')).toHaveValue('');
  // Later utterances in the same session are captured at their first interim words.
  await page.evaluate(() => window.__speech.say('type please', false));
  await look(page, page.getByLabel('Your name'));
  await page.evaluate(() => window.__speech.say('type please hold my order until Tuesday'));
  await expect(page.getByLabel('Message')).toHaveValue('please hold my order until Tuesday');
  await expect(page.getByLabel('Your name')).toHaveValue('Ada Lovelace');
  await look(page, page.getByLabel('Message'));
  await page.evaluate(() => window.__speech.say('replace Tuesday with Friday'));
  await page.evaluate(() => window.__speech.say('delete last word'));
  await expect(page.getByLabel('Message')).toHaveValue('please hold my order until');
  await page.evaluate(() => window.__speech.say('undo'));
  await expect(page.getByLabel('Message')).toHaveValue('please hold my order until Friday');
});

test('ambiguous targets are outlined, answered by number, and still confirmed when consequential', async ({ page }) => {
  await page.goto('/practice-site/account.html');
  const remove = page.getByRole('button', { name: 'Remove' });
  await look(page, remove.nth(1));
  await expect(panel(page).locator('.context li', { hasText: 'Button: Remove' })).toHaveCount(3);
  await typeInstruction(page, 'remove');
  await expect(status(page)).toContainText('Which one?');
  await expect(page.locator('#gaze-web-navigator .outline.question')).toHaveCount(3);
  const second = await panel(page).locator('.context li', { hasText: 'Button: Remove' }).evaluateAll(items => items.map(item => item.value));
  // Choose the visually middle Remove button by the number shown on it.
  const middle = await remove.nth(1).evaluate(button => button.getBoundingClientRect().top);
  const numbers = await page.locator('#gaze-web-navigator .outline.question').evaluateAll(boxes =>
    boxes.map(box => ({ number: box.textContent, top: box.getBoundingClientRect().top + 3 })));
  const chosen = numbers.find(entry => Math.abs(entry.top - middle) < 2).number;
  expect(second).toContain(Number(chosen));
  await panel(page).locator('.prompt').getByRole('button', { name: `${chosen}: Remove` }).click();
  await expect(status(page)).toContainText('may have consequences');
  await expect(page.locator('.notice')).toBeEmpty();
  await panel(page).locator('.prompt').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.notice')).toHaveText('Mountain Letters removed from saved books (practice).');
});

test('consequential actions wait for confirmation, and cancel leaves the page unchanged', async ({ page }) => {
  await page.goto('/practice-site/account.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  await look(page, page.getByRole('button', { name: 'Delete account' }));
  await page.evaluate(() => window.__speech.say('delete account'));
  await expect(status(page)).toContainText('may have consequences');
  await expect(panel(page).locator('.prompt').getByRole('button', { name: 'Confirm' })).toBeVisible();
  await page.evaluate(() => window.__speech.say('cancel'));
  await expect(status(page)).toHaveText('Cancelled. Nothing was changed.');
  await expect(page.locator('.notice')).toBeEmpty();
  await page.evaluate(() => window.__speech.say('delete account'));
  await page.evaluate(() => window.__speech.say('confirm'));
  await expect(page.locator('.notice')).toHaveText('Practice account deletion. Nothing was deleted.');
});

test('spoken pause blocks actions, an interim cancel acts immediately, and resume restores control', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  await look(page, page.getByRole('link', { name: 'Contact', exact: true }));
  await page.evaluate(() => window.__speech.say('pause'));
  await expect(panel(page).getByRole('button', { name: 'Resume' })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => window.__speech.say('open contact'));
  await expect(status(page)).toContainText('Paused');
  await expect(page).toHaveURL(/index\.html$/);
  await page.evaluate(() => window.__speech.say('resume'));
  await look(page, page.getByRole('checkbox', { name: 'Email me weekly picks' }));
  await page.evaluate(() => window.__speech.say('check email me weekly picks'));
  await expect(page.getByRole('checkbox', { name: 'Email me weekly picks' })).toBeChecked();
  await page.evaluate(() => window.__speech.say('stop', false));
  await expect(status(page)).toHaveText('Cancelled.');
});

test('dropdowns, scroll regions, search, and back navigation work without annotations', async ({ page }) => {
  await page.goto('/practice-site/book.html');
  await look(page, page.getByLabel('Format'));
  await typeInstruction(page, 'choose large print');
  await expect(page.getByLabel('Format')).toHaveValue('Large print');
  await look(page, page.getByLabel('Reader reviews'));
  await typeInstruction(page, 'scroll down');
  await expect.poll(() => page.getByLabel('Reader reviews').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(status(page)).toHaveText('Region scrolled down.');
  await typeInstruction(page, 'search for river');
  await page.waitForURL('**/search.html?q=river');
  await expect(page.getByRole('link', { name: 'The Quiet River' })).toBeVisible();
  await typeInstruction(page, 'go back');
  await page.waitForURL('**/book.html');
});

test('unsafe links are refused and speech failures leave typed control available', async ({ page }) => {
  await page.goto('/practice-site/index.html');
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'javascript:document.title="hijacked"';
    link.textContent = 'Strange offer';
    document.querySelector('main').prepend(link);
  });
  await look(page, page.getByRole('link', { name: 'Strange offer' }));
  await typeInstruction(page, 'open strange offer');
  await expect(status(page)).toHaveText('Links using javascript: are not opened by the navigator.');
  await expect(page).toHaveTitle(/Home/);
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  await page.evaluate(() => window.__speech.fail('not-allowed'));
  await expect(status(page)).toContainText('permission was refused');
  await expect(panel(page).getByRole('button', { name: 'Start listening' })).toHaveAttribute('aria-pressed', 'false');
  await look(page, page.getByRole('link', { name: 'Account', exact: true }));
  await typeInstruction(page, 'open account');
  await page.waitForURL('**/account.html');
});

test('controls inside web components, same-origin frames and script-only cards are reachable', async ({ page }) => {
  await page.goto('/practice-site/help.html');
  await look(page, page.locator('.topic', { hasText: 'Shipping and returns' }));
  await expect(panel(page).locator('.context li').first()).toHaveText('Clickable: Shipping and returns');
  await typeInstruction(page, 'open shipping and returns');
  await expect(page.locator('.notice')).toHaveText('Orders ship within two days. Returns are free for 30 days (practice).');

  // Playwright's CSS locators pierce open shadow roots, like the navigator now does.
  await look(page, page.locator('nb-feedback button', { hasText: 'Not helpful' }));
  await expect(panel(page).locator('.context li', { hasText: 'Button: Not helpful' })).toHaveCount(1);
  await typeInstruction(page, 'not helpful');
  await expect(page.locator('.notice')).toHaveText('Thanks for your feedback: Not helpful.');
  await look(page, page.locator('nb-feedback input'));
  await typeInstruction(page, 'type great selection into comment');
  await expect(page.locator('nb-feedback input')).toHaveValue('great selection');

  const frame = page.frameLocator('iframe.ask');
  await look(page, page.locator('iframe.ask'));
  await look(page, frame.getByLabel('Your question'));
  await expect(panel(page).locator('.context li', { hasText: 'Text field: Your question' })).toHaveCount(1);
  await typeInstruction(page, 'type when do you open');
  await expect(frame.getByLabel('Your question')).toHaveValue('when do you open');
  await look(page, frame.getByRole('button', { name: 'Ask' }));
  const button = await frame.getByRole('button', { name: 'Ask' }).boundingBox();
  await expect.poll(() => page.locator('#gaze-web-navigator .outline').evaluateAll(boxes => boxes.map(box => Math.round(box.getBoundingClientRect().top + 3))),
    { message: 'outlines inside frames use page coordinates' }).toContain(Math.round(button.y));
  await typeInstruction(page, 'ask');
  await expect(status(page)).toContainText('may have consequences');
  await typeInstruction(page, 'confirm');
  await expect(frame.locator('.notice')).toHaveText('Practice question received: when do you open');

  // Cross-origin (sandboxed) frames cannot be read; the user is told instead of seeing nothing.
  await page.locator('iframe.map').evaluate(element => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 120, behavior: 'instant' }));
  const map = await page.locator('iframe.map').boundingBox();
  await page.mouse.move(map.x + 40, map.y - 10);
  await expect(panel(page).locator('.context li.unreachable')).toHaveText('Store map: content from another site that the navigator cannot reach');
});

test('typed corrections still reach the field that had focus before the instruction box', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await look(page, page.getByLabel('Message'));
  await typeInstruction(page, 'type Meet on Tuesday');
  await expect(page.getByLabel('Message')).toHaveValue('Meet on Tuesday');
  // Typing the next instruction moves focus into the panel; the correction still means the message field.
  await look(page, page.getByLabel('Message'));
  await typeInstruction(page, 'change Tuesday to Friday');
  await expect(page.getByLabel('Message')).toHaveValue('Meet on Friday');
  // Once focus has left for the page background, a correction is not guessed onto the old field.
  await page.mouse.click(5, 300);
  await look(page, page.getByLabel('Message'));
  await typeInstruction(page, 'change Friday to Monday');
  await expect(status(page)).toContainText('first select the text field');
  await expect(page.getByLabel('Message')).toHaveValue('Meet on Friday');
});

test('a disclosure toggle inside a form opens without a confirmation; the form\'s real submit still asks', async ({ page }) => {
  await page.goto('/practice-site/search.html?q=river');
  const toggle = page.getByRole('button', { name: 'Filter and sort' });
  await look(page, toggle);
  await typeInstruction(page, 'open filter and sort');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(status(page)).toHaveText('Filter and sort activated.');
  await look(page, page.getByRole('button', { name: 'Apply filters' }));
  await typeInstruction(page, 'apply filters');
  await expect(status(page)).toContainText('may have consequences');
  await typeInstruction(page, 'cancel');
  await expect(page).toHaveURL(/search\.html\?q=river$/);
  // "Hide the filters" closes the open toggle.
  await look(page, toggle);
  await typeInstruction(page, 'hide the filters');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#filter-panel')).toBeHidden();
});
