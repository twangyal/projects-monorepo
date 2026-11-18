// The session log's switches, download and clearing. They live here, in the extension's own page, because websites
// cannot reach it: pages only add entries, and only while the log is on (see src/web/session-log.js).
import { LOG_SETTINGS, logFileName, logReport, logSummary, storedLog } from './src/web/session-log.js';

const $ = id => document.getElementById(id);
let choice = { on: false, words: false }, clearArmed = 0;

async function entries() {
  const { entries, dropped } = storedLog(await chrome.storage.local.get(null));
  if (dropped.length) await chrome.storage.local.remove(dropped).catch(() => {});
  return entries;
}
async function refresh(note = '') {
  const items = await chrome.storage.local.get(LOG_SETTINGS), kept = await entries();
  choice = { on: false, words: false, ...items[LOG_SETTINGS] };
  $('logOn').checked = choice.on === true; $('logWords').checked = choice.words === true; $('logWords').disabled = choice.on !== true;
  $('logDownload').disabled = !kept.length; $('logClear').disabled = !kept.length;
  $('logState').textContent = note || logSummary(kept, choice.on === true);
  $('log').disabled = false;
  return kept;
}
const failed = () => { $('logState').textContent = 'Could not read the session log. Close and reopen this popup to try again.'; };

for (const [id, key] of [['logOn', 'on'], ['logWords', 'words']]) {
  $(id).addEventListener('change', async event => {
    try {
      await chrome.storage.local.set({ [LOG_SETTINGS]: { ...choice, [key]: event.target.checked } });
      await refresh();
    } catch {
      event.target.checked = choice[key] === true;
      $('logState').textContent = 'Could not save this choice. Your previous choice is unchanged; try again.';
    }
  });
}
$('logDownload').addEventListener('click', async () => {
  try {
    const kept = await entries();
    const url = URL.createObjectURL(new Blob([JSON.stringify(logReport(kept), null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: logFileName() });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    $('logState').textContent = `Downloaded ${kept.length} ${kept.length === 1 ? 'instruction' : 'instructions'}.`;
  } catch { failed(); }
});
// Clearing deletes what was collected, so it takes a second press.
$('logClear').addEventListener('click', async () => {
  try {
    const kept = await entries();
    if (Date.now() - clearArmed > 10_000) {
      clearArmed = Date.now();
      $('logState').textContent = `Press Clear log again to delete ${kept.length} logged ${kept.length === 1 ? 'instruction' : 'instructions'}.`;
      return;
    }
    clearArmed = 0;
    await chrome.storage.local.remove(storedLog(await chrome.storage.local.get(null)).keys);
    await refresh('The log is cleared.');
  } catch { failed(); }
});
await refresh().catch(failed);
