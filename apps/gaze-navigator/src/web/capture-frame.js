// Runs inside the extension's capture frame (extension/capture.html), which the navigator embeds invisibly
// over the page. The camera, WebGazer and calibration samples live here, in the extension's own origin:
// the website is never granted camera access and cannot read this frame. Only gaze points leave, over a
// private extension port that page scripts cannot reach.
import { createLocalCamera } from './camera-source.js';
import { createCameraLoader } from '../camera-loader.js';

const CALIBRATION = 'gaze-calibration';
const nonce = location.hash.slice(1);
let port = null;

const camera = createLocalCamera({
  document, window,
  load: createCameraLoader(document, window, 15000, chrome.runtime.getURL('vendor/webgazer.js')),
  store: {
    loadCalibration: async () => (await chrome.storage.session.get(CALIBRATION))[CALIBRATION] ?? null,
    saveCalibration: calibration => { chrome.storage.session.set({ [CALIBRATION]: calibration }).catch(() => {}); },
    clearCalibration: () => { chrome.storage.session.remove(CALIBRATION).catch(() => {}); },
  },
  onGaze: (x, y) => port?.postMessage({ type: 'gaze', x, y }),
  onLost: () => port?.postMessage({ type: 'lost' }),
});

const operations = {
  start: () => camera.start(),
  stop: () => camera.stop(),
  reset: () => { camera.resetCalibration(); return true; },
  sample: (x, y) => camera.recordSample(x, y),
  restore: size => camera.restoreCalibration(size),
  save: size => { camera.saveCalibration(size); return true; },
};

// Only the navigator that created this frame knows its nonce; any other connection is ignored.
chrome.runtime.onConnect.addListener(candidate => {
  if (port || !nonce || candidate.name !== `gaze-capture:${nonce}` || candidate.sender?.tab?.id === undefined) return;
  port = candidate;
  port.onMessage.addListener(async ({ id, op, args = [] }) => {
    const operation = Object.hasOwn(operations, op) ? operations[op] : null;
    try {
      if (!operation) throw new Error(`Unknown camera request: ${op}`);
      const result = await operation(...args);
      if (id) port?.postMessage({ id, result });
    } catch (error) {
      if (id) port?.postMessage({ id, error: error.message });
    }
  });
  // The navigator stopped or the page went away: release the camera even if no stop request arrived.
  port.onDisconnect.addListener(() => {
    port = null;
    camera.stop();
  });
  port.postMessage({ type: 'ready' });
});
