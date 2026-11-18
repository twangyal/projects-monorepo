// The overlay's camera: start/stop, calibration samples and calibration reuse, behind one interface so
// the estimator can run in the page (the practice website) or in an extension-owned frame (the extension).
//
// Interface: start() → Promise<{ok, message}>, stop() → wasOn, state ('off' | 'starting' | 'ready'),
// session (changes on every start), setMode('eyes' | 'head'), resetCalibration(), recordSample(x, y) → boolean or
// Promise<boolean>, restoreCalibration(size) → Promise<{ok, stale?, reason?}> (stale: restored, but old enough to need
// a refresh), saveCalibration(size), clearCalibration().
import { createCameraGaze } from './camera-gaze.js';
import { recordCalibrationSample } from '../camera-calibration.js';
import { decodeCalibration, encodeCalibration, encodeHeadCalibration } from './calibration-store.js';

/** WebGazer in this document; calibrations go to `store` (loadCalibration/saveCalibration/clearCalibration). */
export function createLocalCamera({ document, window, load, store = {}, onGaze, onLost }) {
  const camera = createCameraGaze({ document, window, load, onGaze, onLost });
  let session = 0;
  let calibrationGeneration = 0;
  return {
    async start() {
      session++;
      return camera.start();
    },
    stop: () => camera.stop(),
    get state() { return camera.state; },
    get session() { return session; },
    setMode(mode) { calibrationGeneration++; camera.setMode(mode); },
    resetCalibration() { calibrationGeneration++; camera.resetCalibration(); },
    recordSample(x, y) {
      const api = camera.api;
      if (!api) return false;
      if (camera.mode === 'head') return camera.recordHeadSample(x, y);
      // The irises learn the point as well as WebGazer, which places the gaze until they have enough.
      const kept = recordCalibrationSample(api, x, y), irises = camera.recordIrisSample(x, y);
      return kept || irises;
    },
    async restoreCalibration({ width, height, now }) {
      const attempt = ++calibrationGeneration;
      const api = camera.api;
      let decoded = { ok: false, reason: 'none' };
      try {
        decoded = decodeCalibration(await store.loadCalibration?.(), { width, height, now, mode: camera.mode });
      } catch { /* Fall back to a fresh calibration. */ }
      if (attempt !== calibrationGeneration) return { ok: false, reason: 'superseded' };
      if (!decoded.ok) return decoded;
      if (!api || camera.api !== api) return { ok: false, reason: 'stopped' };
      try {
        camera.resetCalibration();
        const restored = decoded.stale ? { ok: true, stale: true } : { ok: true };
        if (camera.mode === 'head') return camera.setHeadSamples(decoded.samples) ? restored : { ok: false, reason: 'invalid' };
        api.getRegression()[0].setData(decoded.samples);
        if (decoded.iris?.length) camera.setIrisSamples(decoded.iris);
        return restored;
      } catch {
        return { ok: false, reason: 'invalid' };
      }
    },
    saveCalibration({ width, height, now }) {
      const api = camera.api;
      if (!api) return;
      try {
        store.saveCalibration?.(camera.mode === 'head' ? encodeHeadCalibration(camera.headSamples, { width, height, now })
          : encodeCalibration(api.getRegression()[0].getData(), { width, height, now, iris: camera.irisSamples }));
      } catch { /* The calibration still works on this page. */ }
    },
    clearCalibration: () => store.clearCalibration?.(),
  };
}
