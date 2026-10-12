// Toolbar popup: turn the navigator on/off for the current tab and choose browsing behavior.
const PREFERENCES = 'preferences';
const ALL_SITES = { origins: ['<all_urls>'] };
const $ = id => document.getElementById(id);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const preferences = { persist: false, autoStart: false, ...(await chrome.storage.local.get(PREFERENCES))[PREFERENCES] };

async function refresh() {
  const { on } = await chrome.runtime.sendMessage({ type: 'gaze:status', tabId: tab.id });
  $('state').textContent = on ? 'On for this tab.' : 'Off for this tab.';
  $('toggle').textContent = on ? 'Turn off for this page' : 'Turn on for this page';
  $('toggle').disabled = false;
  const granted = await chrome.permissions.contains(ALL_SITES);
  $('access').textContent = granted
    ? 'Website access granted: the navigator can restart after pages change.'
    : 'Staying on after a page change, or starting everywhere, needs permission to run on websites. You will be asked when you choose either option.';
}

$('persist').checked = preferences.persist;
$('autoStart').checked = preferences.autoStart;

// Permission requests must come directly from this click.
for (const id of ['persist', 'autoStart']) {
  $(id).addEventListener('change', async event => {
    if (event.target.checked && !(await chrome.permissions.request(ALL_SITES))) {
      event.target.checked = false;
      $('state').textContent = 'Website access was not granted. The navigator will stay on only for the current page.';
    }
    preferences[id] = event.target.checked;
    await chrome.storage.local.set({ [PREFERENCES]: preferences });
    await refresh();
  });
}

$('toggle').addEventListener('click', async () => {
  $('toggle').disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'gaze:toggle', tabId: tab.id });
  if (result !== 'on' && result !== 'off') $('state').textContent = result;
  else await refresh();
  $('toggle').disabled = false;
});

refresh();
