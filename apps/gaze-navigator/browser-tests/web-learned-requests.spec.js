import { test, expect } from '@playwright/test';

// A request the navigator only offers, confirmed by voice once, then acted on directly; kept for the tab's session
// on the practice website and forgotten by voice.
const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');
async function hear(page, text) {
  await page.evaluate(text => {
    const r = window.learnRecognition, index = r.index++;
    r.onspeechstart?.();
    const results = Array.from({ length: index + 1 }, () => Object.assign([{ transcript: '' }], { isFinal: true }));
    results[index] = Object.assign([{ transcript: text }], { isFinal: true });
    r.onresult?.({ resultIndex: index, results });
  }, text);
}
async function look(page, selector) {
  const target = page.locator(selector);
  await target.evaluate(element => window.scrollTo({ top: Math.max(0, element.getBoundingClientRect().top + window.scrollY - 140), behavior: 'instant' }));
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}
async function open(page) {
  await page.goto('/practice-site/contact.html');
  await expect(status(page)).toContainText('Ready');
  await page.evaluate(() => {
    document.querySelector('main').innerHTML = '<h1>News</h1><p><button id="subscribe">Subscribe to our newsletter</button></p><p><a href="#help">Help</a></p>';
    window.subscribed = 0;
    document.querySelector('#subscribe').addEventListener('click', () => window.subscribed++);
  });
  // A tab already listening, after a reload, keeps listening.
  const start = panel(page).getByRole('button', { name: 'Start listening', exact: true });
  if (await start.isVisible()) await start.click();
  await look(page, '#subscribe');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.SpeechRecognition = class {
      constructor() { this.index = 0; window.learnRecognition = this; }
      start() { this.onstart?.(); }
      abort() { this.onend?.(); }
    };
  });
});

test('a request confirmed once by voice acts directly next time, after a reload too, until forgotten', async ({ page }) => {
  await open(page);
  await hear(page, 'something about a newsletter');
  await expect(status(page)).toContainText('Did you mean "Subscribe to our newsletter"?');
  expect(await page.evaluate(() => window.subscribed)).toBe(0);
  await hear(page, 'yes');
  await expect(status(page)).toContainText('Next time, “something about a newsletter” does this without asking.');
  expect(await page.evaluate(() => window.subscribed)).toBe(1);
  await hear(page, 'something about a newsletter');
  await expect(status(page)).toContainText('(Learned from an earlier yes.)');
  expect(await page.evaluate(() => window.subscribed)).toBe(2);
  // The tab keeps it across a reload; asked, the navigator says what it learned.
  await page.reload();
  await open(page);
  await hear(page, 'what have you learned');
  await expect(status(page)).toContainText('1 learned from your answers, latest first: “something about a newsletter” for subscribe to our newsletter.');
  await hear(page, 'something about a newsletter');
  await expect(status(page)).toContainText('(Learned from an earlier yes.)');
  expect(await page.evaluate(() => window.subscribed)).toBe(1);
  await hear(page, 'forget what you learned');
  await expect(status(page)).toContainText('Forgot the one request learned from your answers.');
  await hear(page, 'something about a newsletter');
  await expect(status(page)).toContainText('Did you mean "Subscribe to our newsletter"?');
});

test('a typed request is not learned, since a page could type it', async ({ page }) => {
  await open(page);
  const typed = async text => {
    await panel(page).getByLabel('Typed instruction', { exact: true }).fill(text);
    await panel(page).getByRole('button', { name: 'Do it', exact: true }).click();
  };
  await typed('something about a newsletter');
  await expect(status(page)).toContainText('Did you mean "Subscribe to our newsletter"?');
  await typed('yes');
  await expect(status(page)).not.toContainText('Next time');
  expect(await page.evaluate(() => window.subscribed)).toBe(1);
  await typed('something about a newsletter');
  await expect(status(page)).toContainText('Did you mean "Subscribe to our newsletter"?');
});
