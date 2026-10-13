// Starts the navigator inside the extension's isolated world on any website.
import { startWebNavigator } from './overlay.js';

const KEY = 'gaze-web-navigator';
const stored = (await chrome.storage.session.get(KEY))[KEY] ?? {};

const CALIBRATION = 'gaze-calibration';

// Extension session storage is in memory only and unreachable from websites.
const store = {
  load: () => stored,
  save: settings => { chrome.storage.session.set({ [KEY]: settings }).catch(() => {}); },
  loadCalibration: async () => (await chrome.storage.session.get(CALIBRATION))[CALIBRATION] ?? null,
  saveCalibration: calibration => { chrome.storage.session.set({ [CALIBRATION]: calibration }).catch(() => {}); },
  clearCalibration: () => { chrome.storage.session.remove(CALIBRATION).catch(() => {}); },
};

// Asks the background worker to inject the bundled estimator; a fresh load replaces the old instance.
async function loadCamera({ fresh = false } = {}) {
  if (fresh || !globalThis.webgazer) {
    const result = await chrome.runtime.sendMessage({ type: 'gaze:load-camera' });
    if (!result?.ok) throw new Error(result?.message ?? 'Camera library could not load.');
  }
  if (!globalThis.webgazer) throw new Error('Camera library did not load correctly.');
  return globalThis.webgazer;
}

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

const navigator = startWebNavigator({ window, store, loadCamera, loadAssistant });
globalThis.__gazeNavigatorStop = () => {
  navigator.stop();
  globalThis.__gazeNavigatorRunning = false;
  globalThis.__gazeNavigatorStop = undefined;
};
