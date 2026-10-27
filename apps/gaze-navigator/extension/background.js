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

chrome.tabs.onRemoved.addListener(tabId => {
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

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'gaze:assist' && sender.tab?.id !== undefined && ['load', 'decide', 'yes'].includes(message.op)) {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ target: 'gaze-offscreen', op: message.op, args: message.args ?? [], tabId: sender.tab.id }))
      .then(respond, error => respond({ ok: false, message: error.message }));
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
  const fromExtensionPage = typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
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
    pageStatus(message.tabId).then(respond);
    return true;
  }
  return false;
});
