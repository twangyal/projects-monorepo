import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createTrialStore } from '../src/web/trial-store.js';
import { interpret, spokenAddress } from '../src/web/interpreter.js';
import { createController } from '../src/web/controller.js';

const source = (await readFile('extension/background.js', 'utf8')).replace(/^import .*createTrialStore.*\n/m, '');
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

function background({ access = true, zoom = 1, storage = { get: async () => ({}) }, openTabs, failTab, failStartTab } = {}) {
  let listener, onUpdated;
  const scripts = [], queries = [], sessionWrites = [];
  const calls = [], tabs = openTabs ?? [{ id: 7, index: 0, windowId: 1 }, { id: 8, index: 1, windowId: 1 }];
  const chrome = {
    runtime: { getURL: p => 'chrome-extension://test/' + p, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { session: { setAccessLevel: async () => {}, get: async () => ({}), set: async value => { sessionWrites.push(value); } }, local: storage },
    permissions: { contains: async () => access }, commands: { onCommand: { addListener() {} } },
    tabs: { onUpdated: { addListener(fn) { onUpdated = fn; } }, onRemoved: { addListener() {} }, onActivated: { addListener() {} },
      reload: async id => calls.push(['reload', id]), update: async (id, change) => calls.push(['update', id, change]),
      create: async spec => { calls.push(['create', spec]); return { id: 9 }; }, remove: async id => calls.push(['remove', id]),
      getZoom: async () => zoom, setZoom: async (id, value) => calls.push(['zoom', id, value]), query: async options => { queries.push(options); return tabs; } },
    action: { setBadgeText: async () => {}, setTitle: async () => {} },
    // The navigator is not yet running in a tab it is asked to start in; asked to stop, it stops.
    scripting: { executeScript: async spec => { if (spec.target.tabId === failTab || spec.target.tabId === failStartTab && spec.args?.[0] === 'start') throw new Error('Protected page'); scripts.push([spec.target.tabId, spec.files?.[0] ?? (spec.args?.[0] ?? 'stop')]); return [{ result: spec.args?.[0] }]; } },
  };
  vm.runInNewContext(source, { chrome, console, setTimeout, URL, createTrialStore });
  const send = (action, sender = { tab: tabs[0], frameId: 0 }, userInput = true) => new Promise(resolve => { if (!listener({ type: 'gaze:browser', action, userInput }, sender, resolve)) resolve(null); });
  const loaded = (tabId, url = 'https://example.com/') => onUpdated(tabId, { status: 'complete' }, { id: tabId, url });
  return { send, calls, scripts, queries, sessionWrites, loaded, sendTrial: (request, sender) => new Promise(resolve => { if (!listener({ type: 'gaze:trial', request }, sender, resolve)) resolve(null); }), trialRequest: (op, sender) => listener({ type: 'gaze:trial', request: { op } }, sender, () => {}) };
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


test('only the popup starts, ends or clears a trial; embedded extension frames cannot ask', () => {
  const { trialRequest } = background();
  for (const op of ['start', 'end', 'clear', 'logging']) {
    assert.equal(trialRequest(op, { tab: { id: 7 }, frameId: 0, url: 'http://shop.example/' }), false);
    assert.equal(trialRequest(op, { tab: { id: 7 }, frameId: 4, url: 'chrome-extension://test/capture.html' }), false);
  }
  assert.equal(trialRequest('finish', { tab: { id: 7 }, frameId: 3, url: 'http://shop.example/' }), false);
});


test('the worker routes popup and top-frame trial requests through one durable queue', async () => {
  const data = {}, storage = {
    get: async key => key == null ? structuredClone(data) : { [key]: structuredClone(data[key]) },
    set: async values => { Object.assign(data, structuredClone(values)); },
    remove: async keys => { for (const key of keys) delete data[key]; },
  };
  const { sendTrial } = background({ storage });
  const popup = { url: 'chrome-extension://test/popup.html' }, page = { url: 'https://shop.example/', tab: { id: 7 }, frameId: 0 };
  const start = await sendTrial({ op: 'start', expected: null, tasks: ['One', 'Two'] }, popup);
  assert.equal(start.ok, true);
  const [first, duplicate] = await Promise.all([
    sendTrial({ op: 'finish', expected: start.trial, outcome: 'done' }, page),
    sendTrial({ op: 'finish', expected: start.trial, outcome: 'done' }, page),
  ]);
  assert.equal(first.ok, true); assert.equal(duplicate.ok, false);
  const end = await sendTrial({ op: 'end', expected: first.trial }, popup);
  assert.equal(end.ok, true); assert.ok(end.trial.endedAt);
  await sendTrial({ op: 'clear', expected: end.trial }, popup);
  assert.equal('gaze-navigator-trial' in data, false);
  assert.equal((await sendTrial({ op: 'finish', expected: first.trial, outcome: 'done' }, page)).ok, false);
});


test('direct browser-tab speech has an explicit scope separate from a website tab', async () => {
  const read = said => interpret(said, page);
  assert.deepEqual(read('switch to browser tab BBC News'), { type: 'tab', move: 'select', name: 'bbc news' });
  assert.deepEqual(read('open the browser tab called Three'), { type: 'tab', move: 'select', name: 'three' });
  assert.deepEqual(read('switch to browser tab number three'), { type: 'tab', move: 'select', position: 3 });
  assert.deepEqual(read('go to browser tab 2'), { type: 'tab', move: 'select', position: 2 });
  for (const said of ['switch to browser tab 0', 'switch to browser tab -1', 'switch to browser tab 1.5', 'switch to browser tab']) assert.equal(read(said).type, 'unknown', said);
  for (const said of ['switch to browser tab, three', 'switch to browser tab: BBC News', 'switch to browser tab; BBC News']) assert.equal(read(said).type, 'unknown', said);
  assert.deepEqual(read('switch to browser tab\tthree'), { type: 'tab', move: 'select', position: 3 });
  assert.deepEqual(read('switch  to  the browser\ttab three'), { type: 'tab', move: 'select', position: 3 });
  assert.deepEqual(read('switch to browser tab called Help!'), { type: 'tab', move: 'select', name: 'help!' });
  assert.deepEqual(read('switch to browser tab named Hello Please'), { type: 'tab', move: 'select', name: 'hello please' });
  const collision = { elements: [{ id: 99, role: 'button', name: 'Switch to browser tab BBC News', distance: 0 }] };
  assert.deepEqual(interpret('switch to browser tab BBC News', collision), { type: 'tab', move: 'select', name: 'bbc news' });
  const website = { elements: [{ id: 12, role: 'tab', name: 'Billing', distance: 0 }] };
  assert.equal(interpret('switch to the Billing tab', website).targetId, 12);
  const asked = [], controller = createController({ window: {}, interpret, commands: { browser: async action => { asked.push(action); return { ok: true, message: 'Switched.' }; } } });
  await controller.handle('switch to browser tab three', page).followUp;
  assert.deepEqual(asked, [{ type: 'tab', move: 'select', position: 3 }]);
});

const openTabs = [
  { id: 7, index: 0, windowId: 1, title: 'Example Shop', url: 'https://shop.example/' },
  { id: 8, index: 1, windowId: 1, title: 'BBC News', url: 'https://www.bbc.co.uk/news' },
  { id: 9, index: 2, windowId: 1, title: 'BBC News - Sport', url: 'https://www.bbc.co.uk/sport' },
  { id: 10, index: 3, windowId: 1, title: 'Mail', url: 'https://mail.example/' },
];

test('a direct tab uses a unique exact title/site before partial matches and current-window position', async () => {
  const h = background({ openTabs });
  for (const [action, id] of [[{ name: 'bbc news' }, 8], [{ name: 'Mail' }, 10], [{ name: 'mail dot example' }, 10], [{ position: 3 }, 9]]) {
    const result = await h.send({ type: 'tab', move: 'select', ...action });
    assert.equal(result.ok, true, JSON.stringify(action));
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), ['update', id, { active: true }]);
  }
  const before = h.calls.length;
  assert.match((await h.send({ type: 'tab', move: 'select', name: 'Example Shop' })).message, /already/);
  assert.equal(h.calls.length, before, 'current tab is a no-op without a handoff');
});

test('ambiguous/missing/invalid tab requests refuse without activating anything or leaking URL paths', async () => {
  const h = background({ openTabs: [...openTabs, { id: 11, index: 4, windowId: 1, title: 'Mail', url: 'https://other.example/private?token=SECRET' }] });
  for (const name of ['BBC', 'bbc.co.uk', 'Mail']) {
    const result = await h.send({ type: 'tab', move: 'select', name });
    assert.equal(result.ok, false); assert.match(result.message, /say.*switch to browser tab number/i);
    assert.doesNotMatch(result.message, /SECRET|private|token/);
  }
  for (const action of [{ name: 'absent' }, { position: 0 }, { position: 1.2 }, { position: 100 }, { name: 'Mail', position: 2 }, { name: '' }]) {
    assert.equal((await h.send({ type: 'tab', move: 'select', ...action })).ok, false);
  }
  assert.deepEqual(h.calls, []); assert.deepEqual(h.scripts, []);
});

test('names respect existing host access, while positions need no new permission and keep handoff boundaries', async () => {
  const limited = background({ access: false, openTabs });
  assert.match((await limited.send({ type: 'tab', move: 'select', name: 'Mail' })).message, /all websites.*number/i);
  assert.deepEqual(limited.calls, []);
  assert.equal((await limited.send({ type: 'tab', move: 'select', position: 4 })).ok, true);
  await settle(); assert.deepEqual(limited.scripts, []);
  const h = background({ openTabs });
  await h.send({ type: 'tab', move: 'select', name: 'Mail' }); await settle();
  assert.deepEqual(h.scripts, [[10, 'probe'], [10, 'start'], [10, 'content.js'], [7, 'stop'], [7, 'stop']]);
  assert.equal(await h.send({ type: 'tab', move: 'select', name: 'Mail' }, { tab: openTabs[0], frameId: 2 }), null);
});

test('direct selection stays in this window and reports unavailable continuation without claiming a page action', async () => {
  const h = background({ openTabs: [...openTabs, { id: 12, index: 0, windowId: 2, title: 'Mail', url: 'https://mail.example/' }] });
  assert.equal((await h.send({ type: 'tab', move: 'select', name: 'Mail' })).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), ['update', 10, { active: true }]);
  const protectedTab = background({ openTabs, failTab: 10 });
  const result = await protectedTab.send({ type: 'tab', move: 'select', position: 4 });
  assert.equal(result.ok, true, 'switching the browser tab succeeded');
  assert.match(result.message, /cannot continue/);
  assert.ok(result.confirmation.token); assert.deepEqual(protectedTab.calls, []);
  const unreadable = background({ openTabs: [{ ...openTabs[0], title: undefined }, { id: 8, index: 1, windowId: 1 }] });
  assert.equal((await unreadable.send({ type: 'tab', move: 'select', name: 'missing' })).ok, false);
  assert.deepEqual(unreadable.calls, []);
});

test('ambiguous tab feedback exposes only positions, never other pages titles or URL-shaped titles', async () => {
  const h = background({ openTabs: [...openTabs,
    { id: 12, index: 4, windowId: 1, title: 'CONFIDENTIAL_DRAFT', url: 'https://private.example/report?token=SECRET' },
    { id: 13, index: 5, windowId: 1, title: 'https://private.example/PRIVATE_PATH?token=SECRET', url: 'https://private.example/other' },
  ] });
  const result = await h.send({ type: 'tab', move: 'select', name: 'private.example' });
  assert.equal(result.ok, false); assert.match(result.message, /5.*6/);
  assert.doesNotMatch(result.message, /CONFIDENTIAL|PRIVATE_PATH|SECRET|private\.example/);
  assert.deepEqual(h.calls, []);
});


test('page-generated tab lookups are refused before querying browsing metadata', async () => {
  const h = background({ openTabs });
  const result = await h.send({ type: 'tab', move: 'select', name: 'Mail' }, { tab: openTabs[0], frameId: 0 }, false);
  assert.equal(result.ok, false); assert.match(result.message, /user input|spoken.*typed/i);
  assert.deepEqual(h.queries, []); assert.deepEqual(h.calls, []); assert.deepEqual(h.scripts, []);
});

test('leaving without continuation is explained and confirmed before activation, once and bound to the target', async () => {
  const h = background({ access: false, openTabs });
  const prepared = await h.send({ type: 'tab', move: 'select', position: 4 });
  assert.ok(prepared.confirmation?.token); assert.match(prepared.message, /cannot continue|will stop/i);
  assert.deepEqual(h.calls, [], 'guidance is visible before departure');
  const action = { type: 'tab', move: 'select', position: 4, selectionToken: prepared.confirmation.token };
  assert.equal((await h.send(action)).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), ['update', 10, { active: true }]);
  assert.equal((await h.send(action)).ok, false, 'a confirmation cannot be replayed');
  const mutable = structuredClone(openTabs), changed = background({ access: false, openTabs: mutable });
  const offered = await changed.send({ type: 'tab', move: 'select', position: 4 });
  mutable[3].index = 4;
  assert.equal((await changed.send({ type: 'tab', move: 'select', position: 4, selectionToken: offered.confirmation.token })).ok, false);
  assert.deepEqual(changed.calls, []);
});

test('a delayed browser question cannot survive a newer instruction and a live one uses ordinary confirmation', async () => {
  let finish; const asked = [];
  const controller = createController({ window: {}, interpret, commands: { browser: action => {
    asked.push(action);
    if (action.selectionToken) return Promise.resolve({ ok: true, message: 'Switched.' });
    return new Promise(resolve => { finish = resolve; });
  } } });
  const old = controller.handle('switch to browser tab three', page);
  controller.handle('cancel', page);
  finish({ ok: true, confirmation: { token: 'old' }, message: 'Navigator will stop. Confirm?' });
  assert.equal(await old.followUp, null);
  const fresh = controller.handle('switch to browser tab three', page);
  finish({ ok: true, confirmation: { token: 'fresh' }, message: 'Navigator will stop. Confirm?' });
  assert.equal((await fresh.followUp).tone, 'question');
  assert.equal(controller.pending.kind, 'confirm');
  await controller.handle('confirm', page).followUp;
  assert.equal(asked.at(-1).selectionToken, 'fresh');
});

test('literal titles with command-like endings select their own competing tab', async () => {
  const tabs = [openTabs[0], ...['Help', 'Help!', 'Hello', 'Hello Please'].map((title, i) => ({ id: i + 8, index: i + 1, windowId: 1, title, url: `https://example.com/${i}` }))];
  const h = background({ openTabs: tabs });
  for (const [title, id] of [['Help!', 9], ['Hello Please', 11]]) {
    assert.equal((await h.send(interpret(`switch to browser tab called ${title}`, page))).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1))), ['update', id, { active: true }]);
  }
});


test('a navigation race after the access probe leaves recovery in extension-owned popup state', async () => {
  const h = background({ openTabs, failStartTab: 10 });
  const result = await h.send({ type: 'tab', move: 'select', name: 'Mail' });
  assert.equal(result.ok, true); assert.match(result.message, /toolbar popup/);
  const notice = h.sessionWrites.findLast(value => value.browserTabNotice)?.browserTabNotice;
  assert.equal(notice.tabId, 10); assert.match(notice.message, /could not continue/);
  assert.doesNotMatch(notice.message, /Mail|mail\.example/);
});
