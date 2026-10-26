// Starts the navigator inside the extension's isolated world on any website.
import { startWebNavigator } from './overlay.js';
import { createFrameCamera } from './frame-camera.js';
import { createFrameSpeech } from './frame-speech.js';

const KEY = 'gaze-web-navigator';

const CALIBRATION = 'gaze-calibration';

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
  const stored = (await chrome.storage.session.get(KEY))[KEY] ?? {};
  if (!isCurrent()) return null;
  // Extension session storage is in memory only and unreachable from websites.
  const store = {
    load: () => stored,
    save: settings => { chrome.storage.session.set({ [KEY]: settings }).catch(() => {}); },
    loadCalibration: async () => (await chrome.storage.session.get(CALIBRATION))[CALIBRATION] ?? null,
    saveCalibration: calibration => { chrome.storage.session.set({ [CALIBRATION]: calibration }).catch(() => {}); },
    clearCalibration: () => { chrome.storage.session.remove(CALIBRATION).catch(() => {}); },
  };
  // The camera runs in an extension frame, so camera access belongs to Gaze Navigator, not the website.
  const createCamera = options => createFrameCamera({ ...options, runtime: chrome.runtime });
  const createSpeech = (window, callbacks) => createFrameSpeech({ document, window, mount: document.getElementById('gaze-web-navigator').shadowRoot, runtime: chrome.runtime, ...callbacks });
  return startWebNavigator({ window, store, createCamera, createSpeech, loadAssistant });
}
