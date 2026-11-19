// Starts the navigator inside the extension's isolated world on any website.
import { startWebNavigator } from './overlay.js';
import { createFrameCamera } from './frame-camera.js';
import { createFrameSpeech } from './frame-speech.js';
import { createEmbeddedFrames } from './embedded-frames.js';
import { LOG_SETTINGS, logKey, storedLog } from './session-log.js';
import { TRIAL_KEY } from './trial-tasks.js';

const KEY = 'gaze-web-navigator';

const CALIBRATION = 'gaze-calibration';
const DETAILS = 'gaze-my-details';
const LEARNED = 'gaze-navigator-learned';

// Whether to keep a session log is chosen in the toolbar popup, which websites cannot reach; pages follow its changes.
let logging = {};
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && LOG_SETTINGS in changes) logging = changes[LOG_SETTINGS].newValue ?? {}; });

// Smarter matching asks the extension's shared on-device model; only roles and names leave the page.
async function loadAssistant(progress) {
  const onProgress = message => { if (message?.type === 'gaze:assist-progress') progress(message.received, message.total); };
  chrome.runtime.onMessage.addListener(onProgress);
  const call = async (op, args = []) => {
    const reply = await chrome.runtime.sendMessage({ type: 'gaze:assist', op, args });
    if (!reply?.ok) throw new Error(reply?.message ?? 'The matching model is unavailable.');
    return reply.result;
  };
  try { await call('load'); } finally { chrome.runtime.onMessage.removeListener(onProgress); }
  return { decide: (...args) => call('decide', args), yes: (...args) => call('yes', args) };
}

// Explicit factory: the imported module is cached, but each owned start needs a fresh runtime.
export async function startExtensionNavigator({ isCurrent = () => true } = {}) {
  const [stored, logSettings] = await Promise.all([
    chrome.storage.session.get(KEY).then(items => items[KEY] ?? {}),
    chrome.storage.local.get(LOG_SETTINGS).then(items => items[LOG_SETTINGS] ?? {}, () => ({})),
  ]);
  logging = logSettings;
  if (!isCurrent()) return null;
  // While logging is on, each page start keeps the log within its limit, so it never crowds out saved details.
  if (logging.on === true) {
    chrome.storage.local.get(null).then(items => { const { dropped } = storedLog(items); return dropped.length ? chrome.storage.local.remove(dropped) : null; }).catch(() => {});
  }
  // Extension session storage is in memory only and unreachable from websites.
  const store = {
    load: () => stored,
    save: settings => { chrome.storage.session.set({ [KEY]: settings }).catch(() => {}); },
    loadCalibration: async () => (await chrome.storage.session.get(CALIBRATION))[CALIBRATION] ?? null,
    saveCalibration: calibration => { chrome.storage.session.set({ [CALIBRATION]: calibration }).catch(() => {}); },
    clearCalibration: () => { chrome.storage.session.remove(CALIBRATION).catch(() => {}); },
    // Saved details stay on this device, in the extension's own storage, which websites cannot read.
    loadDetails: async () => (await chrome.storage.local.get(DETAILS))[DETAILS] ?? null,
    saveDetails: details => { (Object.keys(details).length ? chrome.storage.local.set({ [DETAILS]: details }) : chrome.storage.local.remove(DETAILS)).catch(() => {}); },
    // Requests learned from a yes to an offer stay on this device too, for every website, until forgotten by voice.
    loadLearned: async () => (await chrome.storage.local.get(LEARNED))[LEARNED] ?? [],
    saveLearned: list => { (list.length ? chrome.storage.local.set({ [LEARNED]: list }) : chrome.storage.local.remove(LEARNED)).catch(() => {}); },
    // A session log, when turned on, stays on this computer in the extension's own storage until it is cleared; only
    // the popup reads, downloads or clears it. Each entry is written at once under its own key, so a page that
    // navigates away straight after an instruction, or another tab logging at the same time, loses nothing.
    logging: () => ({ on: logging.on === true, words: logging.words === true }),
    addLog: entry => { chrome.storage.local.set({ [logKey(entry)]: entry }).catch(() => {}); },
    // A trial's tasks (see trial-tasks.js) are started and ended in the popup; pages show the task at hand, move it on
    // when the person says so, and follow each other's changes so every tab shows the same task.
    loadTrial: async () => (await chrome.storage.local.get(TRIAL_KEY))[TRIAL_KEY] ?? null,
    finishTrial: (expected, outcome) => chrome.runtime.sendMessage({ type: 'gaze:trial', request: { op: 'finish', expected, outcome } }),
    onTrialChange: callback => {
      const listener = (changes, area) => { if (area === 'local' && TRIAL_KEY in changes) callback(changes[TRIAL_KEY].newValue ?? null); };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
  // The camera runs in an extension frame, so camera access belongs to Gaze Navigator, not the website.
  const createCamera = options => createFrameCamera({ ...options, runtime: chrome.runtime });
  const createSpeech = (window, callbacks) => createFrameSpeech({ document, window, mount: document.getElementById('gaze-web-navigator').shadowRoot, runtime: chrome.runtime, ...callbacks });
  // Iframes from other sites are reached through the extension's frame agents.
  const embeddedFrames = createEmbeddedFrames({ window, runtime: chrome.runtime });
  // Reloading, websites, tabs and zoom are carried out by the extension's background for this tab.
  const browser = { run: async action => (await chrome.runtime.sendMessage({ type: 'gaze:browser', action })) ?? { ok: false, message: 'The browser did not respond. Nothing else was changed.' } };
  return startWebNavigator({ window, store, createCamera, createSpeech, loadAssistant, embeddedFrames, browser });
}
