// Toolbar state comes from the live isolated world, not remembered navigation intent.
const PREFERENCES = 'preferences';
const ALL_SITES = { origins: ['<all_urls>'] };
const $ = id => document.getElementById(id);
let tab, generation = 0, timer;
let preferences = { persist: false, autoStart: false };

function feedback(text = '') { $('feedback').textContent = text; $('feedback').hidden = !text; }
function failed() {
  generation++; clearTimeout(timer);
  $('state').textContent = 'Could not check this page. Try again; if the tab was closed, reopen the popup on a website.';
  $('toggle').disabled = true; $('retry').hidden = false;
}
async function refresh() {
  const request = ++generation; clearTimeout(timer);
  const [status, granted] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'gaze:page-status', tabId: tab.id }),
    chrome.permissions.contains(ALL_SITES),
  ]);
  if (request !== generation) return;
  if (!status || !['on', 'off', 'starting', 'failed', 'unavailable'].includes(status.phase)) throw new Error('Page state unavailable');
  $('state').textContent = status.phase === 'on' ? 'On for this page.' : status.phase === 'starting' ? 'Starting on this page… You can turn it off while it starts.' : status.phase === 'off' ? 'Off for this page.' : status.message;
  $('toggle').textContent = status.on ? 'Turn off for this page' : 'Turn on for this page';
  $('toggle').disabled = status.phase === 'unavailable';
  $('retry').hidden = !['failed', 'unavailable'].includes(status.phase);
  $('page-help').textContent = status.on
    ? 'Use Start listening in the page panel, or type an instruction. For webcam gaze, open Tracking and settings → Camera; allow access and look at each calibration dot.'
    : 'Turn on to show controls on this website. Pointer context and typed instructions work before enabling camera or speech.';
  $('access').textContent = granted
    ? 'Website access granted: your browsing choices below control automatic restarts.'
    : 'Staying on after a page change, or starting everywhere, needs website access. You will be asked only when you choose either option.';
  if (status.phase === 'starting') timer = setTimeout(() => { refresh().catch(failed); }, 250);
}
async function initialize() {
  $('browsing').disabled = true;
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!Number.isInteger(tab?.id)) throw new Error('No current page');
  preferences = { persist: false, autoStart: false, ...(await chrome.storage.local.get(PREFERENCES))[PREFERENCES] };
  for (const id of ['persist', 'autoStart']) $(id).checked = Boolean(preferences[id]);
  $('browsing').disabled = false;
  await refresh();
}

// Request directly from this user action; failures must not masquerade as saved preferences.
for (const id of ['persist', 'autoStart']) {
  $(id).addEventListener('change', async event => {
    const previous = preferences[id];
    feedback(); $('browsing').disabled = true;
    try {
      let wanted = event.target.checked;
      if (wanted && !(await chrome.permissions.request(ALL_SITES))) {
        wanted = false;
        feedback('Website access was not granted. This browsing preference stays off.');
      }
      await chrome.storage.local.set({ [PREFERENCES]: { ...preferences, [id]: wanted } });
      preferences[id] = wanted; event.target.checked = wanted;
    } catch {
      event.target.checked = previous;
      feedback('Could not save this browsing preference. Your previous choice is unchanged; try again.');
    } finally { $('browsing').disabled = false; }
    await refresh().catch(failed);
  });
}
$('toggle').addEventListener('click', async () => {
  generation++; clearTimeout(timer); feedback(); $('toggle').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'gaze:toggle', tabId: tab.id });
    if (result !== 'on' && result !== 'off') feedback(typeof result === 'string' ? result : 'The navigator could not change state. Try again.');
    await refresh();
  } catch { failed(); }
});
$('retry').addEventListener('click', async () => { feedback(); await initialize().catch(failed); });
await initialize().catch(failed);
