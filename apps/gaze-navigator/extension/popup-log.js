// The session log's switches, download and clearing, and a trial's tasks. They live here, in the extension's own page,
// because websites cannot reach it: pages only add entries, only while the log is on (see src/web/session-log.js), and
// move a trial on when the person says so (see src/web/trial-tasks.js).
import { LOG_SETTINGS, logFileName, logReport, logSummary, storedLog } from './src/web/session-log.js';
import { TRIAL_KEY, endTrial, parseTasks, startTrial, trialOpen, trialSummary, validTrial } from './src/web/trial-tasks.js';

const $ = id => document.getElementById(id);
let choice = { on: false, words: false }, clearArmed = 0, trial = null, replaceArmed = 0;
const storedTrial = async () => validTrial((await chrome.storage.local.get(TRIAL_KEY))[TRIAL_KEY]);
const counted = count => `${count} logged ${count === 1 ? 'instruction' : 'instructions'}`;

async function entries() {
  const { entries, dropped } = storedLog(await chrome.storage.local.get(null));
  if (dropped.length) await chrome.storage.local.remove(dropped).catch(() => {});
  return entries;
}
async function refresh(note = '', trialNote = '') {
  const items = await chrome.storage.local.get([LOG_SETTINGS, TRIAL_KEY]), kept = await entries();
  choice = { on: false, words: false, ...items[LOG_SETTINGS] };
  trial = validTrial(items[TRIAL_KEY]);
  $('logOn').checked = choice.on === true; $('logWords').checked = choice.words === true; $('logWords').disabled = choice.on !== true;
  // A trial's results are part of the log, so they can be downloaded or cleared without any instructions.
  $('logDownload').disabled = !kept.length && !trial; $('logClear').disabled = !kept.length && !trial;
  $('logState').textContent = note || logSummary(kept, choice.on === true);
  // While a trial is open its tasks are shown and cannot be changed; afterwards they stay, ready to run again.
  const open = trialOpen(trial);
  if (trial && (open || !$('trialTasks').value.trim())) $('trialTasks').value = trial.tasks.join('\n');
  $('trialTasks').disabled = open; $('trialStart').disabled = open; $('trialEnd').disabled = !open;
  $('trialState').textContent = trialNote || trialSummary(trial);
  $('log').disabled = false; $('trial').disabled = false;
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
    const kept = await entries(), current = await storedTrial();
    const url = URL.createObjectURL(new Blob([JSON.stringify(logReport(kept, Date.now(), current), null, 2)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: logFileName() });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    $('logState').textContent = `Downloaded ${kept.length} ${kept.length === 1 ? 'instruction' : 'instructions'}${current ? ' and how each trial task went' : ''}.`;
  } catch { failed(); }
});
// Clearing deletes what was collected, a trial's results with it, so it takes a second press.
$('logClear').addEventListener('click', async () => {
  try {
    const kept = await entries(), current = await storedTrial();
    if (Date.now() - clearArmed > 10_000) {
      clearArmed = Date.now();
      const what = [kept.length || !current ? counted(kept.length) : null, current ? "the trial's results" : null].filter(Boolean).join(' and ');
      $('logState').textContent = `Press Clear log again to delete ${what}${trialOpen(current) ? ', which ends the trial' : ''}.`;
      return;
    }
    clearArmed = 0;
    await chrome.storage.local.remove([...storedLog(await chrome.storage.local.get(null)).keys, TRIAL_KEY]);
    await refresh('The log is cleared.');
  } catch { failed(); }
});

// A trial: the tasks written above, shown one at a time in the panel on every website. Starting one turns the log on,
// so the download can say how each task went.
const trialFailed = () => { $('trialState').textContent = 'Could not save the trial. Nothing was changed; try again.'; };
$('trialStart').addEventListener('click', async () => {
  try {
    const tasks = parseTasks($('trialTasks').value);
    if (!tasks.length) { $('trialState').textContent = 'Write at least one task, one per line.'; return; }
    // Starting again replaces the last trial's results, so that takes a second press while there are any.
    const current = await storedTrial();
    if (current?.results.length && Date.now() - replaceArmed > 10_000) {
      replaceArmed = Date.now();
      $('trialState').textContent = "Press Start trial again to replace the last trial's results. Download the log first to keep them.";
      return;
    }
    replaceArmed = 0;
    const turnOn = choice.on !== true;
    await chrome.storage.local.set({ [TRIAL_KEY]: startTrial(tasks, Date.now()), ...(turnOn ? { [LOG_SETTINGS]: { ...choice, on: true } } : {}) });
    await refresh('', `Started: the panel shows task 1 of ${tasks.length}.${turnOn ? ' The session log is now on, so the download reports each task.' : ''}`);
  } catch { trialFailed(); }
});
$('trialEnd').addEventListener('click', async () => {
  try {
    const current = await storedTrial();
    if (!trialOpen(current)) { await refresh(); return; }
    const ended = endTrial(current, Date.now());
    await chrome.storage.local.set({ [TRIAL_KEY]: ended });
    await refresh('', `${trialSummary(ended)} Download the log to keep the results.`);
  } catch { trialFailed(); }
});
await refresh().catch(failed);
