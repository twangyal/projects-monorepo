import { createTrialStore } from './src/web/trial-store.js';

// Decides where the navigator runs. Only the tab the user turned it on for, unless they grant
// host access for "stay on while browsing" or "start on every website".
const ENABLED = 'enabledTabs';
const PREFERENCES = 'preferences';
const DEFAULTS = { persist: false, autoStart: false };

// Lets the content script keep navigator settings in extension storage instead of the website's.
const allowContentStorage = () => chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
chrome.runtime.onInstalled.addListener(allowContentStorage);
chrome.runtime.onStartup.addListener(allowContentStorage);
allowContentStorage();

async function enabledTabs() {
  return (await chrome.storage.session.get(ENABLED))[ENABLED] ?? {};
}

async function setEnabled(tabId, on) {
  const tabs = await enabledTabs();
  if (on) tabs[tabId] = true;
  else delete tabs[tabId];
  await chrome.storage.session.set({ [ENABLED]: tabs });
}

async function preferences() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(PREFERENCES))[PREFERENCES] };
}

async function hostAccess() {
  return chrome.permissions.contains({ origins: ['<all_urls>'] });
}

// Serialize short injection operations per tab, without waiting for module/camera startup.
const operations = new Map();
const intents = new Map();
function enqueue(tabId, intent, operation, explicit = false) {
  const result = (operations.get(tabId) ?? Promise.resolve()).catch(() => {}).then(() => explicit || intents.get(tabId) === intent ? operation() : 'off');
  operations.set(tabId, result);
  const release = () => { if (operations.get(tabId) === result) operations.delete(tabId); };
  result.then(release, release);
  return result;
}
function run(tabId, mode, intent = null) {
  const explicit = !intent;
  if (explicit) { intent = {}; intents.set(tabId, intent); }
  // Explicit toggles retain ordering/parity; only automatic continuation can be retired.
  return enqueue(tabId, intent, () => runNow(tabId, mode, () => explicit || intents.get(tabId) === intent), explicit);
}

// Runs the content toggle in the top frame. Resolves to 'on', 'off' or an error message.
async function runNow(tabId, mode, current) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: wanted => {
        const running = Boolean(globalThis.__gazeNavigatorRunning);
        return wanted === 'toggle' ? (running ? 'stop' : 'start') : wanted === 'start' && running ? 'running' : wanted;
      },
      args: [mode],
    });
    if (!current()) return 'off';
    const action = result?.result;
    if (action === 'running') return 'on';
    if (action === 'start') {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      if (!current()) return 'off';
      await setEnabled(tabId, true);
      await chrome.action.setBadgeText({ tabId, text: 'ON' });
      return 'on';
    }
    await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.__gazeNavigatorStop?.() });
    await setEnabled(tabId, false);
    await chrome.action.setBadgeText({ tabId, text: '' });
    return 'off';
  } catch (error) {
    return `Gaze Navigator cannot run on this page (${error.message}). Browser pages and the web store are protected.`;
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-navigator' && tab?.id !== undefined) run(tab.id, 'toggle');
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !/^(https?|file):/.test(tab.url ?? '')) return;
  const intent = intents.get(tabId) ?? {};
  intents.set(tabId, intent);
  // Read continuation state after earlier explicit operations have committed it.
  await operations.get(tabId)?.catch(() => {});
  if (intents.get(tabId) !== intent) return;
  // A page the navigator itself was asked to load (reload, a website, a new tab) keeps the navigator on.
  const carriedAt = carried.get(tabId);
  carried.delete(tabId);
  if (carriedAt > Date.now() - CARRY_MS && (await hostAccess())) {
    if (intents.get(tabId) !== intent) return;
    await setEnabled(tabId, true);
    await run(tabId, 'start', intent);
    return;
  }
  const [tabs, prefs] = await Promise.all([enabledTabs(), preferences()]);
  if (intents.get(tabId) !== intent) return;
  if (!(prefs.autoStart || (prefs.persist && tabs[tabId]))) {
    await enqueue(tabId, intent, async () => {
      await setEnabled(tabId, false);
      await chrome.action.setBadgeText({ tabId, text: '' });
    });
    return;
  }
  if (!(await hostAccess())) {
    // Without host access the activeTab grant ended with the navigation; ask for one click.
    await enqueue(tabId, intent, async () => {
      await chrome.action.setBadgeText({ tabId, text: 'OFF' });
      await chrome.action.setTitle({ tabId, title: 'Gaze Navigator stopped after navigation. Open it to turn it back on.' });
    });
    return;
  }
  await run(tabId, 'start', intent);
});

// Browser commands spoken to the navigator in a tab's top frame: reload, a website, tabs and zoom. With access to all
// websites, the navigator carries on in the page or tab the command leads to; without it, the reply says how to
// turn it back on.
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
// Tabs loading a page the navigator asked for, and when it asked; a load that has not finished in time is forgotten.
const carried = new Map(), CARRY_MS = 60000;
const tabSelections = new Map();
let selectionSerial = 0;
let closedAt = 0;
// The navigator moves with the user to another tab: the one left behind stops once its reply has been shown, so the
// two do not compete for the camera and microphone.
const leave = tab => setTimeout(() => { run(tab.id, 'stop').catch(() => {}); }, 200);
function webAddress(value) {
  try { const url = new URL(String(value)); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
// Metadata is used locally and only with existing host access; never inspect a tab's page or full URL for a name.
const tabName = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function tabHost(tab) {
  const url = webAddress(tab.url);
  return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '') : '';
}
function selectBrowserTab(tabs, action, access) {
  const numbered = action.position !== undefined;
  if (numbered) {
    if (action.name !== undefined || !Number.isSafeInteger(action.position) || action.position < 1) return { error: 'Choose one positive whole browser tab number. Nothing was changed.' };
    const target = tabs.find(tab => tab.index === action.position - 1);
    return target ? { target } : { error: `No browser tab has that number in this window (${tabs.length} tabs). Nothing was changed.` };
  }
  if (typeof action.name !== 'string' || !action.name.trim() || action.name.length > 160) return { error: 'Say a browser tab title, site or number. Nothing was changed.' };
  if (!access) return { error: 'Selecting a tab by name needs the existing access to all websites. You can use a browser tab number instead; no permission was requested.' };
  const wanted = tabName(action.name), host = wanted.replace(/\s+dot\s+/g, '.').replace(/^www\./, '');
  const readable = tabs.filter(tab => tabHost(tab));
  const exact = readable.filter(tab => tabName(tab.title) === wanted || tabHost(tab) === host);
  const matches = exact.length ? exact : readable.filter(tab => tabName(tab.title).includes(wanted));
  if (!matches.length) return { error: 'No readable website tab matches that name in this window. Say its browser tab number or a more exact title. Nothing was changed.' };
  if (matches.length > 1) {
    // This reply is shown in a website's open shadow DOM: other tabs' titles/URLs must stay in the worker.
    const choices = matches.slice(0, 6).map(tab => tab.index + 1).join(', ');
    return { error: `Several browser tabs match, at positions ${choices}${matches.length > 6 ? ' (more matches are open)' : ''}. Say “switch to browser tab number ${matches[0].index + 1}” with your chosen position, or give a more exact name. Nothing was changed.` };
  }
  return { target: matches[0] };
}
async function browserCommand(tab, action, userInput = false) {
  if (action?.type === 'tab' && action.move === 'select' && userInput !== true) return { ok: false, message: 'Browser tab selection needs genuine user input: a spoken instruction or your typed command. Nothing was changed.' };
  if (!action?.selectionToken) tabSelections.delete(tab.id);
  const access = await hostAccess();
  const after = access ? '' : ' Gaze Navigator stops there: turn it back on from the toolbar or with Alt+Shift+N, or allow it on all websites to keep it on.';
  if (action?.type === 'reload') {
    if (access) carried.set(tab.id, Date.now());
    await chrome.tabs.reload(tab.id);
    return { ok: true, message: `Reloading the page.${after}` };
  }
  if (action?.type === 'visit' || (action?.type === 'tab' && action.move === 'new')) {
    const url = webAddress(action.url);
    if (!url) return { ok: false, message: 'That is not a website address. Nothing was changed.' };
    const host = new URL(url).host;
    if (action.type === 'visit') {
      if (access) carried.set(tab.id, Date.now());
      await chrome.tabs.update(tab.id, { url });
      return { ok: true, message: `Opening ${host}.${after}` };
    }
    const created = await chrome.tabs.create({ url, index: tab.index + 1, openerTabId: tab.id });
    if (access) { carried.set(created.id, Date.now()); leave(tab); }
    return { ok: true, message: `Opened ${host} in a new tab.${after}` };
  }
  if (action?.type === 'zoom' && ['in', 'out', 'reset'].includes(action.step)) {
    const now = await chrome.tabs.getZoom(tab.id);
    const next = action.step === 'reset' ? 1 : action.step === 'in' ? ZOOMS.find(zoom => zoom > now + 0.001) ?? ZOOMS.at(-1) : [...ZOOMS].reverse().find(zoom => zoom < now - 0.001) ?? ZOOMS[0];
    await chrome.tabs.setZoom(tab.id, next);
    return { ok: true, message: `Zoomed to ${Math.round(next * 100)}%.${next !== now ? ' Camera gaze may land beside your look until you say recalibrate.' : ''}` };
  }
  if (action?.type === 'tab' && action.move === 'close') {
    closedAt = access ? Date.now() : 0;
    // Close after replying, so the answer reaches the navigator first.
    setTimeout(() => { chrome.tabs.remove(tab.id).catch(() => {}); }, 200);
    return { ok: true, message: `Closing this tab.${access ? '' : ' Turn Gaze Navigator on in the next tab from the toolbar or with Alt+Shift+N.'}` };
  }
  if (action?.type === 'tab' && action.move === 'select') {
    const tabs = (await chrome.tabs.query({ windowId: tab.windowId })).filter(other => other.windowId === tab.windowId);
    if (action.selectionToken) {
      const offered = tabSelections.get(tab.id); tabSelections.delete(tab.id);
      const target = offered && tabs.find(other => other.id === offered.target.id);
      if (!offered || offered.token !== action.selectionToken || Date.now() > offered.expiresAt || !target ||
          target.index !== offered.target.index || target.url !== offered.target.url || target.title !== offered.target.title) {
        return { ok: false, message: 'That browser tab choice expired or changed. Give the instruction again. Nothing was changed.' };
      }
      await chrome.tabs.update(target.id, { active: true });
      leave(tab);
      return { ok: true, message: `Switched to browser tab ${target.index + 1}. The navigator was stopped as confirmed; use the toolbar on a supported website to continue.` };
    }
    const { target, error } = selectBrowserTab(tabs, action, access);
    if (error) return { ok: false, message: error };
    if (target.id === tab.id) return { ok: true, message: `Browser tab ${target.index + 1} is already active. Nothing was changed.` };
    let available = access;
    if (access) {
      // Check injection before leaving, so unavailable continuation can be explained on the still-visible source.
      try { await chrome.scripting.executeScript({ target: { tabId: target.id }, func: () => true, args: ['probe'] }); }
      catch { available = false; }
    }
    if (!available) {
      const token = String(++selectionSerial);
      tabSelections.set(tab.id, { token, target: { ...target }, expiresAt: Date.now() + 15000 });
      return { ok: true, confirmation: { token }, message: `Browser tab ${target.index + 1} can be selected, but the navigator cannot continue there ${access ? 'because the browser refuses access' : 'without website access'}. It will stop here. Use the toolbar on a supported website to continue; protected browser pages cannot be controlled. Say confirm to switch anyway, or cancel to stay.` };
    }
    await chrome.tabs.update(target.id, { active: true });
    leave(tab);
    const started = await run(target.id, 'start');
    // Navigation can race the probe. A failure is also available in extension-owned UI after departure.
    await chrome.storage.session.set({ browserTabNotice: { tabId: target.id, at: Date.now(), message: started === 'on' ? '' : 'Tab switched, but the navigator could not continue. Open a supported website and use Turn on or Retry in this popup.' } });
    return { ok: true, message: `Switched to browser tab ${target.index + 1} of ${tabs.length}.${started === 'on' ? '' : ' Open the navigator toolbar popup for recovery.'}` };
  }
  if (action?.type === 'tab' && ['next', 'previous'].includes(action.move)) {
    const tabs = await chrome.tabs.query({ windowId: tab.windowId });
    if (tabs.length < 2) return { ok: false, message: 'This is the only tab in the window. Nothing was changed.' };
    const at = tabs.findIndex(other => other.id === tab.id), target = tabs[(at + (action.move === 'next' ? 1 : -1) + tabs.length) % tabs.length];
    await chrome.tabs.update(target.id, { active: true });
    if (access) { leave(tab); await setEnabled(target.id, true); run(target.id, 'start').catch(() => {}); }
    return { ok: true, message: `Switched to tab ${target.index + 1} of ${tabs.length}.${access ? '' : ' Turn Gaze Navigator on there from the toolbar or with Alt+Shift+N.'}` };
  }
  return { ok: false, message: 'That browser command is not supported. Nothing was changed.' };
}
// The tab the browser shows after the navigator closed one carries the navigator on.
chrome.tabs.onActivated?.addListener(({ tabId }) => {
  if (!closedAt || Date.now() - closedAt > 3000) return;
  closedAt = 0;
  setEnabled(tabId, true).then(() => run(tabId, 'start')).catch(() => {});
});

chrome.tabs.onRemoved.addListener(tabId => {
  carried.delete(tabId);
  tabSelections.delete(tabId);
  const intent = {}; intents.set(tabId, intent);
  enqueue(tabId, intent, async () => {
    await setEnabled(tabId, false);
    if (intents.get(tabId) === intent) intents.delete(tabId);
  }).catch(() => {});
});

// Stored continuation intent is not evidence that the current document is running.
async function pageStatus(tabId) {
  try {
    const [probe] = await chrome.scripting.executeScript({ target: { tabId }, func: () => ({
      on: Boolean(globalThis.__gazeNavigatorRunning),
      phase: globalThis.__gazeNavigatorError ? 'failed' : !globalThis.__gazeNavigatorRunning ? 'off' : globalThis.__gazeNavigatorReady ? 'on' : 'starting',
      message: globalThis.__gazeNavigatorError ?? '',
    }) });
    return probe?.result ?? { on: false, phase: 'off', message: '' };
  } catch {
    return { on: false, phase: 'unavailable', message: 'This page does not allow navigator access. Open a normal website, then reopen Gaze Navigator. Browser pages and the web store are protected.' };
  }
}

// One setup tab per device, next to the tab that requested it.
async function openPermissionsPage(tab, microphone = false) {
  const url = chrome.runtime.getURL(`permissions.html${microphone ? '?device=microphone' : ''}`);
  const [open] = await chrome.tabs.query({ url });
  if (open) {
    await chrome.tabs.update(open.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url, index: tab.index + 1, openerTabId: tab.id });
}

// Smarter matching: the model runs in one offscreen document shared by all tabs.
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['WORKERS'], justification: 'Runs the on-device WaterSheep model for smarter target matching.' })
    .catch(error => { if (!/single offscreen/i.test(error.message)) throw error; });
}

// Embedded frames: the navigator in a tab's top frame reaches iframes from other sites through frame agents. A frame
// says hello with the nonce its parent posted to it; the first hello wins. Only the top frame's navigator may ask.
const frameHellos = new Map();
const FRAME_HELLO_MS = 60000;
function onFrameMessage(message, sender, respond) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;
  if (message.type === 'gaze:frame-hello') {
    if (sender.frameId === 0 || !/^[0-9a-f]{32}$/.test(message.nonce ?? '')) return false;
    const key = `${tabId}:${message.nonce}`;
    if (!frameHellos.has(key)) {
      frameHellos.set(key, sender.frameId);
      setTimeout(() => frameHellos.delete(key), FRAME_HELLO_MS);
    }
    return false;
  }
  if (message.type === 'gaze:frame-pointer') {
    if (sender.frameId === 0 || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return false;
    chrome.tabs.sendMessage(tabId, { type: 'gaze:frame-pointer', frameId: sender.frameId, x: message.x, y: message.y }, { frameId: 0 }).catch(() => {});
    return false;
  }
  if (sender.frameId !== 0) return false;
  if (message.type === 'gaze:frame-inject') {
    chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['frame-agent.js'] })
      .then(() => respond({ ok: true }), () => respond({ ok: false }));
    return true;
  }
  if (message.type === 'gaze:frame-resolve') {
    respond({ frameId: frameHellos.get(`${tabId}:${message.nonce}`) ?? null });
    return false;
  }
  if (['gaze:frame-capture', 'gaze:frame-act'].includes(message.type) && Number.isInteger(message.frameId) && message.frameId > 0) {
    const { frameId, ...request } = message;
    chrome.tabs.sendMessage(tabId, request, { frameId }).then(reply => respond(reply ?? { ok: false }), () => respond({ ok: false, message: 'The embedded page is not reachable.' }));
    return true;
  }
  return false;
}

// Created once on the first trial request; its queue survives for this worker's lifetime. A restarted worker reads
// storage afresh, so no cached trial can revive an old task.
let trials;
function changeTrial(request) {
  trials ??= createTrialStore({ storage: chrome.storage.local });
  return trials(request);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
  if (message?.type === 'gaze:trial') {
    // Pages may only finish their current task. Starting, ending and clearing belong to the extension's own pages.
    const fromPopup = sender.url === chrome.runtime.getURL('popup.html');
    if (!fromPopup && !(sender.tab?.id !== undefined && sender.frameId === 0 && message.request?.op === 'finish')) return false;
    changeTrial(message.request).then(respond, () => respond({ ok: false, message: 'Could not save the trial. Ask what your task is, then try again.' }));
    return true;
  }
  if (typeof message?.type === 'string' && message.type.startsWith('gaze:frame-')) return onFrameMessage(message, sender, respond);
  if (message?.type === 'gaze:assist' && sender.tab?.id !== undefined && ['load', 'decide', 'yes'].includes(message.op)) {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ target: 'gaze-offscreen', op: message.op, args: message.args ?? [], tabId: sender.tab.id }))
      .then(respond, error => respond({ ok: false, message: error.message }));
    return true;
  }
  if (message?.type === 'gaze:browser' && sender.tab?.id !== undefined && sender.frameId === 0) {
    browserCommand(sender.tab, message.action, message.userInput === true).then(respond, error => respond({ ok: false, message: `The browser refused: ${error.message}. Nothing else was changed.` }));
    return true;
  }
  if (message?.type === 'gaze:assist-progress' && !sender.tab) {
    chrome.tabs.sendMessage(message.tabId, message).catch(() => {});
    return false;
  }
  if (['gaze:camera-permission', 'gaze:microphone-permission'].includes(message?.type) && sender.tab?.id !== undefined) {
    // The camera frame cannot ask on its own behalf from inside a website; a Gaze Navigator tab can.
    openPermissionsPage(sender.tab, message.type === 'gaze:microphone-permission').then(() => respond({ ok: true }), error => respond({ ok: false, message: error.message }));
    return true;
  }
  // Turning the navigator on or off and reading status belong to Gaze Navigator's own pages (the popup),
  // not to content scripts running inside websites.
  if (!fromExtensionPage && ['gaze:toggle', 'gaze:start', 'gaze:stop', 'gaze:status', 'gaze:page-status'].includes(message?.type)) return false;
  if (message?.type === 'gaze:toggle' || message?.type === 'gaze:start' || message?.type === 'gaze:stop') {
    run(message.tabId, message.type.slice(5)).then(respond);
    return true;
  }
  if (message?.type === 'gaze:status') {
    pageStatus(message.tabId).then(status => respond({ on: status.on }));
    return true;
  }
  if (message?.type === 'gaze:page-status') {
    Promise.all([pageStatus(message.tabId), chrome.storage.session.get('browserTabNotice')]).then(([status, saved]) => {
      const notice = saved.browserTabNotice;
      respond({ ...status, ...(notice?.tabId === message.tabId && Date.now() - notice.at < 120000 && notice.message ? { browserNotice: notice.message } : {}) });
    }, () => respond({ on: false, phase: 'unavailable', message: 'Could not check this page. Try again.' }));
    return true;
  }
  return false;
});
