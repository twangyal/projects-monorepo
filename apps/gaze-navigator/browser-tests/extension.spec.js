import { test as base, expect, chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const extension = join(process.cwd(), 'dist', 'extension-test');

// A small third-party site with a strict CSP and no navigator code.
const SITE = {
  '/': ['Example Shop', '<nav><a href="/about">About us</a> <a href="/contact">Contact</a></nav><p>Welcome.</p><label>Playback volume<input id="volume" type="range" value="50"></label><button>Buy now</button>'],
  '/about': ['About Example Shop', '<p>We sell examples.</p><a href="/">Home</a>'],
  '/disclosure': ['Shop FAQ', '<details id="faq-panel"><summary>FAQ</summary><p>Answer</p></details>'],
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

// The camera and estimator run in an invisible extension frame, never in the website or its isolated world.
const captureFrame = page => page.frames().find(frame => /^chrome-extension:\/\/[^/]+\/capture\.html#/.test(frame.url()));

test('camera mode runs the estimator in an extension frame, not the website, and removes it on stop', async ({ context, control }) => {
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
  expect(await isolated(() => typeof globalThis.webgazer), 'nor to the content script').toBe('undefined');
  expect(await page.evaluate(() => document.querySelectorAll('video, iframe').length), 'the page sees no video or frame').toBe(0);
  await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. The circle now follows your gaze.', { timeout: 30000 });
  const frame = captureFrame(page);
  expect(frame, 'the capture frame belongs to the extension').toBeTruthy();
  const box = await page.getByRole('button', { name: 'Buy now' }).boundingBox();
  for (let i = 0; i < 15; i++) await frame.evaluate(([x, y]) => globalThis.webgazer.emit({ x, y }), [box.x + box.width / 2, box.y + box.height / 2]);
  await expect(panel(page).locator('.context li').first()).toHaveText('Button: Buy now');
  expect(await frame.evaluate(() => globalThis.__fakeCamera)).toEqual({ instances: 1, released: 0, faceVisible: true });
  await typeInstruction(page, 'stop camera');
  await expect(status(page)).toHaveText('Camera off. The circle follows the pointer.');
  // Removing the frame destroys its document, which releases the camera.
  await expect.poll(() => Boolean(captureFrame(page))).toBe(false);
});

test('a refused camera opens the Gaze Navigator setup tab instead of asking for the website', async ({ context, control }) => {
  await control.evaluate(() => { localStorage.setItem('gaze-fake-camera', 'denied'); return chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }); });
  const page = await context.newPage();
  await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready');
  const setup = context.waitForEvent('page', candidate => candidate.url().endsWith('/permissions.html'));
  await typeInstruction(page, 'use camera');
  await expect(status(page)).toContainText('Gaze Navigator needs permission to use the camera');
  await expect((await setup).getByRole('heading', { name: 'Allow the camera for Gaze Navigator' })).toBeVisible();
  await expect(panel(page).locator('.use-camera')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => Boolean(captureFrame(page))).toBe(false);
  await control.evaluate(() => localStorage.removeItem('gaze-fake-camera'));
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
  expect(await captureFrame(page).evaluate(() => globalThis.__fakeCamera.restored)).toBe(36);
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

test('extension ordinary edits preserve a focused readonly field and recheck confirmed search', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/contact');
  await expect(status(page)).toContainText('Ready');
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Keep this');
  await field.blur(); // Settle the fixture's earlier native fill before monitoring refusals.
  await field.evaluate(element => {
    element.readOnly = true;
    element.focus();
    element.style.cssText = 'position:fixed;top:50px;left:0;width:120px;height:45px';
    const other = document.createElement('textarea');
    other.id = 'extension-neighbor';
    other.setAttribute('aria-label', 'Other message');
    other.value = 'Unrelated';
    other.style.cssText = 'position:fixed;top:50px;left:130px;width:120px;height:45px';
    document.body.append(other);
    window.__extensionEdits = [];
    for (const node of [element, other]) for (const type of ['input', 'change']) {
      node.addEventListener(type, event => window.__extensionEdits.push(event.type));
    }
    window.__submitted = 0;
    const form = document.createElement('form');
    element.before(form);
    form.append(element);
    form.addEventListener('submit', event => { event.preventDefault(); window.__submitted++; });
  });
  await page.mouse.move(125, 70);
  await expect(panel(page).locator('.context li', { hasText: 'Other message' })).toBeAttached();
  await page.keyboard.press('Alt+Shift+G');
  await page.keyboard.type('clear it');
  await page.keyboard.press('Enter');
  await expect(status(page)).toContainText('not writable');
  await expect(field).toHaveValue('Keep this');
  await expect(page.locator('#extension-neighbor')).toHaveValue('Unrelated');
  // Search may deliberately select a search field; this page has none. Its
  // ordinary textarea must still be writable when confirmation is accepted.
  await field.evaluate(element => { element.readOnly = false; element.focus(); });
  await look(page, field);
  await typeInstruction(page, 'find replacement');
  await expect(status(page)).toContainText('may have consequences');
  await field.evaluate(element => { element.readOnly = true; });
  await typeInstruction(page, 'confirm');
  await expect(status(page)).toContainText('not writable');
  await expect(field).toHaveValue('Keep this');
  await expect(page.locator('#extension-neighbor')).toHaveValue('Unrelated');
  expect(await page.evaluate(() => window.__extensionEdits)).toEqual([]);
  expect(await page.evaluate(() => window.__submitted)).toBe(0);
  await field.evaluate(element => { element.readOnly = false; element.focus(); });
  await look(page, field);
  await typeInstruction(page, 'undo');
  await expect(status(page)).toContainText('Nothing to undo');
});

test('extension selects repeated phrases on strict-CSP content before exact correction and undo', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/contact');
  await expect(status(page)).toContainText('Ready');
  const field = page.getByLabel('Message', { exact: true });
  await field.fill('Meet Tuesday, then Tuesday');
  await field.blur();
  await look(page, field);
  await field.evaluate(element => {
    element.focus(); element.setSelectionRange(2, 2);
    window.__phraseEvents = [];
    for (const type of ['input', 'change']) element.addEventListener(type, event => window.__phraseEvents.push(event.type));
  });
  const command = async text => {
    await page.keyboard.press('Alt+Shift+G');
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  await command('select text Tuesday');
  await expect(status(page)).toContainText('occurs 2 times');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([2, 2]);
  await command('select last occurrence of Tuesday');
  expect(await field.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([19, 26]);
  expect(await page.evaluate(() => window.__phraseEvents)).toEqual([]);
  await command('replace selected text with Friday');
  await expect(field).toHaveValue('Meet Tuesday, then Friday');
  await command('undo');
  await expect(field).toHaveValue('Meet Tuesday, then Tuesday');
  await command('undo');
  await expect(status(page)).toContainText('Nothing to undo');
  expect(await page.evaluate(() => [sessionStorage.length, localStorage.length])).toEqual([0, 0]);
});


test('injected extension sets and undoes a real strict-CSP website slider', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();
  await page.goto('http://shop.example/');await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.evaluate(() => { window.rangeEvents=[];for (const type of ['input','change']) document.querySelector('#volume').addEventListener(type,event=>window.rangeEvents.push([type,event.target.value])); });
  const slider = page.getByLabel('Playback volume');await look(page,slider);
  await typeInstruction(page,'set Playback volume slider to 35');await expect(slider).toHaveValue('35');
  await expect(status(page)).toContainText('Slider set to 35');
  await typeInstruction(page,'undo Playback volume slider');await expect(slider).toHaveValue('50');
  expect(await page.evaluate(() => window.rangeEvents)).toEqual([['input','35'],['change','35'],['input','50'],['change','50']]);
});

test('injected extension check and uncheck retain requested native website state', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));
  const page=await context.newPage();await page.goto('http://shop.example/');await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.evaluate(()=>{
    const label=document.createElement('label');label.textContent='Newsletter';const input=document.createElement('input');input.type='checkbox';input.id='newsletter';label.append(input);document.body.prepend(label);
    window.checkEvents=[];for(const type of ['click','input','change'])input.addEventListener(type,()=>window.checkEvents.push([type,input.checked]));
  });
  const checkbox=page.getByLabel('Newsletter');await look(page,checkbox);
  await typeInstruction(page,'uncheck Newsletter');await expect(checkbox).not.toBeChecked();
  await typeInstruction(page,'check Newsletter');await expect(checkbox).toBeChecked();
  await typeInstruction(page,'check Newsletter');await expect(checkbox).toBeChecked();
  await expect(status(page)).toContainText('already checked');
  await typeInstruction(page,'uncheck Newsletter');await expect(checkbox).not.toBeChecked();
  expect(await page.evaluate(()=>window.checkEvents)).toEqual([['click',true],['input',true],['change',true],['click',false],['input',false],['change',false]]);
});

test('injected extension check commands observe website-owned custom switch updates',async({context,worker})=>{
 await worker.evaluate(()=>chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));
 const page=await context.newPage();await page.goto('http://shop.example/');await expect(status(page)).toContainText('Ready on "Example Shop"');
 await page.evaluate(()=>{
  const e=document.createElement('button');e.type='button';e.id='newsletter-switch';e.setAttribute('role','switch');e.setAttribute('aria-checked','false');e.textContent='Newsletter';document.body.prepend(e);
  window.ariaClicks=0;e.addEventListener('click',()=>{window.ariaClicks++;queueMicrotask(()=>e.setAttribute('aria-checked',e.getAttribute('aria-checked')==='true'?'false':'true'));});
 });
 const widget=page.getByRole('switch',{name:'Newsletter'});await look(page,widget);
 await typeInstruction(page,'check Newsletter');await expect(widget).toHaveAttribute('aria-checked','true');await expect(status(page)).toContainText('Switch checked');
 await typeInstruction(page,'tick Newsletter');await expect(status(page)).toContainText('already checked');expect(await page.evaluate(()=>window.ariaClicks)).toBe(1);
 await typeInstruction(page,'uncheck Newsletter');await expect(widget).toHaveAttribute('aria-checked','false');await expect(status(page)).toContainText('Switch unchecked');expect(await page.evaluate(()=>window.ariaClicks)).toBe(2);
});


test('injected extension selects a strict-CSP website radio without toggling repeated requests', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage(); await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.evaluate(() => {
    const group = document.createElement('fieldset');
    group.innerHTML = '<legend>Delivery</legend><label>Standard<input name="delivery" type="radio" checked></label><label>Express<input id="express" name="delivery" type="radio"></label>';
    document.body.prepend(group); window.radioClicks = 0;
    document.querySelector('#express').addEventListener('click', () => window.radioClicks++);
  });
  const radio = page.getByRole('radio', { name: 'Express' }); await look(page, radio);
  await typeInstruction(page, 'select Express radio button'); await expect(radio).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Standard' })).not.toBeChecked();
  await expect(status(page)).toContainText('Radio button selected');
  await typeInstruction(page, 'select Express radio button'); await expect(status(page)).toContainText('already selected');
  expect(await page.evaluate(() => window.radioClicks)).toBe(1);
});

test('injected extension selects a strict-CSP website tab and repeats without another click', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage(); await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.evaluate(() => {
    const group = document.createElement('div'); group.setAttribute('role', 'tablist'); group.setAttribute('aria-label', 'Product');
    group.innerHTML = '<button id="overview" type="button" role="tab" aria-selected="true" aria-controls="panel-a">Overview</button><button id="details" type="button" role="tab" aria-selected="false" aria-controls="panel-b">Details</button>';
    document.body.prepend(group); window.tabClicks = 0;
    document.querySelector('#details').addEventListener('click', event => {
      window.tabClicks++; queueMicrotask(() => { for (const tab of group.children) tab.setAttribute('aria-selected', String(tab === event.target)); });
    });
  });
  const tab = page.getByRole('tab', { name: 'Details', exact: true }); await look(page, tab);
  await typeInstruction(page, 'select Details tab'); await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute('aria-selected', 'false');
  await expect(status(page)).toContainText('Website tab selected');
  await typeInstruction(page, 'select Details tab'); await expect(status(page)).toContainText('already selected');
  expect(await page.evaluate(() => window.tabClicks)).toBe(1);
});

test('injected extension sets a strict-CSP numeric field with constraint refusal and exact Undo', async ({ context, worker }) => {
  await worker.evaluate(() => chrome.storage.local.set({ preferences: { autoStart: true, persist: false } }));
  const page = await context.newPage();await page.goto('http://shop.example/');
  await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.evaluate(() => {
    const label=document.createElement('label');label.textContent='Quantity';
    const input=document.createElement('input');input.type='number';input.id='quantity';input.value='2';input.min='0';input.max='10';label.append(input);document.body.prepend(label);
    window.numberEvents=[];for(const type of ['input','change'])input.addEventListener(type,()=>window.numberEvents.push([type,input.value]));
  });
  const input=page.locator('#quantity');await look(page,input);
  await typeInstruction(page,'set Quantity number field to 4');await expect(input).toHaveValue('4');await expect(status(page)).toContainText('Number field set to 4');
  expect(await page.evaluate(()=>window.numberEvents)).toEqual([['input','4'],['change','4']]);
  await typeInstruction(page,'set Quantity number field to 4.5');await expect(input).toHaveValue('4');await expect(status(page)).toContainText('current min, max or step');
  await typeInstruction(page,'undo Quantity number field');await expect(input).toHaveValue('2');
});

test('injected extension sets native ISO dates and refuses calendar constraints before Undo',async({context,worker})=>{await worker.evaluate(()=>chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));const page=await context.newPage();await page.goto('http://shop.example/');await expect(status(page)).toContainText('Ready on "Example Shop"');await page.evaluate(()=>{const l=document.createElement('label');l.textContent='Departure';const e=document.createElement('input');e.id='departure';e.type='date';e.value='2026-01-01';e.min='2026-01-01';e.max='2026-12-31';l.append(e);document.body.prepend(l);});const input=page.locator('#departure');await look(page,input);await expect(panel(page).locator('.context')).toContainText('Date field: Departure');await typeInstruction(page,'set Departure date field to 2026-11-01');await expect(input).toHaveValue('2026-11-01');await expect(status(page)).toContainText('Date field set to 2026-11-01');await typeInstruction(page,'set Departure date field to 2026-02-29');await expect(input).toHaveValue('2026-11-01');await expect(status(page)).toContainText('current calendar');await typeInstruction(page,'undo Departure date field');await expect(input).toHaveValue('2026-01-01');});

test('injected extension sets native appointment time and refuses step mismatch before Undo',async({context,worker})=>{await worker.evaluate(()=>chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));const page=await context.newPage();await page.goto('http://shop.example/');await expect(status(page)).toContainText('Ready on "Example Shop"');await page.evaluate(()=>{const l=document.createElement('label');l.textContent='Appointment';const e=document.createElement('input');e.id='appointment';e.type='time';e.value='09:00';e.min='08:00';e.max='18:00';e.step='900';l.append(e);document.body.prepend(l);});const input=page.locator('#appointment');await look(page,input);await expect(panel(page).locator('.context')).toContainText('Time field: Appointment');await typeInstruction(page,'set Appointment time field to 14:30');await expect(input).toHaveValue('14:30');await expect(status(page)).toContainText('Time field set to 14:30');await typeInstruction(page,'set Appointment time field to 14:31');await expect(input).toHaveValue('14:30');await expect(status(page)).toContainText('current clock');await typeInstruction(page,'undo Appointment time field');await expect(input).toHaveValue('09:00');});

for(const period of [{kind:'month',label:'Month',original:'2026-01',value:'2026-11',bad:'2026-02',max:'2026-12'},
 {kind:'week',label:'Week',original:'2026-W01',value:'2026-W43',bad:'2026-W02',max:'2026-W53'}]) {
 test(`injected extension sets native ${period.kind} with step refusal and exact Undo`,async({context,worker})=>{
  await worker.evaluate(()=>chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));const page=await context.newPage();await page.goto('http://shop.example/');await expect(status(page)).toContainText('Ready on "Example Shop"');
  await page.evaluate(p=>{const l=document.createElement('label');l.textContent='Reporting';const e=document.createElement('input');e.id='period';e.type=p.kind;e.value=p.original;e.min=p.original;e.max=p.max;e.step='2';l.append(e);document.body.prepend(l);window.periodEvents=[];for(const type of['input','change'])e.addEventListener(type,()=>periodEvents.push([type,e.value]));},period);
  const input=page.locator('#period');await look(page,input);await expect(panel(page).locator('.context')).toContainText(`${period.label} field: Reporting`);
  await typeInstruction(page,`set Reporting ${period.kind} field to ${period.value}`);await expect(input).toHaveValue(period.value);await expect(status(page)).toContainText(`${period.label} field set to ${period.value}`);expect(await page.evaluate(()=>periodEvents)).toEqual([['input',period.value],['change',period.value]]);
  await typeInstruction(page,`set Reporting ${period.kind} field to ${period.bad}`);await expect(input).toHaveValue(period.value);await expect(status(page)).toContainText('min, max or step');expect(await page.evaluate(()=>periodEvents)).toHaveLength(2);
  await typeInstruction(page,`undo Reporting ${period.kind} field`);await expect(input).toHaveValue(period.original);
 });
}


test('injected runtime preserves repeated explicit expand and collapse state', async ({context,worker}) => {
 await worker.evaluate(() => chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));
 const page=await context.newPage();await page.goto('http://shop.example/disclosure');
 await expect(status(page)).toContainText('Ready on');
 await look(page,page.locator('#faq-panel summary'));await typeInstruction(page,'expand FAQ');
 await expect(status(page)).toContainText('Panel expanded');await expect(page.locator('#faq-panel')).toHaveAttribute('open','');
 await look(page,page.locator('#faq-panel summary'));await typeInstruction(page,'expand FAQ');
 await expect(status(page)).toContainText('already expanded');await expect(page.locator('#faq-panel')).toHaveAttribute('open','');
 await look(page,page.locator('#faq-panel summary'));await typeInstruction(page,'collapse FAQ');
 await expect(status(page)).toContainText('Panel collapsed');await expect(page.locator('#faq-panel')).not.toHaveAttribute('open','');
});


test('installed deletion preserves selected native text Undo through overlay focus',async({context,worker})=>{
 await worker.evaluate(()=>chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));const page=await context.newPage();await page.goto('http://shop.example/contact');await expect(status(page)).toContainText('Ready on');const field=page.locator('textarea');await field.fill('Keep 🌓 remove\nend');await field.evaluate(e=>e.setSelectionRange(8,14));await look(page,field);await typeInstruction(page,'delete selected text');await expect(status(page)).toContainText('Selected text removed');await expect(field).toHaveValue('Keep 🌓 \nend');await look(page,field);await typeInstruction(page,'undo');await expect(field).toHaveValue('Keep 🌓 remove\nend');
});

async function activeSpeechFrame(page) {
  for (const frame of page.frames()) {
    if (/^chrome-extension:\/\/[^/]+\/capture\.html#/.test(frame.url()) && await frame.evaluate(() => Boolean(window.__extensionSpeech?.instances.length)).catch(() => false)) return frame;
  }
  return null;
}
async function listenInExtension(page) {
  await panel(page).getByRole('button', { name: 'Start listening', exact: true }).click();
  await expect.poll(async () => Boolean(await activeSpeechFrame(page))).toBe(true);
  return activeSpeechFrame(page);
}

test('extension speech owns its origin, retains utterance context and handles immediate pause before restart', async ({context,control}) => {
  await control.evaluate(() => chrome.storage.local.set({preferences:{autoStart:true,persist:true}}));
  const page=await context.newPage(); await page.goto('http://shop.example/contact'); await expect(status(page)).toContainText('Ready');
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const frame=await listenInExtension(page); const oldURL=frame.url();
  expect(new URL(oldURL).protocol).toBe('chrome-extension:');
  expect(new URL(oldURL).host).toBe(new URL(control.url()).host);
  expect(await page.evaluate(() => typeof window.__extensionSpeech)).toBe('undefined');
  const id=await tabId(control,'http://shop.example/*');
  expect(await control.evaluate(async tab => (await chrome.scripting.executeScript({target:{tabId:tab},func:()=>typeof globalThis.__extensionSpeech}))[0].result,id)).toBe('undefined');
  await look(page,page.getByLabel('Message')); await frame.evaluate(()=>window.__extensionSpeech.begin());
  await expect(panel(page).locator('.transcript')).toContainText('captured');
  await look(page,page.getByRole('link',{name:'Home',exact:true}));
  await frame.evaluate(()=>window.__extensionSpeech.say('type extension words')); await expect(page.getByLabel('Message')).toHaveValue('extension words');
  await frame.evaluate(()=>window.__extensionSpeech.say('pause',false,1)); await expect(panel(page).getByRole('button',{name:'Resume',exact:true})).toBeVisible();
  await frame.evaluate(()=>window.__extensionSpeech.say('pause',true,1));
  await panel(page).getByRole('button',{name:'Stop listening',exact:true}).click();
  await expect.poll(async()=>Boolean(await activeSpeechFrame(page))).toBe(false);
  const next=await listenInExtension(page); expect(next.url()).not.toBe(oldURL);
  await next.evaluate(()=>window.__extensionSpeech.say('resume')); await expect(panel(page).getByRole('button',{name:'Pause',exact:true})).toBeVisible();
  await page.goto('http://shop.example/'); await expect(status(page)).toContainText('Ready');
  expect(page.frames().some(f=>f.url()===oldURL || f.url()===next.url())).toBe(false);
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]); expect(errors).toEqual([]);
});

test('speech refusal opens extension microphone setup and typed instructions remain usable', async ({context,control}) => {
  await control.evaluate(() => chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));
  const page=await context.newPage(); await page.goto('http://shop.example/'); await expect(status(page)).toContainText('Ready');
  const frame=await listenInExtension(page);
  const opened=context.waitForEvent('page',p=>p.url().includes('/permissions.html?device=microphone'));
  await frame.evaluate(()=>window.__extensionSpeech.fail('not-allowed'));
  await expect(status(page)).toContainText('setup tab'); await expect(panel(page).getByRole('button',{name:'Start listening',exact:true})).toHaveAttribute('aria-pressed','false');
  const setup=await opened; await expect(setup.getByRole('heading',{name:'Allow the microphone for Gaze Navigator'})).toBeVisible();
  // Control only the native media boundary. No physical microphone is available in this suite.
  await setup.evaluate(()=>{window.__setupStops=0; navigator.mediaDevices.getUserMedia=async constraints=>{window.__setupConstraints=constraints;return{getTracks:()=>[{stop(){window.__setupStops++;}}]};};});
  await setup.getByRole('button',{name:'Allow microphone'}).click(); await expect(setup.locator('#status')).toContainText('Return to your tab');
  expect(await setup.evaluate(()=>({constraints:window.__setupConstraints,stops:window.__setupStops}))).toEqual({constraints:{audio:true},stops:1});
  await page.bringToFront(); await look(page,page.getByRole('link',{name:'About us'})); await typeInstruction(page,'open about us'); await page.waitForURL('http://shop.example/about');
  await expect(status(page)).toContainText('Ready');
});

test('camera and extension speech frames stop independently and microphone disconnect recovers', async ({context,control}) => {
  test.setTimeout(60000);
  await control.evaluate(() => chrome.storage.local.set({preferences:{autoStart:true,persist:false}}));
  const page=await context.newPage(); await page.goto('http://shop.example/'); await expect(status(page)).toContainText('Ready');
  const speech=await listenInExtension(page); const speechURL=speech.url();
  await typeInstruction(page,'use camera'); await expect(status(page)).toHaveText('Calibrated with 9 of 9 dots. The circle now follows your gaze.',{timeout:30000});
  await typeInstruction(page,'stop camera'); await expect(status(page)).toContainText('Camera off');
  expect((await activeSpeechFrame(page)).url()).toBe(speechURL);
  await speech.evaluate(()=>window.__extensionSpeech.say('pause')); await expect(panel(page).getByRole('button',{name:'Resume',exact:true})).toBeVisible();
  // Removing the owning native frame must retire its channel and leave a deliberate retry.
  const id=await tabId(control,'http://shop.example/*');
  await control.evaluate(async ({tab,url}) => chrome.scripting.executeScript({target:{tabId:tab},func:url=>{for(const f of document.getElementById('gaze-web-navigator').shadowRoot.querySelectorAll('iframe'))if(f.src===url)f.remove();},args:[url]}),{tab:id,url:speechURL});
  await expect(panel(page).getByRole('button',{name:'Start listening',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(status(page)).toContainText('microphone frame closed'); await listenInExtension(page);
});
