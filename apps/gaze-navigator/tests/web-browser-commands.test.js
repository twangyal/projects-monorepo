import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { interpret, spokenAddress } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const source = await readFile('extension/background.js', 'utf8');
const page = { elements: [{ id: 1, name: 'Settings', role: 'button', distance: 0 }] };

test('browser commands are read from speech, and website addresses only when they are addresses', () => {
  const read = said => interpret(said, page);
  assert.deepEqual(read('refresh the page'), { type: 'reload' });
  assert.deepEqual(read('go to bbc dot co dot uk'), { type: 'visit', url: 'https://bbc.co.uk/' });
  assert.deepEqual(read('visit gov.uk slash browse'), { type: 'visit', url: 'https://gov.uk/browse' });
  assert.deepEqual(read('open github dot com in a new tab'), { type: 'tab', move: 'new', url: 'https://github.com/' });
  assert.deepEqual(read('next tab'), { type: 'tab', move: 'next' });
  assert.deepEqual(read('go back to the previous tab'), { type: 'tab', move: 'previous' });
  assert.deepEqual(read('close this tab'), { type: 'tab', move: 'close' });
  assert.deepEqual(read('make the page bigger'), { type: 'zoom', step: 'in' });
  assert.deepEqual(read('zoom out'), { type: 'zoom', step: 'out' });
  assert.deepEqual(read('reset zoom'), { type: 'zoom', step: 'reset' });
  assert.equal(read('top of the page').direction, 'top');
  // Controls, files and names with dots stay controls; an empty new tab is explained.
  assert.equal(read('open settings').type, 'activate');
  for (const said of ['node.js', 'report.pdf', 'index.html']) assert.equal(spokenAddress(said), null, said);
  assert.equal(interpret('open example.com', { elements: [{ id: 3, name: 'Example.com', role: 'link', distance: 0 }] }).targetId, 3);
  assert.match(read('new tab').message, /Say which website to open/);
});

test('the controller asks the browser, confirms closing a tab, and waits while paused', async () => {
  const asked = [];
  const controller = createController({ window: {}, interpret, commands: { browser: async action => { asked.push(action); return { ok: true, message: 'Done in the browser.' }; } } });
  const zoom = controller.handle('zoom in', page);
  assert.equal(zoom.message, 'Zooming…');
  assert.equal((await zoom.followUp).message, 'Done in the browser.');
  // "Again" zooms another step.
  await controller.handle('again', page).followUp;
  assert.deepEqual(asked, [{ type: 'zoom', step: 'in' }, { type: 'zoom', step: 'in' }]);
  asked.length = 0;
  const close = controller.handle('close this tab', page);
  assert.equal(close.tone, 'question');
  assert.deepEqual(asked, []);
  await controller.handle('confirm', page).followUp;
  assert.deepEqual(asked.at(-1), { type: 'tab', move: 'close' });
  controller.handle('pause', page);
  assert.match(controller.handle('reload', page).message, /^Paused/);
  assert.equal(asked.length, 1);
  // Without a browser to ask (a page without the extension's help), it says so.
  assert.match(createController({ window: {}, interpret }).handle('reload', page).message, /not available/);
});

function background({ access = true, zoom = 1 } = {}) {
  let listener, onUpdated;
  const scripts = [];
  const calls = [], tabs = [{ id: 7, index: 0, windowId: 1 }, { id: 8, index: 1, windowId: 1 }];
  const chrome = {
    runtime: { getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: { setAccessLevel: async () => {}, get: async () => ({}), set: async () => {} }, local: { get: async () => ({}) } },
    permissions: { contains: async () => access }, commands: { onCommand: { addListener() {} } },
    tabs: { onUpdated: { addListener(fn) { onUpdated = fn; } }, onRemoved: { addListener() {} }, onActivated: { addListener() {} },
      reload: async id => calls.push(['reload', id]), update: async (id, change) => calls.push(['update', id, change]),
      create: async spec => { calls.push(['create', spec]); return { id: 9 }; }, remove: async id => calls.push(['remove', id]),
      getZoom: async () => zoom, setZoom: async (id, value) => calls.push(['zoom', id, value]), query: async () => tabs },
    action: { setBadgeText: async () => {}, setTitle: async () => {} },
    // The navigator is not yet running in a tab it is asked to start in; asked to stop, it stops.
    scripting: { executeScript: async spec => { scripts.push([spec.target.tabId, spec.files?.[0] ?? (spec.args?.[0] ?? 'stop')]); return [{ result: spec.args?.[0] }]; } },
  };
  vm.runInNewContext(source, { chrome, console, setTimeout, URL });
  const send = (action, sender = { tab: tabs[0], frameId: 0 }) => new Promise(resolve => { if (!listener({ type: 'gaze:browser', action }, sender, resolve)) resolve(null); });
  const loaded = (tabId, url = 'https://example.com/') => onUpdated(tabId, { status: 'complete' }, { id: tabId, url });
  return { send, calls, scripts, loaded };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 300));

test('the extension carries out browser commands for the tab that asked', async () => {
  const { send, calls } = background({ zoom: 1.1 });
  assert.equal((await send({ type: 'reload' })).message, 'Reloading the page.');
  assert.equal((await send({ type: 'visit', url: 'https://bbc.co.uk/' })).message, 'Opening bbc.co.uk.');
  assert.equal((await send({ type: 'zoom', step: 'in' })).message, 'Zoomed to 125%. Camera gaze may land beside your look until you say recalibrate.');
  assert.equal((await send({ type: 'tab', move: 'next' })).message, 'Switched to tab 2 of 2.');
  assert.equal((await send({ type: 'tab', move: 'new', url: 'https://github.com/' })).message, 'Opened github.com in a new tab.');
  // (Objects made inside the extension's sandbox are compared by value.)
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(0, 4))), [['reload', 7], ['update', 7, { url: 'https://bbc.co.uk/' }], ['zoom', 7, 1.25], ['update', 8, { active: true }]]);
  // Only web addresses are opened, and only the navigator in a tab's top frame may ask.
  assert.equal((await send({ type: 'visit', url: 'javascript:alert(1)' })).ok, false);
  assert.equal((await send({ type: 'visit', url: 'chrome://settings' })).ok, false);
  assert.equal(await send({ type: 'reload' }, { tab: { id: 7, index: 0, windowId: 1 }, frameId: 3 }), null);
  // Without access to all websites, the reply says how to turn the navigator back on.
  assert.match((await background({ access: false }).send({ type: 'reload' })).message, /turn it back on/);
});

test('the navigator carries on in the page or tab a browser command leads to, and leaves the tab behind', async () => {
  const { send, scripts, loaded } = background();
  // A page it was asked to load starts the navigator once loaded; a later load the user started does not.
  await send({ type: 'visit', url: 'https://example.com/' });
  await loaded(7);
  assert.deepEqual(scripts.splice(0), [[7, 'start'], [7, 'content.js']]);
  await loaded(7);
  assert.deepEqual(scripts, []);
  // Switching tabs starts it in the tab switched to, then stops it in the tab left.
  await send({ type: 'tab', move: 'next' });
  await settle();
  assert.deepEqual(scripts.splice(0), [[8, 'start'], [8, 'content.js'], [7, 'stop'], [7, 'stop']]);
  // A new tab starts it once its page has loaded.
  await send({ type: 'tab', move: 'new', url: 'https://github.com/' });
  await loaded(9);
  await settle();
  assert.deepEqual(scripts.splice(0).filter(([tab]) => tab === 9), [[9, 'start'], [9, 'content.js']]);
  // Without access to all websites nothing is started or stopped: the reply says how to turn it on.
  const limited = background({ access: false });
  await limited.send({ type: 'tab', move: 'next' });
  await limited.send({ type: 'visit', url: 'https://example.com/' });
  await limited.loaded(7);
  await settle();
  assert.deepEqual(limited.scripts, []);
});
