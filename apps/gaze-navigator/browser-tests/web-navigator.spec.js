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

test('search fallback into a message waits for confirmation before sending', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await page.locator('form.search').evaluate(form => form.remove());
  await look(page, page.getByLabel('Message', { exact: true }));
  await typeInstruction(page, 'find hello');
  await expect(status(page)).toContainText('may have consequences');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('');
  await expect(page.locator('.notice')).toBeEmpty();
  await panel(page).locator('.prompt').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue('hello');
  await expect(page.locator('.notice')).toHaveText('Practice message sent. Nothing left this page.');
});

test('pagehide and navigator stop discard queued speech confirmations', async ({ page }) => {
  for (const lifecycle of ['pagehide', 'stop']) {
    await page.goto('/practice-site/account.html');
    const start = panel(page).getByRole('button', { name: 'Start listening' });
    if (await start.count()) await start.click();
    await look(page, page.getByRole('button', { name: 'Delete account' }));
    await page.evaluate(() => window.__speech.say('delete account'));
    await expect(status(page)).toContainText('may have consequences');
    await page.evaluate(action => {
      if (action === 'stop') window.gazeNavigator.stop();
      else window.dispatchEvent(new PageTransitionEvent('pagehide'));
      window.__speech.say('confirm');
    }, lifecycle);
    await expect(page.locator('.notice')).toBeEmpty();
    expect(await page.evaluate(() => window.__speech.instances.at(-1).running)).toBe(false);
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('gaze-web-navigator')).listening)).toBe(true);
  }
});

test('a BFCache return shows stopped speech and permits an explicit restart', async ({ page }) => {
  await page.goto('/practice-site/account.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(panel(page).getByRole('button', { name: 'Start listening' })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => window.__speech.instances.at(-1).running)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('gaze-web-navigator')).listening)).toBe(true);
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  expect(await page.evaluate(() => window.__speech.instances.at(-1).running)).toBe(true);
  await page.evaluate(() => window.__speech.fail('not-allowed'));
  await expect(panel(page).getByRole('button', { name: 'Start listening' })).toHaveAttribute('aria-pressed', 'false');
});


test('spoken selection replaces and inserts inside website text with exact caret and undo', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const field = page.getByLabel('Message');
  await field.fill('Meet Tuesday at noon');
  await look(page, field);
  await field.evaluate(element => {
    element.focus();
    element.setSelectionRange(5, 12);
    window.__fieldEvents = [];
    for (const type of ['input', 'change']) element.addEventListener(type, event => window.__fieldEvents.push([event.type, element.value]));
  });
  const say = text => page.evaluate(text => window.__speech.say(text), text);
  await say('replace selected text with Friday');
  await expect(field).toHaveValue('Meet Friday at noon');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([11, 11]);
  expect(await page.evaluate(() => window.__fieldEvents)).toEqual([['input', 'Meet Friday at noon'], ['change', 'Meet Friday at noon']]);
  await say('undo');
  await expect(field).toHaveValue('Meet Tuesday at noon');
  await field.evaluate(element => element.setSelectionRange(5, 5));
  await say('insert "next " at the cursor');
  await expect(field).toHaveValue('Meet next Tuesday at noon');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([10, 10]);
  await say('move cursor to the start');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([0, 0]);
  await say('move cursor to the end');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([25, 25]);
  await say('select all text');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([0, 25]);
  await say('replace selected text with Done!');
  await expect(field).toHaveValue('Done!');
  await say('undo');
  await expect(field).toHaveValue('Meet next Tuesday at noon');
  await say('undo');
  await expect(field).toHaveValue('Meet Tuesday at noon');
  await say('undo');
  await expect(status(page)).toContainText('Nothing to undo');
});

test('spoken selection refuses incompatible fields and a missing selected range without text changes', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const field = page.getByLabel('Your name');
  await field.fill('Keep this');
  await look(page, field);
  await field.evaluate(element => { element.focus(); element.setSelectionRange(2, 2); });
  const say = text => page.evaluate(text => window.__speech.say(text), text);
  await say('replace selected text with lost');
  await expect(status(page)).toContainText('No text is selected');
  await say('undo');
  await expect(status(page)).toContainText('Nothing to undo');
  await page.evaluate(() => window.__speech.begin());
  await field.evaluate(element => { element.readOnly = true; });
  await say('insert lost at the cursor');
  await expect(status(page)).toContainText('does not support');
  await expect(field).toHaveValue('Keep this');
  await field.evaluate(element => { element.readOnly = false; });
  await field.evaluate(element => { element.type = 'email'; });
  await look(page, field);
  await say('select all text');
  await expect(status(page)).toContainText('does not support');
  await say('insert lost at the cursor');
  await expect(status(page)).toContainText('does not support');
  await expect(field).toHaveValue('Keep this');
});

test('native selection respects pause and direct command entry keeps the website selection', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const field = page.getByLabel('Your name');
  await field.fill('Ada Byron');
  await look(page, field);
  await field.evaluate(element => { element.focus(); element.setSelectionRange(4, 9); });
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('replace selected text with Lovelace');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('Ada Lovelace');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  await look(page, field);
  await page.evaluate(() => window.__speech.say('pause'));
  await page.evaluate(() => window.__speech.say('select all text'));
  await expect(status(page)).toContainText('Paused');
  await page.evaluate(() => window.__speech.say('insert lost at the cursor'));
  await expect(field).toHaveValue('Ada Lovelace');
});


test('fresh speech context keeps a focused read-only field from redirecting into a writable neighbor', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const field = page.getByLabel('Your name');
  await field.fill('Locked');
  await field.evaluate(element => {
    element.readOnly = true;
    element.focus();
    const neighbor = document.createElement('input');
    neighbor.id = 'writable-neighbor';
    neighbor.setAttribute('aria-label', 'Writable neighbor');
    neighbor.value = 'Keep';
    neighbor.style.cssText = 'position:fixed;top:50px;left:130px;width:120px;height:45px';
    element.style.cssText = 'position:fixed;top:50px;left:0;width:120px;height:45px';
    document.body.append(neighbor);
  });
  await page.mouse.move(125, 70);
  await expect(panel(page).locator('.context li', { hasText: 'Writable neighbor' })).toBeAttached();
  await page.evaluate(() => window.__speech.begin());
  await page.evaluate(() => window.__speech.say('insert lost at the cursor.'));
  await expect(status(page)).toContainText('does not support');
  await expect(field).toHaveValue('Locked');
  await expect(page.locator('#writable-neighbor')).toHaveValue('Keep');
});

test('ordinary speech refuses a focused read-only field without editing the writable neighbor', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const field = page.getByLabel('Your name');
  await field.fill('Keep Tuesday');
  await field.evaluate(element => {
    element.readOnly = true;
    element.focus();
    element.style.cssText = 'position:fixed;top:50px;left:0;width:120px;height:45px';
    const other = document.createElement('input');
    other.id = 'ordinary-neighbor';
    other.setAttribute('aria-label', 'Other message');
    other.value = 'Unrelated';
    other.style.cssText = 'position:fixed;top:50px;left:130px;width:120px;height:45px';
    document.body.append(other);
    window.__ordinaryEvents = [];
    for (const node of [element, other]) for (const type of ['input', 'change']) {
      node.addEventListener(type, event => window.__ordinaryEvents.push([event.type, node.value]));
    }
  });
  await page.mouse.move(125, 70);
  await expect(panel(page).locator('.context li', { hasText: 'Other message' })).toBeAttached();
  const say = text => page.evaluate(text => window.__speech.say(text), text);
  for (const command of ['type hello', 'clear it', 'replace Tuesday with Friday', 'delete last word', 'new line', 'undo']) {
    await page.evaluate(() => window.__speech.begin());
    await say(command);
    await expect(status(page)).toContainText('not writable');
  }
  await expect(field).toHaveValue('Keep Tuesday');
  await expect(page.locator('#ordinary-neighbor')).toHaveValue('Unrelated');
  expect(await page.evaluate(() => window.__ordinaryEvents)).toEqual([]);
  await say('type hello into other message');
  await expect(page.locator('#ordinary-neighbor')).toHaveValue('Unrelated hello');
  await expect(field).toHaveValue('Keep Tuesday');
});

test('late native and ARIA locks refuse speech without consuming text undo or dispatching edits', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const field = page.getByLabel('Your name');
  await field.fill('Keep');
  await look(page, field);
  await field.focus();
  const say = text => page.evaluate(text => window.__speech.say(text), text);
  await say('type this');
  await expect(field).toHaveValue('Keep this');
  const settledChanges = await field.evaluate(element => {
    const events = [];
    const changed = event => events.push({ type: event.type, trusted: event.isTrusted, value: element.value });
    element.addEventListener('change', changed);
    element.blur();
    element.removeEventListener('change', changed);
    return events;
  });
  console.log('Prior fixture edit settled before refusal monitoring:', JSON.stringify(settledChanges));
  await field.focus();
  await field.evaluate(element => {
    window.__lockedEvents = [];
    for (const type of ['input', 'change']) element.addEventListener(type, event => window.__lockedEvents.push(event.type));
  });
  for (const kind of ['readOnly', 'disabled', 'inert', 'aria-readonly', 'aria-disabled']) {
    await look(page, field);
    await field.focus();
    await page.evaluate(() => window.__speech.begin());
    await field.evaluate((element, kind) => {
      if (kind === 'readOnly' || kind === 'disabled') element[kind] = true;
      else element.setAttribute(kind, kind === 'inert' ? '' : 'true');
    }, kind);
    await say('clear it');
    await expect(status(page)).toContainText('not writable');
    await expect(field).toHaveValue('Keep this');
    await field.evaluate((element, kind) => {
      if (kind === 'readOnly' || kind === 'disabled') element[kind] = false;
      else element.removeAttribute(kind);
    }, kind);
  }
  expect(await page.evaluate(() => window.__lockedEvents)).toEqual([]);
  await look(page, field);
  await field.focus();
  await say('undo');
  await expect(field).toHaveValue('Keep');
  await say('undo');
  await expect(status(page)).toContainText('Nothing to undo');
});

test('live write guard follows native fields through shadow hosts and same-origin frames', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const checks = await page.evaluate(async () => {
    const { canWrite } = await import('/src/web/page-actions.js');
    const host = document.createElement('div');
    document.body.append(host);
    const field = document.createElement('input');
    host.attachShadow({ mode: 'open' }).append(field);
    const results = [canWrite(field)];
    host.inert = true;
    results.push(canWrite(field));
    host.inert = false;
    host.setAttribute('aria-readonly', 'true');
    results.push(canWrite(field));
    const frame = document.createElement('iframe');
    frame.srcdoc = '<input aria-label="Frame text">';
    const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
    document.body.append(frame);
    await loaded;
    const inside = frame.contentDocument.querySelector('input');
    results.push(canWrite(inside));
    frame.inert = true;
    results.push(canWrite(inside));
    frame.inert = false;
    frame.setAttribute('aria-disabled', 'true');
    results.push(canWrite(inside));
    return results;
  });
  expect(checks).toEqual([true, false, false, true, false, false]);
});

test('spoken phrase selection corrects interior text and counts repeated occurrences without a pointer range', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  await panel(page).getByRole('button', { name: 'Start listening' }).click();
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Meet Tuesday, then Tuesday');
  await field.blur();
  await look(page, field);
  await field.evaluate(element => {
    element.focus();
    element.setSelectionRange(2, 2);
    window.__phraseEvents = [];
    for (const type of ['input', 'change']) element.addEventListener(type, event => window.__phraseEvents.push(event.type));
  });
  const say = text => page.evaluate(text => window.__speech.say(text), text);
  const selection = () => field.evaluate(element => [element.selectionStart, element.selectionEnd]);
  await say('select text Tuesday');
  await expect(status(page)).toContainText('occurs 2 times');
  expect(await selection()).toEqual([2, 2]);
  await say('select third occurrence of Tuesday');
  await expect(status(page)).toContainText('Only 2');
  expect(await selection()).toEqual([2, 2]);
  await say('select second occurrence of Tuesday');
  expect(await selection()).toEqual([19, 26]);
  expect(await page.evaluate(() => window.__phraseEvents)).toEqual([]);
  await say('replace selected text with Friday');
  await expect(field).toHaveValue('Meet Tuesday, then Friday');
  expect(await selection()).toEqual([25, 25]);
  await say('select text missing');
  await expect(status(page)).toContainText('not found');
  expect(await selection()).toEqual([25, 25]);
  await say('undo');
  await expect(field).toHaveValue('Meet Tuesday, then Tuesday');
  await say('select first occurrence of Tuesday');
  expect(await selection()).toEqual([5, 12]);
  await say('undo');
  await expect(status(page)).toContainText('Nothing to undo');
  await say('pause');
  await say('select last occurrence of Tuesday');
  expect(await selection()).toEqual([5, 12]);
});

test('phrase selection preserves Unicode offsets, punctuation and quoted spaces in native fields', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const field = page.getByLabel('Your name');
  await field.fill('İ 😀 café a+b [x]. next ');
  await field.blur();
  await look(page, field);
  await field.focus();
  const selection = () => field.evaluate(element => [element.selectionStart, element.selectionEnd]);
  await typeInstruction(page, 'select text CAFÉ');
  expect(await selection()).toEqual([5, 9]);
  await typeInstruction(page, 'select text "a+b [x].".');
  expect(await selection()).toEqual([10, 18]);
  await typeInstruction(page, 'select text " next "');
  expect(await selection()).toEqual([18, 24]);
  await typeInstruction(page, 'insert " later " at the cursor');
  await expect(field).toHaveValue('İ 😀 café a+b [x]. later ');
  await typeInstruction(page, 'undo');
  await expect(field).toHaveValue('İ 😀 café a+b [x]. next ');
});

test('phrase selection refuses stale focus values and current locks without touching a neighbor', async ({ page }) => {
  await page.goto('/practice-site/contact.html');
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Meet Tuesday');
  await field.blur();
  await look(page, field);
  await field.evaluate(element => { element.focus(); element.setSelectionRange(2, 2); element.readOnly = true; });
  await typeInstruction(page, 'select text Tuesday');
  await expect(status(page)).toContainText('does not support');
  await expect(field).toHaveValue('Meet Tuesday');
  await expect(page.getByLabel('Your name')).toHaveValue('');
  const result = await field.evaluate(async element => {
    element.readOnly = false;
    element.blur();
    element.addEventListener('focus', () => { element.value = 'Changed by website'; }, { once: true });
    const { selectText } = await import('/src/web/page-actions.js');
    return selectText(element, 'phrase', { text: 'Tuesday' });
  });
  expect(result.ok).toBe(false);
  expect(result.message).toContain('changed');
  await expect(field).toHaveValue('Changed by website');
});
