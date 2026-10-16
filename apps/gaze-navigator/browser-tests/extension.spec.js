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
    const worker = existing ?? await context.waitForEvent('serviceworker');
    // Under load the worker can be reached before its global scope and extension APIs exist, so poll from here.
    await expect.poll(() => worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false), { timeout: 10000 }).toBe(true);
    await use(worker);
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

test('a calibration follows navigation in extension memory and is forgotten when the camera stops', async ({ context, control }) => {
  test.setTimeout(60000);
  await control.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready');
  await typeInstruction(page, 'use camera');
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. The circle now follows your gaze.', { timeout: 30000 });
  const stored = await control.evaluate(async () => (await chrome.storage.session.get('gaze-calibration'))['gaze-calibration']);
  expect(stored.samples).toHaveLength(36);
  expect(await page.evaluate(() => [sessionStorage.length, localStorage.length]), 'eye data never reaches website storage').toEqual([0, 0]);

  await page.goto('http://shop.example/contact');
  await expect(status(page)).toHaveText('Camera on with your earlier calibration. Say recalibrate if the circle drifts.');
  const id = await tabId(control, 'http://shop.example/*');
  const restored = await control.evaluate(async tab => (await chrome.scripting.executeScript({
    target: { tabId: tab }, func: () => globalThis.__fakeCamera.restored,
  }))[0].result, id);
  expect(restored).toBe(36);
  await expect(page.locator('#gaze-web-navigator .calibration-dot')).toHaveClass(/hidden/);

  // A different window size invalidates the mapping, so the next page calibrates again.
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width - 40, height: size.height });
  await page.goto('http://shop.example/about');
  await expect(status(page)).toContainText('The window size changed, so the camera needs calibrating again.');
  await expect(page.locator('#gaze-web-navigator .calibration-dot')).toHaveClass(/settling|sampling/);

  await typeInstruction(page, 'stop camera');
  await expect(status(page)).toHaveText('Camera off. The circle follows the pointer.');
  await expect.poll(() => control.evaluate(async () => Object.keys(await chrome.storage.session.get('gaze-calibration')).length)).toBe(0);
});

test('smarter matching runs in one shared offscreen document and acts on a differently named control', async ({ context, control }) => {
  await control.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready on "Example Shop"');
  await panel(page).locator('details.settings').evaluate(details => { details.open = true; });
  await panel(page).getByLabel('Smarter target matching').check();
  await expect(panel(page).locator('.assist-state')).toHaveText('Smarter target matching is on.');
  await look(page, page.getByRole('link', { name: 'About us' }));
  await typeInstruction(page, 'open the company story');
  await page.waitForURL('http://shop.example/about');
  await expect(status(page)).toContainText('Done: About us activated');
  // The model lives in the extension, not the website: nothing in the page's storage or globals.
  expect(await page.evaluate(() => [sessionStorage.length, localStorage.length, typeof window.__gazeTestAssistant])).toEqual([0, 0, 'undefined']);
  expect(await control.evaluate(() => chrome.offscreen.hasDocument()), 'one shared model host').toBe(true);
});

test('same-page restart recreates one live navigator and status follows a non-persistent navigation', async ({context,control}) => {
  const page=await context.newPage();await page.goto('http://shop.example/');
  const id=await tabId(control,'http://shop.example/*');
  const call=type=>control.evaluate(({type,id})=>chrome.runtime.sendMessage({type,tabId:id}),{type,id});
  for(let cycle=0;cycle<3;cycle++){
    expect(await call('gaze:start')).toBe('on');await expect(status(page)).toContainText('Ready on');await expect(overlay(page)).toHaveCount(1);
    expect(await call('gaze:status')).toEqual({on:true});
    expect(await call('gaze:stop')).toBe('off');await expect(overlay(page)).toHaveCount(0);expect(await call('gaze:status')).toEqual({on:false});
  }
  expect(await call('gaze:start')).toBe('on');await expect(status(page)).toContainText('Ready on');
  await page.goto('http://shop.example/about');await expect(overlay(page)).toHaveCount(0);
  expect(await call('gaze:status')).toEqual({on:false});
});

test('a held native startup can be stopped and cannot remove its newer replacement',async({context,control})=>{
 const page=await context.newPage();await page.goto('http://shop.example/');const id=await tabId(control,'http://shop.example/*');
 await control.evaluate(async tab=>chrome.scripting.executeScript({target:{tabId:tab},func:()=>{
  const get=chrome.storage.session.get.bind(chrome.storage.session);let first=true;
  chrome.storage.session.get=async keys=>{const result=await get(keys);if(first&&keys==='gaze-web-navigator'){first=false;chrome.storage.session.get=get;await new Promise(resolve=>{globalThis.releaseNavigatorStartup=resolve;});globalThis.oldNavigatorStartupReleased=true;}return result;};
 }}),id);
 const call=type=>control.evaluate(({type,id})=>chrome.runtime.sendMessage({type,tabId:id}),{type,id});
 expect(await call('gaze:start')).toBe('on');
 await expect.poll(()=>control.evaluate(async tab=>(await chrome.scripting.executeScript({target:{tabId:tab},func:()=>typeof globalThis.releaseNavigatorStartup}))[0].result,id)).toBe('function');
 expect(await call('gaze:stop')).toBe('off');await expect(overlay(page)).toHaveCount(0);
 expect(await call('gaze:start')).toBe('on');await expect(status(page)).toContainText('Ready on');
 await control.evaluate(async tab=>chrome.scripting.executeScript({target:{tabId:tab},func:()=>globalThis.releaseNavigatorStartup()}),id);
 await expect.poll(()=>control.evaluate(async tab=>(await chrome.scripting.executeScript({target:{tabId:tab},func:()=>globalThis.oldNavigatorStartupReleased}))[0].result,id)).toBe(true);
 await expect(overlay(page)).toHaveCount(1);expect(await call('gaze:status')).toEqual({on:true});
 expect(await call('gaze:stop')).toBe('off');await expect(overlay(page)).toHaveCount(0);
});

test('popup controls describe the actual page and explain protected-page recovery',async({context,control})=>{
 const page=await context.newPage();await page.goto('http://shop.example/');await page.bringToFront();await control.reload();
 await expect(control.locator('#state')).toHaveText('Off for this page.');
 await control.getByRole('button',{name:'Turn on for this page',exact:true}).click();await expect(status(page)).toContainText('Ready on');await expect(control.locator('#state')).toHaveText('On for this page.');
 await control.getByRole('button',{name:'Turn off for this page',exact:true}).click();await expect(overlay(page)).toHaveCount(0);await expect(control.locator('#state')).toHaveText('Off for this page.');
 await page.goto('chrome://version');await page.bringToFront();await control.reload();
 await expect(control.locator('#state')).toContainText('does not allow navigator access');await expect(control.locator('#toggle')).toBeDisabled();await expect(control.getByRole('button',{name:'Check this page again',exact:true})).toBeVisible();
});

test('registered page toggle leaves keyboard command entry free and retains website drafts',async({context,control})=>{
 const binding=await control.evaluate(async()=>({declared:chrome.runtime.getManifest().commands['toggle-navigator'].suggested_key.default,registered:(await chrome.commands.getAll()).find(command=>command.name==='toggle-navigator')}));
 expect(binding.declared).toBe('Alt+Shift+N');expect(binding.registered?.name).toBe('toggle-navigator');
 // A suggested key can legitimately be unassigned; do not mistake it for an active binding.
 expect(['','Alt+Shift+N']).toContain(binding.registered.shortcut);console.log('Actual page-toggle assignment:',JSON.stringify(binding.registered.shortcut));
 if(!binding.registered.shortcut)await expect(control.locator('#shortcut')).toContainText('No page on/off shortcut is assigned');
 else await expect(control.locator('#shortcut')).toContainText(`Page on/off: ${binding.registered.shortcut}`);
 const page=await context.newPage();await page.goto('http://shop.example/contact');const id=await tabId(control,'http://shop.example/*');
 expect(await control.evaluate(tab=>chrome.runtime.sendMessage({type:'gaze:start',tabId:tab}),id)).toBe('on');await expect(status(page)).toContainText('Ready on');
 const field=page.getByLabel('Message'),ordinary=panel(page).getByLabel('Typed instruction');
 await ordinary.fill('unfinished navigator draft');await field.fill('unfinished website draft');await field.focus();
 await page.keyboard.press('Alt+Shift+G');await page.keyboard.type('open home');
 await expect(field).toBeFocused();await expect(field).toHaveValue('unfinished website draft');await expect(ordinary).toHaveValue('open home');
 await page.keyboard.press('Escape');await expect(ordinary).toHaveValue('unfinished navigator draft');await expect(page).toHaveURL('http://shop.example/contact');expect(await field.evaluate(node=>node.readOnly)).toBe(false);
 await page.keyboard.press('Alt+Shift+G');await page.keyboard.type('pause');await page.keyboard.press('Enter');await expect(status(page)).toContainText(/paused/i);await expect(field).toHaveValue('unfinished website draft');await expect(ordinary).toHaveValue('unfinished navigator draft');
 expect(await control.evaluate(tab=>chrome.runtime.sendMessage({type:'gaze:status',tabId:tab}),id)).toEqual({on:true});
});


test('extension corrects selected native text on a strict-CSP website and keeps undo', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/contact');
  await expect(status(page)).toContainText('Ready');
  const field = page.getByLabel('Message');
  await field.fill('Meet Tuesday at noon');
  await look(page, field);
  await field.evaluate(element => { element.focus(); element.setSelectionRange(5, 12); });
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('replace selected text with Friday');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('Meet Friday at noon');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([11, 11]);
  await look(page, field);
  await typeInstruction(page, 'select all text');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([0, 19]);
  await typeInstruction(page, 'undo');
  await expect(field).toHaveValue('Meet Tuesday at noon');
  expect(await page.evaluate(() => [sessionStorage.length, localStorage.length])).toEqual([0, 0]);
});
