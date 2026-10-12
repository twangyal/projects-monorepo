import { test as base, expect, chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const extension = join(process.cwd(), 'dist', 'extension-test');

// A small third-party site with a strict CSP and no navigator code.
const SITE = {
  '/': ['Example Shop', '<nav><a href="/about">About us</a> <a href="/contact">Contact</a></nav><p>Welcome.</p><button>Buy now</button>'],
  '/about': ['About Example Shop', '<p>We sell examples.</p><a href="/">Home</a>'],
  '/contact': ['Contact Example Shop', '<label>Message <textarea></textarea></label><a href="/">Home</a>'],
};
const html = path => {
  const [title, body] = SITE[path] ?? ['Not found', '<a href="/">Home</a>'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'"></head>
    <body><h1>${title}</h1>${body}</body></html>`;
};

const test = base.extend({
  context: async ({ viewport }, use, testInfo) => {
    const directory = mkdtempSync(join(tmpdir(), 'gaze-extension-'));
    const launch = testInfo.project.use.launchOptions ?? {};
    const context = await chromium.launchPersistentContext(directory, {
      ...launch,
      // Extensions need full Chromium; the headless shell cannot load them.
      ...(launch.executablePath ? {} : { channel: 'chromium' }),
      headless: true,
      viewport,
      args: [...(launch.args ?? []), `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    await context.route('http://shop.example/**', route => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ contentType: 'text/html', body: html(path) });
    });
    await use(context);
    await context.close();
    rmSync(directory, { recursive: true, force: true });
  },
  worker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? await context.waitForEvent('serviceworker'));
  },
  // An extension page used to talk to the background worker and the isolated world.
  control: async ({ context, worker }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    await use(page);
  },
});

test.beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build-extension.js', '--test'], { stdio: 'ignore' });
});

const overlay = page => page.locator('#gaze-web-navigator');
const panel = page => page.locator('#gaze-web-navigator section');
const status = page => panel(page).locator('.status');

async function tabId(control, url) {
  return control.evaluate(async pattern => (await chrome.tabs.query({ url: pattern }))[0].id, url);
}

async function typeInstruction(page, text) {
  await panel(page).getByLabel('Typed instruction').fill(text);
  await panel(page).getByRole('button', { name: 'Do it' }).click();
}

async function look(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(panel(page).locator('.context li').first()).toBeAttached();
}

test('starts automatically on a strict-CSP website, acts there, and follows navigation', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready on "Example Shop"');
  expect(await panel(page).evaluate(node => getComputedStyle(node).position), 'styles survive the page CSP').toBe('fixed');
  await look(page, page.getByRole('link', { name: 'About us' }));
  await expect(panel(page).locator('.context li').first()).toHaveText('Link: About us');
  await typeInstruction(page, 'open about us');
  await page.waitForURL('http://shop.example/about');
  await expect(status(page)).toContainText('Done: About us activated. Now on "About Example Shop"');
  expect(await page.evaluate(() => [sessionStorage.length, localStorage.length]), 'nothing is written to the website storage').toEqual([0, 0]);
  expect(await page.evaluate(() => typeof window.__gazeNavigatorRunning), 'the isolated world is invisible to the page').toBe('undefined');
  expect(errors).toEqual([]);
});

test('a tab can be turned on and off, and stays on across navigation only while enabled', async ({ context, control }) => {
  await control.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: false, persist: true } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/');
  await expect(overlay(page)).toHaveCount(0);
  const id = await tabId(control, 'http://shop.example/*');
  expect(await control.evaluate(tab => chrome.runtime.sendMessage({ type: 'gaze:toggle', tabId: tab }), id)).toBe('on');
  await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.goto('http://shop.example/contact');
  await expect(status(page)).toContainText('Ready on "Contact Example Shop"');
  await look(page, page.getByLabel('Message'));
  await typeInstruction(page, 'type hello from the extension');
  await expect(page.getByLabel('Message')).toHaveValue('hello from the extension');
  expect(await control.evaluate(tab => chrome.runtime.sendMessage({ type: 'gaze:toggle', tabId: tab }), id)).toBe('off');
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator('#gaze-web-navigator-spacer')).toHaveCount(0);
  await page.goto('http://shop.example/about');
  await page.waitForTimeout(500);
  await expect(overlay(page)).toHaveCount(0);
  expect(await control.evaluate(tab => chrome.runtime.sendMessage({ type: 'gaze:status', tabId: tab }), id)).toEqual({ on: false });
});

test('protected browser pages report a clear error', async ({ context, control }) => {
  const page = await context.newPage();
  await page.goto('chrome://version');
  // Without the tabs permission chrome:// URLs are hidden, so take the newest tab.
  const id = await control.evaluate(async () => (await chrome.tabs.query({})).sort((a, b) => a.index - b.index).at(-1).id);
  expect(await control.evaluate(tab => chrome.runtime.sendMessage({ type: 'gaze:toggle', tabId: tab }), id)).toMatch(/cannot run on this page/);
});

test('camera mode loads the bundled estimator into the isolated world and releases it on stop', async ({ context, control }) => {
  test.setTimeout(60000);
  await control.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready');
  const id = await tabId(control, 'http://shop.example/*');
  const isolated = (func, args = []) => control.evaluate(async ({ tab, source, args }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab }, func: new Function(`return (${source})(...arguments)`), args });
    return result.result;
  }, { tab: id, source: func.toString(), args });
  await typeInstruction(page, 'use camera');
  await expect(status(page)).toContainText(/Look at dot 1 of 9/);
  expect(await page.evaluate(() => typeof window.webgazer), 'the estimator is not exposed to the website').toBe('undefined');
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. The circle now follows your gaze.', { timeout: 30000 });
  const box = await page.getByRole('button', { name: 'Buy now' }).boundingBox();
  for (let i = 0; i < 15; i++) {
    await isolated((x, y) => globalThis.webgazer.emit({ x, y }), [box.x + box.width / 2, box.y + box.height / 2]);
  }
  await expect(panel(page).locator('.context li').first()).toHaveText('Button: Buy now');
  await typeInstruction(page, 'stop camera');
  await expect(status(page)).toHaveText('Camera off. The circle follows the pointer.');
  expect(await isolated(() => globalThis.__fakeCamera)).toEqual({ instances: 1, released: 1, faceVisible: true });
});
