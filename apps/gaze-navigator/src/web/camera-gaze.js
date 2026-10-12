// Camera tracking source for the web navigator: owns one WebGazer session at a time.
// Estimator data stays in memory; stopping releases the stream even during startup.
import { createCameraLoader } from '../camera-loader.js';
import { resetCameraCalibration } from '../camera-calibration.js';
import { releaseCamera } from '../camera-cleanup.js';
import { identifyCamera, retireCamera, retireCameraModel } from '../camera-retirement.js';

export function createCameraGaze({ document, window, load = createCameraLoader(document, window), onGaze, onLost }) {
  let session = 0;
  let api = null;
  let state = 'off';
  let needsFresh = false;
  let startup = null;

  async function start() {
    if (state !== 'off') return { ok: false, message: 'The camera is already on.' };
    const current = ++session;
    state = 'starting';
    const cancelled = Symbol('cancelled');
    let cancel;
    const cancellation = new Promise(resolve => { cancel = () => resolve(cancelled); });
    startup = { cancel, settled: false, retire: null };
    const mine = startup;
    try {
      const fresh = needsFresh;
      needsFresh = false;
      const loaded = await Promise.race([load({ fresh }), cancellation]);
      if (loaded === cancelled || current !== session) return { ok: false, message: 'Camera start was cancelled.' };
      api = loaded;
      identifyCamera(api, `web-${current}`);
      api.saveDataAcrossSessions(false);
      api.showPredictionPoints(false);
      api.setGazeListener(data => {
        if (current !== session || state !== 'ready') return;
        if (data && Number.isFinite(data.x) && Number.isFinite(data.y)) onGaze(data.x, data.y, window.performance.now());
        else onLost();
      });
      const beginning = Promise.resolve(api.begin());
      const settle = () => {
        mine.settled = true;
        if (current !== session) {
          if (mine.retire) mine.retire();
          else if (loaded) releaseCamera(loaded, document);
        }
      };
      beginning.then(settle, settle);
      const began = await Promise.race([beginning, cancellation]);
      if (began === cancelled || current !== session) return { ok: false, message: 'Camera start was cancelled.' };
      api.removeMouseEventListeners();
      resetCameraCalibration(api);
      state = 'ready';
      return { ok: true, message: 'Camera on.' };
    } catch (error) {
      if (current === session) stop();
      return { ok: false, message: `Camera tracking could not start (${error.message}). Check camera permission, or keep using the pointer.` };
    } finally {
      if (startup === mine) startup = null;
    }
  }

  function stop() {
    const was = state;
    session++;
    state = 'off';
    const pending = startup;
    pending?.cancel();
    if (api) {
      // end() cannot interrupt inference already running; never reuse this estimator instance.
      needsFresh = true;
      retireCameraModel(api);
      if (pending && !pending.settled) pending.retire = retireCamera(api, document, window);
      else releaseCamera(api, document);
    }
    api = null;
    return was !== 'off';
  }

  return {
    start,
    stop,
    get api() { return state === 'ready' ? api : null; },
    get state() { return state; },
    resetCalibration() { if (api) resetCameraCalibration(api); },
  };
}
