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

// Runs the content toggle in the top frame. Resolves to 'on', 'off' or an error message.
async function run(tabId, mode) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: wanted => {
        const running = Boolean(globalThis.__gazeNavigatorRunning);
        return wanted === 'toggle' ? (running ? 'stop' : 'start') : wanted === 'start' && running ? 'running' : wanted;
      },
      args: [mode],
    });
    const action = result?.result;
    if (action === 'running') return 'on';
    if (action === 'start') {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
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
  const [tabs, prefs] = await Promise.all([enabledTabs(), preferences()]);
  if (!(prefs.autoStart || (prefs.persist && tabs[tabId]))) return;
  if (!(await hostAccess())) {
    // Without host access the activeTab grant ended with the navigation; ask for one click.
    await chrome.action.setBadgeText({ tabId, text: 'OFF' });
    await chrome.action.setTitle({ tabId, title: 'Gaze Navigator stopped after navigation. Open it to turn it back on.' });
    return;
  }
  await run(tabId, 'start');
});

chrome.tabs.onRemoved.addListener(tabId => setEnabled(tabId, false));

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'gaze:load-camera' && sender.tab?.id !== undefined) {
    // MV3 forbids remote code: the pinned estimator is bundled and runs in the isolated world.
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, files: ['vendor/webgazer.js'] })
      .then(() => respond({ ok: true }), error => respond({ ok: false, message: error.message }));
    return true;
  }
  if (message?.type === 'gaze:toggle' || message?.type === 'gaze:start' || message?.type === 'gaze:stop') {
    run(message.tabId, message.type.slice(5)).then(respond);
    return true;
  }
  if (message?.type === 'gaze:status') {
    enabledTabs().then(tabs => respond({ on: Boolean(tabs[message.tabId]) }));
    return true;
  }
  return false;
});
